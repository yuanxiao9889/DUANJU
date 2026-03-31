use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    image::persist_image_source,
    project_state::{
        normalize_image_ref_path, open_db, prune_unreferenced_images, replace_project_image_refs,
    },
    storage,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSubcategoryRecord {
    pub id: String,
    pub library_id: String,
    pub category: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetItemRecord {
    pub id: String,
    pub library_id: String,
    pub category: String,
    pub media_type: String,
    pub subcategory_id: Option<String>,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub source_path: String,
    pub preview_path: Option<String>,
    pub mime_type: Option<String>,
    pub duration_ms: Option<i64>,
    pub aspect_ratio: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetLibraryRecord {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub subcategories: Vec<AssetSubcategoryRecord>,
    pub items: Vec<AssetItemRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAssetLibraryPayload {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAssetLibraryPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAssetSubcategoryPayload {
    pub library_id: String,
    pub category: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAssetSubcategoryPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetItemMutationPayload {
    pub id: Option<String>,
    pub library_id: String,
    pub category: String,
    pub media_type: String,
    pub subcategory_id: Option<String>,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub source_path: String,
    pub preview_path: Option<String>,
    pub mime_type: Option<String>,
    pub duration_ms: Option<i64>,
    pub aspect_ratio: String,
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());

    if cfg!(target_os = "windows")
        && decoded.starts_with('/')
        && decoded
            .chars()
            .nth(1)
            .is_some_and(|ch| ch.is_ascii_alphabetic())
        && decoded.chars().nth(2) == Some(':')
    {
        decoded[1..].to_string()
    } else {
        decoded
    }
}

fn resolve_local_asset_path(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("data:")
        || lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("blob:")
    {
        return None;
    }

    if lower.starts_with("file://") {
        return Some(PathBuf::from(decode_file_url_path(trimmed)));
    }

    let is_windows_drive_path = trimmed.len() >= 3
        && trimmed.as_bytes()[1] == b':'
        && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/')
        && trimmed.as_bytes()[0].is_ascii_alphabetic();
    let is_unc_path = trimmed.starts_with("\\\\");
    let is_unix_absolute_path = trimmed.starts_with('/');

    if is_windows_drive_path || is_unc_path || is_unix_absolute_path {
        return Some(PathBuf::from(trimmed));
    }

    None
}

fn normalize_path_for_prefix_match(path: &Path) -> String {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();

    if cfg!(target_os = "windows") {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn is_path_within_dir(path: &Path, dir: &Path) -> bool {
    let normalized_path = normalize_path_for_prefix_match(path);
    let normalized_dir = normalize_path_for_prefix_match(dir);

    normalized_path == normalized_dir || normalized_path.starts_with(&(normalized_dir + "/"))
}

fn should_persist_asset_path(images_dir: &Path, value: &str) -> bool {
    let Some(local_path) = resolve_local_asset_path(value) else {
        return false;
    };

    !is_path_within_dir(&local_path, images_dir)
}

async fn normalize_asset_media_paths(
    app: &AppHandle,
    source_path: String,
    preview_path: Option<String>,
) -> Result<(String, Option<String>), String> {
    let images_dir = storage::resolve_images_dir(app)?;
    let normalized_source_path = source_path.trim().to_string();
    let normalized_preview_path = normalize_optional_text(preview_path);

    let safe_source_path = if should_persist_asset_path(&images_dir, &normalized_source_path) {
        persist_image_source(app.clone(), normalized_source_path.clone()).await?
    } else {
        normalized_source_path
    };

    let safe_preview_path = match normalized_preview_path {
        Some(path) if should_persist_asset_path(&images_dir, &path) => {
            Some(persist_image_source(app.clone(), path).await?)
        }
        Some(path) => Some(path),
        None => None,
    };

    Ok((safe_source_path, safe_preview_path))
}

fn serialize_tags(tags: &[String]) -> Result<String, String> {
    serde_json::to_string(tags).map_err(|e| format!("Failed to encode asset tags: {}", e))
}

fn deserialize_tags(value: String) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(&value).unwrap_or_default()
}

fn normalize_asset_media_type(category: &str, requested_media_type: &str) -> String {
    let normalized_category = category.trim().to_ascii_lowercase();
    let normalized_media_type = requested_media_type.trim().to_ascii_lowercase();

    if normalized_category == "voice" {
        return "audio".to_string();
    }

    if normalized_media_type == "audio" {
        return "audio".to_string();
    }

    "image".to_string()
}

fn touch_library(
    tx: &rusqlite::Transaction<'_>,
    library_id: &str,
    updated_at: i64,
) -> Result<(), String> {
    tx.execute(
        "UPDATE asset_libraries SET updated_at = ?1 WHERE id = ?2",
        params![updated_at, library_id],
    )
    .map_err(|e| format!("Failed to touch asset library: {}", e))?;
    Ok(())
}

fn replace_asset_image_refs(
    tx: &rusqlite::Transaction<'_>,
    asset_id: &str,
    source_path: &str,
    preview_path: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM asset_image_refs WHERE asset_id = ?1",
        params![asset_id],
    )
    .map_err(|e| format!("Failed to clear asset image refs: {}", e))?;

    for path in [Some(source_path), preview_path] {
        let Some(path) = path.map(str::trim).filter(|value| !value.is_empty()) else {
            continue;
        };
        let Some(normalized_path) = normalize_image_ref_path(path) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO asset_image_refs (asset_id, path) VALUES (?1, ?2)",
            params![asset_id, normalized_path],
        )
        .map_err(|e| format!("Failed to upsert asset image ref: {}", e))?;
    }

    Ok(())
}

fn update_asset_item_paths(
    tx: &rusqlite::Transaction<'_>,
    asset_id: &str,
    source_path: &str,
    preview_path: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        r#"
        UPDATE asset_items
        SET
          source_path = ?2,
          preview_path = ?3,
          image_path = ?2,
          preview_image_path = COALESCE(?3, '')
        WHERE id = ?1
        "#,
        params![asset_id, source_path, preview_path],
    )
    .map_err(|e| format!("Failed to update asset item paths: {}", e))?;

    replace_asset_image_refs(tx, asset_id, source_path, preview_path)?;
    Ok(())
}

fn set_string_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    next_value: &str,
) -> bool {
    let current_value = object.get(key).and_then(Value::as_str);
    if current_value == Some(next_value) {
        return false;
    }

    object.insert(key.to_string(), Value::String(next_value.to_string()));
    true
}

fn set_optional_string_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    next_value: Option<&str>,
) -> bool {
    let normalized = next_value.map(str::trim).filter(|value| !value.is_empty());
    match normalized {
        Some(value) => set_string_field(object, key, value),
        None => set_null_field(object, key),
    }
}

fn set_optional_f64_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    next_value: Option<f64>,
) -> bool {
    let Some(value) = next_value.filter(|value| value.is_finite()) else {
        return set_null_field(object, key);
    };

    let current_value = object.get(key).and_then(Value::as_f64);
    if current_value.is_some_and(|current| (current - value).abs() < f64::EPSILON) {
        return false;
    }

    let Some(number) = serde_json::Number::from_f64(value) else {
        return false;
    };

    object.insert(key.to_string(), Value::Number(number));
    true
}

fn set_null_field(object: &mut serde_json::Map<String, Value>, key: &str) -> bool {
    if object.get(key).is_some_and(Value::is_null) {
        return false;
    }

    object.insert(key.to_string(), Value::Null);
    true
}

fn patch_asset_bound_node(node: &mut Value, item: &AssetItemRecord) -> bool {
    let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
        return false;
    };

    if data.get("assetId").and_then(Value::as_str) != Some(item.id.as_str()) {
        return false;
    }

    let mut changed = false;
    changed |= set_string_field(data, "displayName", &item.name);
    changed |= set_string_field(data, "assetName", &item.name);
    changed |= set_string_field(data, "assetCategory", &item.category);
    changed |= set_string_field(data, "assetLibraryId", &item.library_id);
    if item.media_type == "audio" {
        changed |= set_string_field(data, "audioUrl", &item.source_path);
        changed |= set_string_field(data, "audioFileName", &item.name);
        changed |= set_optional_string_field(data, "previewImageUrl", item.preview_path.as_deref());
        changed |= set_optional_string_field(data, "mimeType", item.mime_type.as_deref());
        changed |= set_optional_f64_field(
            data,
            "duration",
            item.duration_ms.map(|value| value as f64 / 1000.0),
        );
    } else {
        changed |= set_string_field(data, "imageUrl", &item.source_path);
        changed |= set_optional_string_field(data, "previewImageUrl", item.preview_path.as_deref());
        changed |= set_string_field(data, "aspectRatio", &item.aspect_ratio);
        changed |= set_string_field(data, "sourceFileName", &item.name);
        changed |= set_null_field(data, "imageWidth");
        changed |= set_null_field(data, "imageHeight");
    }
    changed
}

fn patch_asset_bound_nodes(
    nodes_json: &str,
    item: &AssetItemRecord,
) -> Result<(String, bool), String> {
    let mut parsed = serde_json::from_str::<Value>(nodes_json)
        .map_err(|e| format!("Failed to parse project nodes JSON: {}", e))?;

    let mut changed = false;
    if let Some(nodes) = parsed.as_array_mut() {
        for node in nodes {
            changed |= patch_asset_bound_node(node, item);
        }
    }

    if !changed {
        return Ok((nodes_json.to_string(), false));
    }

    let encoded = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to encode project nodes JSON: {}", e))?;
    Ok((encoded, true))
}

fn patch_asset_bound_history(
    history_json: &str,
    item: &AssetItemRecord,
) -> Result<(String, bool), String> {
    let mut parsed = serde_json::from_str::<Value>(history_json)
        .map_err(|e| format!("Failed to parse project history JSON: {}", e))?;

    let mut changed = false;
    let Some(history_object) = parsed.as_object_mut() else {
        return Ok((history_json.to_string(), false));
    };

    for timeline_key in ["past", "future"] {
        let Some(timeline) = history_object
            .get_mut(timeline_key)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        for snapshot in timeline {
            let Some(nodes) = snapshot.get_mut("nodes").and_then(Value::as_array_mut) else {
                continue;
            };

            for node in nodes {
                changed |= patch_asset_bound_node(node, item);
            }
        }
    }

    if !changed {
        return Ok((history_json.to_string(), false));
    }

    let encoded = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to encode project history JSON: {}", e))?;
    Ok((encoded, true))
}

fn detach_deleted_asset_reference(node: &mut Value, asset_item_id: &str) -> bool {
    let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
        return false;
    };

    if data.get("assetId").and_then(Value::as_str) != Some(asset_item_id) {
        return false;
    }

    let mut changed = false;
    changed |= set_null_field(data, "assetId");
    changed |= set_null_field(data, "assetLibraryId");
    changed |= set_null_field(data, "assetName");
    changed |= set_null_field(data, "assetCategory");
    changed
}

fn detach_deleted_asset_from_nodes(
    nodes_json: &str,
    asset_item_id: &str,
) -> Result<(String, bool), String> {
    let mut parsed = serde_json::from_str::<Value>(nodes_json)
        .map_err(|e| format!("Failed to parse project nodes JSON: {}", e))?;

    let mut changed = false;
    if let Some(nodes) = parsed.as_array_mut() {
        for node in nodes {
            changed |= detach_deleted_asset_reference(node, asset_item_id);
        }
    }

    if !changed {
        return Ok((nodes_json.to_string(), false));
    }

    let encoded = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to encode project nodes JSON: {}", e))?;
    Ok((encoded, true))
}

fn detach_deleted_asset_from_history(
    history_json: &str,
    asset_item_id: &str,
) -> Result<(String, bool), String> {
    let mut parsed = serde_json::from_str::<Value>(history_json)
        .map_err(|e| format!("Failed to parse project history JSON: {}", e))?;

    let mut changed = false;
    let Some(history_object) = parsed.as_object_mut() else {
        return Ok((history_json.to_string(), false));
    };

    for timeline_key in ["past", "future"] {
        let Some(timeline) = history_object
            .get_mut(timeline_key)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        for snapshot in timeline {
            let Some(nodes) = snapshot.get_mut("nodes").and_then(Value::as_array_mut) else {
                continue;
            };

            for node in nodes {
                changed |= detach_deleted_asset_reference(node, asset_item_id);
            }
        }
    }

    if !changed {
        return Ok((history_json.to_string(), false));
    }

    let encoded = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to encode project history JSON: {}", e))?;
    Ok((encoded, true))
}

fn sync_asset_item_to_projects(
    conn: &mut Connection,
    item: &AssetItemRecord,
) -> Result<(), String> {
    let project_rows: Vec<(String, String, String)> = {
        let pattern = format!("%{}%", item.id);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, nodes_json, history_json
                FROM projects
                WHERE nodes_json LIKE ?1 OR history_json LIKE ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare project sync query: {}", e))?;

        let rows = stmt
            .query_map(params![pattern], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query projects for asset sync: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(row.map_err(|e| format!("Failed to read project sync row: {}", e))?);
        }
        collected
    };

    if project_rows.is_empty() {
        return Ok(());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset sync transaction: {}", e))?;

    for (project_id, nodes_json, history_json) in project_rows {
        let (next_nodes_json, nodes_changed) = patch_asset_bound_nodes(&nodes_json, item)?;
        let (next_history_json, history_changed) = patch_asset_bound_history(&history_json, item)?;
        if !nodes_changed && !history_changed {
            continue;
        }

        tx.execute(
            "UPDATE projects SET nodes_json = ?1, history_json = ?2 WHERE id = ?3",
            params![next_nodes_json, next_history_json, project_id],
        )
        .map_err(|e| format!("Failed to update synced project nodes: {}", e))?;

        replace_project_image_refs(&tx, &project_id, &next_nodes_json, &next_history_json)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit asset sync transaction: {}", e))?;

    Ok(())
}

async fn migrate_asset_item_paths_if_needed(
    app: &AppHandle,
    conn: &mut Connection,
    item: &mut AssetItemRecord,
) -> Result<bool, String> {
    let (next_source_path, next_preview_path) =
        normalize_asset_media_paths(app, item.source_path.clone(), item.preview_path.clone())
            .await?;

    if next_source_path == item.source_path && next_preview_path == item.preview_path {
        return Ok(false);
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset item migration transaction: {}", e))?;
    update_asset_item_paths(
        &tx,
        &item.id,
        &next_source_path,
        next_preview_path.as_deref(),
    )?;
    tx.commit()
        .map_err(|e| format!("Failed to commit asset item migration transaction: {}", e))?;

    item.source_path = next_source_path;
    item.preview_path = next_preview_path;
    sync_asset_item_to_projects(conn, item)?;
    Ok(true)
}

fn detach_asset_item_from_projects(
    conn: &mut Connection,
    asset_item_id: &str,
) -> Result<(), String> {
    let project_rows: Vec<(String, String, String)> = {
        let pattern = format!("%{}%", asset_item_id);
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, nodes_json, history_json
                FROM projects
                WHERE nodes_json LIKE ?1 OR history_json LIKE ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare project detach query: {}", e))?;

        let rows = stmt
            .query_map(params![pattern], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query projects for asset detach: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(row.map_err(|e| format!("Failed to read project detach row: {}", e))?);
        }
        collected
    };

    if project_rows.is_empty() {
        return Ok(());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset detach transaction: {}", e))?;

    for (project_id, nodes_json, history_json) in project_rows {
        let (next_nodes_json, nodes_changed) =
            detach_deleted_asset_from_nodes(&nodes_json, asset_item_id)?;
        let (next_history_json, history_changed) =
            detach_deleted_asset_from_history(&history_json, asset_item_id)?;
        if !nodes_changed && !history_changed {
            continue;
        }

        tx.execute(
            "UPDATE projects SET nodes_json = ?1, history_json = ?2 WHERE id = ?3",
            params![next_nodes_json, next_history_json, project_id],
        )
        .map_err(|e| format!("Failed to update detached project nodes: {}", e))?;

        replace_project_image_refs(&tx, &project_id, &next_nodes_json, &next_history_json)?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit asset detach transaction: {}", e))?;

    Ok(())
}

fn load_library_base_record(
    conn: &Connection,
    library_id: &str,
) -> Result<Option<AssetLibraryRecord>, String> {
    conn.query_row(
        r#"
        SELECT id, name, created_at, updated_at
        FROM asset_libraries
        WHERE id = ?1
        LIMIT 1
        "#,
        params![library_id],
        |row| {
            Ok(AssetLibraryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                subcategories: Vec::new(),
                items: Vec::new(),
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to load asset library: {}", e))
}

fn load_library_subcategories(
    conn: &Connection,
    library_id: &str,
) -> Result<Vec<AssetSubcategoryRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, library_id, category, name, created_at, updated_at
            FROM asset_subcategories
            WHERE library_id = ?1
            ORDER BY category ASC, name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare asset subcategories query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id], |row| {
            Ok(AssetSubcategoryRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                category: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query asset subcategories: {}", e))?;

    let mut subcategories = Vec::new();
    for row in rows {
        subcategories.push(row.map_err(|e| format!("Failed to read asset subcategory: {}", e))?);
    }
    Ok(subcategories)
}

fn load_library_items(conn: &Connection, library_id: &str) -> Result<Vec<AssetItemRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              library_id,
              category,
              COALESCE(NULLIF(TRIM(media_type), ''), CASE WHEN category = 'voice' THEN 'audio' ELSE 'image' END) AS media_type,
              subcategory_id,
              name,
              description,
              tags_json,
              COALESCE(NULLIF(TRIM(source_path), ''), image_path) AS source_path,
              NULLIF(TRIM(COALESCE(preview_path, preview_image_path, '')), '') AS preview_path,
              NULLIF(TRIM(COALESCE(mime_type, '')), '') AS mime_type,
              duration_ms,
              aspect_ratio,
              created_at,
              updated_at
            FROM asset_items
            WHERE library_id = ?1
            ORDER BY category ASC, name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare asset items query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id], |row| {
            Ok(AssetItemRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                category: row.get(2)?,
                media_type: row.get(3)?,
                subcategory_id: row.get(4)?,
                name: row.get(5)?,
                description: row.get(6)?,
                tags: deserialize_tags(row.get(7)?),
                source_path: row.get(8)?,
                preview_path: row.get(9)?,
                mime_type: row.get(10)?,
                duration_ms: row.get(11)?,
                aspect_ratio: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|e| format!("Failed to query asset items: {}", e))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("Failed to read asset item: {}", e))?);
    }
    Ok(items)
}

fn load_asset_library_record(
    conn: &Connection,
    library_id: &str,
) -> Result<Option<AssetLibraryRecord>, String> {
    let Some(mut library) = load_library_base_record(conn, library_id)? else {
        return Ok(None);
    };

    library.subcategories = load_library_subcategories(conn, library_id)?;
    library.items = load_library_items(conn, library_id)?;
    Ok(Some(library))
}

#[tauri::command]
pub async fn list_asset_libraries(app: AppHandle) -> Result<Vec<AssetLibraryRecord>, String> {
    let mut conn = open_db(&app)?;
    let mut libraries = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT id, name, created_at, updated_at
                FROM asset_libraries
                ORDER BY updated_at DESC
                "#,
            )
            .map_err(|e| format!("Failed to prepare asset libraries query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AssetLibraryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    subcategories: Vec::new(),
                    items: Vec::new(),
                })
            })
            .map_err(|e| format!("Failed to query asset libraries: {}", e))?;

        let mut libraries = Vec::new();
        for row in rows {
            libraries.push(row.map_err(|e| format!("Failed to read asset library: {}", e))?);
        }
        libraries
    };

    let mut subcategories_by_library = HashMap::<String, Vec<AssetSubcategoryRecord>>::new();
    {
        let mut subcategory_stmt = conn
            .prepare(
                r#"
                SELECT id, library_id, category, name, created_at, updated_at
                FROM asset_subcategories
                ORDER BY category ASC, name COLLATE NOCASE ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare all asset subcategories query: {}", e))?;
        let subcategory_rows = subcategory_stmt
            .query_map([], |row| {
                Ok(AssetSubcategoryRecord {
                    id: row.get(0)?,
                    library_id: row.get(1)?,
                    category: row.get(2)?,
                    name: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Failed to query all asset subcategories: {}", e))?;
        for row in subcategory_rows {
            let subcategory =
                row.map_err(|e| format!("Failed to read asset subcategory row: {}", e))?;
            subcategories_by_library
                .entry(subcategory.library_id.clone())
                .or_default()
                .push(subcategory);
        }
    }

    let mut items_by_library = HashMap::<String, Vec<AssetItemRecord>>::new();
    {
        let mut item_stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  library_id,
                  category,
                  COALESCE(NULLIF(TRIM(media_type), ''), CASE WHEN category = 'voice' THEN 'audio' ELSE 'image' END) AS media_type,
                  subcategory_id,
                  name,
                  description,
                  tags_json,
                  COALESCE(NULLIF(TRIM(source_path), ''), image_path) AS source_path,
                  NULLIF(TRIM(COALESCE(preview_path, preview_image_path, '')), '') AS preview_path,
                  NULLIF(TRIM(COALESCE(mime_type, '')), '') AS mime_type,
                  duration_ms,
                  aspect_ratio,
                  created_at,
                  updated_at
                FROM asset_items
                ORDER BY category ASC, name COLLATE NOCASE ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare all asset items query: {}", e))?;
        let item_rows = item_stmt
            .query_map([], |row| {
                Ok(AssetItemRecord {
                    id: row.get(0)?,
                    library_id: row.get(1)?,
                    category: row.get(2)?,
                    media_type: row.get(3)?,
                    subcategory_id: row.get(4)?,
                    name: row.get(5)?,
                    description: row.get(6)?,
                    tags: deserialize_tags(row.get(7)?),
                    source_path: row.get(8)?,
                    preview_path: row.get(9)?,
                    mime_type: row.get(10)?,
                    duration_ms: row.get(11)?,
                    aspect_ratio: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            })
            .map_err(|e| format!("Failed to query all asset items: {}", e))?;
        for row in item_rows {
            let item = row.map_err(|e| format!("Failed to read asset item row: {}", e))?;
            items_by_library
                .entry(item.library_id.clone())
                .or_default()
                .push(item);
        }
    }

    for library in &mut libraries {
        library.subcategories = subcategories_by_library
            .remove(&library.id)
            .unwrap_or_default();
        library.items = items_by_library.remove(&library.id).unwrap_or_default();
    }

    let mut migrated_any = false;
    for library in &mut libraries {
        for item in &mut library.items {
            migrated_any |= migrate_asset_item_paths_if_needed(&app, &mut conn, item).await?;
        }
    }

    if migrated_any {
        prune_unreferenced_images(&app)?;
    }

    Ok(libraries)
}

#[tauri::command]
pub fn create_asset_library(
    app: AppHandle,
    payload: CreateAssetLibraryPayload,
) -> Result<AssetLibraryRecord, String> {
    let conn = open_db(&app)?;
    let library_id = Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    conn.execute(
        "INSERT INTO asset_libraries (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![library_id, payload.name.trim(), now, now],
    )
    .map_err(|e| format!("Failed to create asset library: {}", e))?;

    load_asset_library_record(&conn, &library_id)?
        .ok_or_else(|| "Created asset library could not be loaded".to_string())
}

#[tauri::command]
pub fn update_asset_library(
    app: AppHandle,
    payload: UpdateAssetLibraryPayload,
) -> Result<AssetLibraryRecord, String> {
    let conn = open_db(&app)?;
    let now = current_timestamp_ms();
    conn.execute(
        "UPDATE asset_libraries SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![payload.name.trim(), now, payload.id],
    )
    .map_err(|e| format!("Failed to update asset library: {}", e))?;

    load_asset_library_record(&conn, &payload.id)?
        .ok_or_else(|| "Updated asset library could not be loaded".to_string())
}

#[tauri::command]
pub fn delete_asset_library(app: AppHandle, library_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset library delete transaction: {}", e))?;

    tx.execute(
        "DELETE FROM asset_image_refs WHERE asset_id IN (SELECT id FROM asset_items WHERE library_id = ?1)",
        params![library_id],
    )
    .map_err(|e| format!("Failed to delete asset image refs for library: {}", e))?;
    tx.execute(
        "DELETE FROM asset_items WHERE library_id = ?1",
        params![library_id],
    )
    .map_err(|e| format!("Failed to delete asset items for library: {}", e))?;
    tx.execute(
        "DELETE FROM asset_subcategories WHERE library_id = ?1",
        params![library_id],
    )
    .map_err(|e| format!("Failed to delete asset subcategories for library: {}", e))?;
    tx.execute(
        "UPDATE projects SET asset_library_id = NULL WHERE asset_library_id = ?1",
        params![library_id],
    )
    .map_err(|e| format!("Failed to clear project asset library bindings: {}", e))?;
    tx.execute(
        "DELETE FROM asset_libraries WHERE id = ?1",
        params![library_id],
    )
    .map_err(|e| format!("Failed to delete asset library: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit asset library delete transaction: {}", e))?;

    prune_unreferenced_images(&app)?;
    Ok(())
}

#[tauri::command]
pub fn create_asset_subcategory(
    app: AppHandle,
    payload: CreateAssetSubcategoryPayload,
) -> Result<AssetSubcategoryRecord, String> {
    let mut conn = open_db(&app)?;
    let subcategory_id = Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    let tx = conn.transaction().map_err(|e| {
        format!(
            "Failed to begin asset subcategory create transaction: {}",
            e
        )
    })?;

    tx.execute(
        r#"
        INSERT INTO asset_subcategories (id, library_id, category, name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            subcategory_id,
            payload.library_id,
            payload.category,
            payload.name.trim(),
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to create asset subcategory: {}", e))?;
    touch_library(&tx, &payload.library_id, now)?;
    tx.commit().map_err(|e| {
        format!(
            "Failed to commit asset subcategory create transaction: {}",
            e
        )
    })?;

    let conn = open_db(&app)?;
    conn.query_row(
        r#"
        SELECT id, library_id, category, name, created_at, updated_at
        FROM asset_subcategories
        WHERE id = ?1
        LIMIT 1
        "#,
        params![subcategory_id],
        |row| {
            Ok(AssetSubcategoryRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                category: row.get(2)?,
                name: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| format!("Failed to reload created asset subcategory: {}", e))
}

#[tauri::command]
pub fn update_asset_subcategory(
    app: AppHandle,
    payload: UpdateAssetSubcategoryPayload,
) -> Result<AssetSubcategoryRecord, String> {
    let mut conn = open_db(&app)?;
    let existing: AssetSubcategoryRecord = conn
        .query_row(
            r#"
            SELECT id, library_id, category, name, created_at, updated_at
            FROM asset_subcategories
            WHERE id = ?1
            LIMIT 1
            "#,
            params![payload.id],
            |row| {
                Ok(AssetSubcategoryRecord {
                    id: row.get(0)?,
                    library_id: row.get(1)?,
                    category: row.get(2)?,
                    name: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .map_err(|e| format!("Failed to load asset subcategory for update: {}", e))?;

    let now = current_timestamp_ms();
    let tx = conn.transaction().map_err(|e| {
        format!(
            "Failed to begin asset subcategory update transaction: {}",
            e
        )
    })?;
    tx.execute(
        "UPDATE asset_subcategories SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![payload.name.trim(), now, payload.id],
    )
    .map_err(|e| format!("Failed to update asset subcategory: {}", e))?;
    touch_library(&tx, &existing.library_id, now)?;
    tx.commit().map_err(|e| {
        format!(
            "Failed to commit asset subcategory update transaction: {}",
            e
        )
    })?;

    Ok(AssetSubcategoryRecord {
        id: existing.id,
        library_id: existing.library_id,
        category: existing.category,
        name: payload.name.trim().to_string(),
        created_at: existing.created_at,
        updated_at: now,
    })
}

#[tauri::command]
pub fn delete_asset_subcategory(app: AppHandle, subcategory_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let library_id: String = conn
        .query_row(
            "SELECT library_id FROM asset_subcategories WHERE id = ?1 LIMIT 1",
            params![subcategory_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to load asset subcategory for delete: {}", e))?;
    let now = current_timestamp_ms();
    let tx = conn.transaction().map_err(|e| {
        format!(
            "Failed to begin asset subcategory delete transaction: {}",
            e
        )
    })?;

    tx.execute(
        "UPDATE asset_items SET subcategory_id = NULL WHERE subcategory_id = ?1",
        params![subcategory_id],
    )
    .map_err(|e| format!("Failed to clear asset subcategory references: {}", e))?;
    tx.execute(
        "DELETE FROM asset_subcategories WHERE id = ?1",
        params![subcategory_id],
    )
    .map_err(|e| format!("Failed to delete asset subcategory: {}", e))?;
    touch_library(&tx, &library_id, now)?;
    tx.commit().map_err(|e| {
        format!(
            "Failed to commit asset subcategory delete transaction: {}",
            e
        )
    })?;

    Ok(())
}

async fn create_or_update_asset_item(
    app: &AppHandle,
    payload: AssetItemMutationPayload,
) -> Result<AssetItemRecord, String> {
    let mut conn = open_db(app)?;
    let item_id = payload
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = current_timestamp_ms();
    let normalized_library_id = payload.library_id.trim().to_string();
    let normalized_category = payload.category.trim().to_string();
    let normalized_subcategory_id = normalize_optional_text(payload.subcategory_id.clone());
    let normalized_name = payload.name.trim().to_string();
    let normalized_description = payload.description.trim().to_string();
    let normalized_media_type =
        normalize_asset_media_type(&normalized_category, &payload.media_type);
    let normalized_mime_type = normalize_optional_text(payload.mime_type.clone());
    let normalized_duration_ms = payload.duration_ms.filter(|value| *value >= 0);
    let normalized_aspect_ratio = if payload.aspect_ratio.trim().is_empty() {
        "1:1".to_string()
    } else {
        payload.aspect_ratio.trim().to_string()
    };
    let (normalized_source_path, normalized_preview_path) = normalize_asset_media_paths(
        app,
        payload.source_path.clone(),
        payload.preview_path.clone(),
    )
    .await?;

    if normalized_source_path.is_empty() {
        return Err("Asset source path is required".to_string());
    }

    let tags_json = serialize_tags(&payload.tags)?;

    let previous_library_id = if payload.id.is_some() {
        conn.query_row(
            "SELECT library_id FROM asset_items WHERE id = ?1 LIMIT 1",
            params![item_id.clone()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to load existing asset item: {}", e))?
    } else {
        None
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset item upsert transaction: {}", e))?;
    tx.execute(
        r#"
        INSERT INTO asset_items (
          id,
          library_id,
          category,
          media_type,
          subcategory_id,
          name,
          description,
          tags_json,
          source_path,
          preview_path,
          mime_type,
          duration_ms,
          image_path,
          preview_image_path,
          aspect_ratio,
          created_at,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
        ON CONFLICT(id) DO UPDATE SET
          library_id = excluded.library_id,
          category = excluded.category,
          media_type = excluded.media_type,
          subcategory_id = excluded.subcategory_id,
          name = excluded.name,
          description = excluded.description,
          tags_json = excluded.tags_json,
          source_path = excluded.source_path,
          preview_path = excluded.preview_path,
          mime_type = excluded.mime_type,
          duration_ms = excluded.duration_ms,
          image_path = excluded.image_path,
          preview_image_path = excluded.preview_image_path,
          aspect_ratio = excluded.aspect_ratio,
          updated_at = excluded.updated_at
        "#,
        params![
            item_id,
            normalized_library_id.clone(),
            normalized_category,
            normalized_media_type,
            normalized_subcategory_id,
            normalized_name,
            normalized_description,
            tags_json,
            normalized_source_path.clone(),
            normalized_preview_path.clone(),
            normalized_mime_type,
            normalized_duration_ms,
            normalized_source_path.clone(),
            normalized_preview_path.clone().unwrap_or_default(),
            normalized_aspect_ratio,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to upsert asset item: {}", e))?;
    replace_asset_image_refs(
        &tx,
        &item_id,
        &normalized_source_path,
        normalized_preview_path.as_deref(),
    )?;
    if let Some(previous_library_id) = previous_library_id.as_ref() {
        if previous_library_id != &normalized_library_id {
            touch_library(&tx, previous_library_id, now)?;
        }
    }
    touch_library(&tx, &normalized_library_id, now)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit asset item upsert transaction: {}", e))?;

    let item = open_db(app)?
        .query_row(
            r#"
            SELECT
              id,
              library_id,
              category,
              COALESCE(NULLIF(TRIM(media_type), ''), CASE WHEN category = 'voice' THEN 'audio' ELSE 'image' END) AS media_type,
              subcategory_id,
              name,
              description,
              tags_json,
              COALESCE(NULLIF(TRIM(source_path), ''), image_path) AS source_path,
              NULLIF(TRIM(COALESCE(preview_path, preview_image_path, '')), '') AS preview_path,
              NULLIF(TRIM(COALESCE(mime_type, '')), '') AS mime_type,
              duration_ms,
              aspect_ratio,
              created_at,
              updated_at
            FROM asset_items
            WHERE id = ?1
            LIMIT 1
            "#,
            params![item_id],
            |row| {
                Ok(AssetItemRecord {
                    id: row.get(0)?,
                    library_id: row.get(1)?,
                    category: row.get(2)?,
                    media_type: row.get(3)?,
                    subcategory_id: row.get(4)?,
                    name: row.get(5)?,
                    description: row.get(6)?,
                    tags: deserialize_tags(row.get(7)?),
                    source_path: row.get(8)?,
                    preview_path: row.get(9)?,
                    mime_type: row.get(10)?,
                    duration_ms: row.get(11)?,
                    aspect_ratio: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .map_err(|e| format!("Failed to reload asset item: {}", e))?;

    if payload.id.is_some() {
        let mut sync_conn = open_db(app)?;
        sync_asset_item_to_projects(&mut sync_conn, &item)?;
    }

    prune_unreferenced_images(app)?;
    Ok(item)
}

#[tauri::command]
pub async fn create_asset_item(
    app: AppHandle,
    payload: AssetItemMutationPayload,
) -> Result<AssetItemRecord, String> {
    create_or_update_asset_item(
        &app,
        AssetItemMutationPayload {
            id: None,
            ..payload
        },
    )
    .await
}

#[tauri::command]
pub async fn update_asset_item(
    app: AppHandle,
    payload: AssetItemMutationPayload,
) -> Result<AssetItemRecord, String> {
    if payload.id.is_none() {
        return Err("Asset item id is required for updates".to_string());
    }

    create_or_update_asset_item(&app, payload).await
}

#[tauri::command]
pub fn delete_asset_item(app: AppHandle, asset_item_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let existing_library_id: String = conn
        .query_row(
            r#"
            SELECT library_id
            FROM asset_items
            WHERE id = ?1
            LIMIT 1
            "#,
            params![asset_item_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to load asset item for delete: {}", e))?;
    let now = current_timestamp_ms();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin asset item delete transaction: {}", e))?;

    tx.execute(
        "DELETE FROM asset_image_refs WHERE asset_id = ?1",
        params![asset_item_id],
    )
    .map_err(|e| format!("Failed to delete asset image refs: {}", e))?;
    tx.execute(
        "DELETE FROM asset_items WHERE id = ?1",
        params![asset_item_id],
    )
    .map_err(|e| format!("Failed to delete asset item: {}", e))?;
    touch_library(&tx, &existing_library_id, now)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit asset item delete transaction: {}", e))?;

    let mut sync_conn = open_db(&app)?;
    detach_asset_item_from_projects(&mut sync_conn, &asset_item_id)?;
    prune_unreferenced_images(&app)?;
    Ok(())
}
