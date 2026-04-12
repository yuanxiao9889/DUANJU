use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::storage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryRecord {
    pub id: String,
    pub name: String,
    #[serde(default = "default_project_type")]
    pub project_type: String,
    #[serde(default)]
    pub asset_library_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub node_count: i64,
}

fn default_project_type() -> String {
    "storyboard".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    #[serde(default = "default_project_type")]
    pub project_type: String,
    #[serde(default)]
    pub asset_library_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub node_count: i64,
    pub nodes_json: String,
    pub edges_json: String,
    pub viewport_json: String,
    pub history_json: String,
    pub color_labels_json: String,
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    storage::resolve_db_path(app)
}

fn ensure_projects_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_type TEXT NOT NULL DEFAULT 'storyboard',
          asset_library_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          node_count INTEGER NOT NULL DEFAULT 0,
          nodes_json TEXT NOT NULL,
          edges_json TEXT NOT NULL,
          viewport_json TEXT NOT NULL,
          history_json TEXT NOT NULL,
          color_labels_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS project_image_refs (
          project_id TEXT NOT NULL,
          path TEXT NOT NULL,
          PRIMARY KEY(project_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_project_image_refs_path ON project_image_refs(path);
        CREATE TABLE IF NOT EXISTS asset_libraries (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asset_libraries_updated_at ON asset_libraries(updated_at DESC);
        CREATE TABLE IF NOT EXISTS asset_subcategories (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          category TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asset_subcategories_library_id ON asset_subcategories(library_id);
        CREATE TABLE IF NOT EXISTS asset_items (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          category TEXT NOT NULL,
          media_type TEXT NOT NULL DEFAULT 'image',
          subcategory_id TEXT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          source_path TEXT NOT NULL DEFAULT '',
          preview_path TEXT,
          mime_type TEXT,
          duration_ms INTEGER,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          image_path TEXT NOT NULL DEFAULT '',
          preview_image_path TEXT NOT NULL DEFAULT '',
          aspect_ratio TEXT NOT NULL DEFAULT '1:1',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asset_items_library_id ON asset_items(library_id);
        CREATE INDEX IF NOT EXISTS idx_asset_items_subcategory_id ON asset_items(subcategory_id);
        CREATE TABLE IF NOT EXISTS asset_image_refs (
          asset_id TEXT NOT NULL,
          path TEXT NOT NULL,
          PRIMARY KEY(asset_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_image_refs_path ON asset_image_refs(path);
        CREATE TABLE IF NOT EXISTS jimeng_video_queue_jobs (
          job_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source_node_id TEXT NOT NULL,
          result_node_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          scheduled_at INTEGER,
          submit_id TEXT,
          payload_json TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          last_error TEXT,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          started_at INTEGER,
          next_retry_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jimeng_video_queue_jobs_project_id
          ON jimeng_video_queue_jobs(project_id);
        CREATE INDEX IF NOT EXISTS idx_jimeng_video_queue_jobs_project_status
          ON jimeng_video_queue_jobs(project_id, status, scheduled_at, updated_at DESC);
        "#,
    )
    .map_err(|e| format!("Failed to initialize projects table: {}", e))?;

    let mut has_node_count = false;
    let mut has_project_type = false;
    let mut has_asset_library_id = false;
    let mut has_color_labels_json = false;
    let mut stmt = conn
        .prepare("PRAGMA table_info(projects)")
        .map_err(|e| format!("Failed to inspect projects schema: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect projects columns: {}", e))?;

    for name_result in rows {
        let column_name =
            name_result.map_err(|e| format!("Failed to read projects column name: {}", e))?;
        if column_name == "node_count" {
            has_node_count = true;
        }
        if column_name == "project_type" {
            has_project_type = true;
        }
        if column_name == "asset_library_id" {
            has_asset_library_id = true;
        }
        if column_name == "color_labels_json" {
            has_color_labels_json = true;
        }
    }

    if !has_node_count {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN node_count INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Failed to add node_count column: {}", e))?;
    }

    if !has_project_type {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'storyboard'",
            [],
        )
        .map_err(|e| format!("Failed to add project_type column: {}", e))?;
    }

    if !has_asset_library_id {
        conn.execute("ALTER TABLE projects ADD COLUMN asset_library_id TEXT", [])
            .map_err(|e| format!("Failed to add asset_library_id column: {}", e))?;
    }

    if !has_color_labels_json {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN color_labels_json TEXT NOT NULL DEFAULT '{}'",
            [],
        )
        .map_err(|e| format!("Failed to add color_labels_json column: {}", e))?;
    }

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_projects_asset_library_id ON projects(asset_library_id);
        "#,
    )
    .map_err(|e| format!("Failed to initialize project indexes: {}", e))?;

    let mut has_asset_media_type = false;
    let mut has_asset_source_path = false;
    let mut has_asset_preview_path = false;
    let mut has_asset_mime_type = false;
    let mut has_asset_duration_ms = false;
    let mut has_asset_metadata_json = false;
    let mut asset_stmt = conn
        .prepare("PRAGMA table_info(asset_items)")
        .map_err(|e| format!("Failed to inspect asset_items schema: {}", e))?;
    let asset_rows = asset_stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect asset_items columns: {}", e))?;

    for name_result in asset_rows {
        let column_name =
            name_result.map_err(|e| format!("Failed to read asset_items column name: {}", e))?;
        if column_name == "media_type" {
            has_asset_media_type = true;
        }
        if column_name == "source_path" {
            has_asset_source_path = true;
        }
        if column_name == "preview_path" {
            has_asset_preview_path = true;
        }
        if column_name == "mime_type" {
            has_asset_mime_type = true;
        }
        if column_name == "duration_ms" {
            has_asset_duration_ms = true;
        }
        if column_name == "metadata_json" {
            has_asset_metadata_json = true;
        }
    }

    if !has_asset_media_type {
        conn.execute(
            "ALTER TABLE asset_items ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'",
            [],
        )
        .map_err(|e| format!("Failed to add asset_items.media_type column: {}", e))?;
    }

    if !has_asset_source_path {
        conn.execute(
            "ALTER TABLE asset_items ADD COLUMN source_path TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|e| format!("Failed to add asset_items.source_path column: {}", e))?;
    }

    if !has_asset_preview_path {
        conn.execute("ALTER TABLE asset_items ADD COLUMN preview_path TEXT", [])
            .map_err(|e| format!("Failed to add asset_items.preview_path column: {}", e))?;
    }

    if !has_asset_mime_type {
        conn.execute("ALTER TABLE asset_items ADD COLUMN mime_type TEXT", [])
            .map_err(|e| format!("Failed to add asset_items.mime_type column: {}", e))?;
    }

    if !has_asset_duration_ms {
        conn.execute("ALTER TABLE asset_items ADD COLUMN duration_ms INTEGER", [])
            .map_err(|e| format!("Failed to add asset_items.duration_ms column: {}", e))?;
    }

    if !has_asset_metadata_json {
        conn.execute(
            "ALTER TABLE asset_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
            [],
        )
        .map_err(|e| format!("Failed to add asset_items.metadata_json column: {}", e))?;
    }

    conn.execute(
        r#"
        UPDATE asset_items
        SET media_type = CASE
          WHEN category = 'voice' THEN 'audio'
          ELSE 'image'
        END
        WHERE TRIM(COALESCE(media_type, '')) = ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.media_type: {}", e))?;

    conn.execute(
        r#"
        UPDATE asset_items
        SET source_path = image_path
        WHERE TRIM(COALESCE(source_path, '')) = ''
          AND TRIM(COALESCE(image_path, '')) <> ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.source_path: {}", e))?;

    conn.execute(
        r#"
        UPDATE asset_items
        SET preview_path = NULLIF(TRIM(preview_image_path), '')
        WHERE (preview_path IS NULL OR TRIM(COALESCE(preview_path, '')) = '')
          AND TRIM(COALESCE(preview_image_path, '')) <> ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.preview_path: {}", e))?;

    conn.execute(
        r#"
        UPDATE asset_items
        SET image_path = source_path
        WHERE TRIM(COALESCE(image_path, '')) = ''
          AND TRIM(COALESCE(source_path, '')) <> ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.image_path: {}", e))?;

    conn.execute(
        r#"
        UPDATE asset_items
        SET preview_image_path = COALESCE(preview_path, '')
        WHERE TRIM(COALESCE(preview_image_path, '')) = ''
          AND TRIM(COALESCE(preview_path, '')) <> ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.preview_image_path: {}", e))?;

    conn.execute(
        r#"
        UPDATE asset_items
        SET metadata_json = '{}'
        WHERE TRIM(COALESCE(metadata_json, '')) = ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill asset_items.metadata_json: {}", e))?;

    Ok(())
}

fn collect_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str().map(|item| item.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn extract_image_pool(parsed_nodes: Option<&Value>, parsed_history: Option<&Value>) -> Vec<String> {
    let image_pool = collect_string_array(parsed_nodes.and_then(|value| value.get("imagePool")));
    if !image_pool.is_empty() {
        return image_pool;
    }

    collect_string_array(parsed_history.and_then(|value| value.get("imagePool")))
}

pub(crate) fn project_nodes_array(value: &Value) -> Option<&Vec<Value>> {
    match value {
        Value::Array(nodes) => Some(nodes),
        Value::Object(object) => object.get("nodes").and_then(Value::as_array),
        _ => None,
    }
}

pub(crate) fn project_nodes_array_mut(value: &mut Value) -> Option<&mut Vec<Value>> {
    match value {
        Value::Array(nodes) => Some(nodes),
        Value::Object(object) => object.get_mut("nodes").and_then(Value::as_array_mut),
        _ => None,
    }
}

pub(crate) fn normalize_image_ref_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/").trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }

    if cfg!(target_os = "windows") {
        return Some(normalized.to_ascii_lowercase());
    }

    Some(normalized)
}

fn rewrite_json_string_field<F>(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    rewrite: &F,
) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let Some(current_value) = object.get(key).and_then(Value::as_str) else {
        return false;
    };
    let Some(next_value) = rewrite(current_value) else {
        return false;
    };
    if next_value == current_value {
        return false;
    }

    object.insert(key.to_string(), Value::String(next_value));
    true
}

fn rewrite_json_string_array<F>(array: &mut [Value], rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let mut changed = false;
    for item in array {
        let Some(current_value) = item.as_str() else {
            continue;
        };
        let Some(next_value) = rewrite(current_value) else {
            continue;
        };
        if next_value == current_value {
            continue;
        }

        *item = Value::String(next_value);
        changed = true;
    }

    changed
}

fn rewrite_node_media_paths<F>(node: &mut Value, rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
        return false;
    };

    let mut changed = false;
    for key in [
        "imageUrl",
        "previewImageUrl",
        "videoUrl",
        "audioUrl",
        "sourceUrl",
        "posterSourceUrl",
    ] {
        changed |= rewrite_json_string_field(data, key, rewrite);
    }

    if let Some(frames) = data.get_mut("frames").and_then(Value::as_array_mut) {
        for frame in frames {
            let Some(frame_object) = frame.as_object_mut() else {
                continue;
            };
            for key in ["imageUrl", "previewImageUrl"] {
                changed |= rewrite_json_string_field(frame_object, key, rewrite);
            }
        }
    }

    if let Some(result_images) = data.get_mut("resultImages").and_then(Value::as_array_mut) {
        for item in result_images {
            let Some(item_object) = item.as_object_mut() else {
                continue;
            };
            for key in [
                "imageUrl",
                "previewImageUrl",
                "sourceUrl",
                "posterSourceUrl",
                "videoUrl",
            ] {
                changed |= rewrite_json_string_field(item_object, key, rewrite);
            }
        }
    }

    changed
}

fn rewrite_nodes_media_paths<F>(nodes: &mut [Value], rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let mut changed = false;
    for node in nodes {
        changed |= rewrite_node_media_paths(node, rewrite);
    }
    changed
}

fn rewrite_history_snapshot_media_paths<F>(snapshot: &mut Value, rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let mut changed = false;

    if let Some(nodes) = snapshot.get_mut("nodes").and_then(Value::as_array_mut) {
        changed |= rewrite_nodes_media_paths(nodes, rewrite);
    }

    if snapshot.get("kind").and_then(Value::as_str) != Some("nodePatch") {
        return changed;
    }

    let Some(entries) = snapshot.get_mut("entries").and_then(Value::as_array_mut) else {
        return changed;
    };

    for entry in entries {
        let Some(node) = entry.get_mut("node") else {
            continue;
        };
        if node.is_null() {
            continue;
        }
        changed |= rewrite_node_media_paths(node, rewrite);
    }

    changed
}

fn rewrite_project_payload_media_paths<F>(
    nodes_json: &str,
    history_json: &str,
    rewrite: &F,
) -> Result<Option<(String, String)>, String>
where
    F: Fn(&str) -> Option<String>,
{
    let mut parsed_nodes = serde_json::from_str::<Value>(nodes_json).map_err(|e| {
        format!(
            "Failed to parse project nodes json for media rewrite: {}",
            e
        )
    })?;
    let mut parsed_history = serde_json::from_str::<Value>(history_json).map_err(|e| {
        format!(
            "Failed to parse project history json for media rewrite: {}",
            e
        )
    })?;

    let mut changed = false;

    if let Some(image_pool) = parsed_nodes
        .get_mut("imagePool")
        .and_then(Value::as_array_mut)
    {
        changed |= rewrite_json_string_array(image_pool, rewrite);
    }

    if let Some(nodes) = project_nodes_array_mut(&mut parsed_nodes) {
        changed |= rewrite_nodes_media_paths(nodes, rewrite);
    }

    if let Some(image_pool) = parsed_history
        .get_mut("imagePool")
        .and_then(Value::as_array_mut)
    {
        changed |= rewrite_json_string_array(image_pool, rewrite);
    }

    for timeline_key in ["past", "future"] {
        let Some(timeline) = parsed_history
            .get_mut(timeline_key)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        for snapshot in timeline {
            changed |= rewrite_history_snapshot_media_paths(snapshot, rewrite);
        }
    }

    if !changed {
        return Ok(None);
    }

    let next_nodes_json = serde_json::to_string(&parsed_nodes)
        .map_err(|e| format!("Failed to serialize rewritten project nodes json: {}", e))?;
    let next_history_json = serde_json::to_string(&parsed_history)
        .map_err(|e| format!("Failed to serialize rewritten project history json: {}", e))?;
    Ok(Some((next_nodes_json, next_history_json)))
}

fn resolve_image_ref(value: &str, image_pool: &[String]) -> Option<String> {
    const IMAGE_REF_PREFIX: &str = "__img_ref__:";

    if let Some(index_text) = value.strip_prefix(IMAGE_REF_PREFIX) {
        let index = index_text.parse::<usize>().ok()?;
        return image_pool
            .get(index)
            .and_then(|item| normalize_image_ref_path(item));
    }

    normalize_image_ref_path(value)
}

fn collect_image_paths_from_node(node: &Value, image_pool: &[String], paths: &mut HashSet<String>) {
    let data = match node.get("data").and_then(|value| value.as_object()) {
        Some(value) => value,
        Option::None => return,
    };

    for key in ["imageUrl", "previewImageUrl", "videoUrl", "audioUrl"] {
        if let Some(raw_value) = data.get(key).and_then(|value| value.as_str()) {
            if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                paths.insert(path);
            }
        }
    }

    if let Some(frames) = data.get("frames").and_then(|value| value.as_array()) {
        for frame in frames {
            let frame_obj = match frame.as_object() {
                Some(value) => value,
                Option::None => continue,
            };
            for key in ["imageUrl", "previewImageUrl"] {
                if let Some(raw_value) = frame_obj.get(key).and_then(|value| value.as_str()) {
                    if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                        paths.insert(path);
                    }
                }
            }
        }
    }

    if let Some(result_images) = data.get("resultImages").and_then(|value| value.as_array()) {
        for item in result_images {
            let item_obj = match item.as_object() {
                Some(value) => value,
                Option::None => continue,
            };
            for key in [
                "imageUrl",
                "previewImageUrl",
                "sourceUrl",
                "posterSourceUrl",
                "videoUrl",
            ] {
                if let Some(raw_value) = item_obj.get(key).and_then(|value| value.as_str()) {
                    if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                        paths.insert(path);
                    }
                }
            }
        }
    }
}

fn collect_image_paths_from_nodes(
    nodes: &[Value],
    image_pool: &[String],
    paths: &mut HashSet<String>,
) {
    for node in nodes {
        collect_image_paths_from_node(node, image_pool, paths);
    }
}

fn collect_image_paths_from_history_snapshot(
    snapshot: &Value,
    image_pool: &[String],
    paths: &mut HashSet<String>,
) {
    if let Some(nodes) = snapshot.get("nodes").and_then(Value::as_array) {
        collect_image_paths_from_nodes(nodes, image_pool, paths);
    }

    if snapshot.get("kind").and_then(Value::as_str) != Some("nodePatch") {
        return;
    }

    let Some(entries) = snapshot.get("entries").and_then(Value::as_array) else {
        return;
    };

    for entry in entries {
        let Some(node) = entry.get("node") else {
            continue;
        };
        if node.is_null() {
            continue;
        }
        collect_image_paths_from_node(node, image_pool, paths);
    }
}

fn extract_project_image_paths(nodes_json: &str, history_json: &str) -> HashSet<String> {
    let parsed_nodes = serde_json::from_str::<Value>(nodes_json).ok();
    let parsed_history = serde_json::from_str::<Value>(history_json).ok();
    let image_pool = extract_image_pool(parsed_nodes.as_ref(), parsed_history.as_ref());
    let mut paths = HashSet::new();

    if let Some(nodes) = parsed_nodes.as_ref().and_then(project_nodes_array) {
        collect_image_paths_from_nodes(nodes, &image_pool, &mut paths);
    }

    if let Some(parsed_history) = parsed_history.as_ref() {
        for timeline_key in ["past", "future"] {
            let Some(timeline) = parsed_history.get(timeline_key).and_then(Value::as_array) else {
                continue;
            };

            for snapshot in timeline {
                collect_image_paths_from_history_snapshot(snapshot, &image_pool, &mut paths);
            }
        }
    }

    paths
}

fn resolve_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    storage::resolve_images_dir(app)
}

fn update_project_payload_in_tx(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    nodes_json: &str,
    history_json: &str,
) -> Result<(), String> {
    tx.execute(
        "UPDATE projects SET nodes_json = ?1, history_json = ?2 WHERE id = ?3",
        params![nodes_json, history_json, project_id],
    )
    .map_err(|e| format!("Failed to update rewritten project payload: {}", e))?;

    replace_project_image_refs(tx, project_id, nodes_json, history_json)?;
    Ok(())
}

fn replace_asset_image_refs_in_tx(
    tx: &rusqlite::Transaction<'_>,
    asset_id: &str,
    source_path: &str,
    preview_path: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM asset_image_refs WHERE asset_id = ?1",
        params![asset_id],
    )
    .map_err(|e| {
        format!(
            "Failed to clear asset image refs during storage rewrite: {}",
            e
        )
    })?;

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
        .map_err(|e| {
            format!(
                "Failed to upsert asset image ref during storage rewrite: {}",
                e
            )
        })?;
    }

    Ok(())
}

fn repair_project_record_storage_aliases_if_needed(
    conn: &mut Connection,
    app: &AppHandle,
    record: &mut ProjectRecord,
) -> Result<bool, String> {
    let images_dir = resolve_images_dir(app)?;
    let Some((next_nodes_json, next_history_json)) =
        rewrite_project_payload_media_paths(&record.nodes_json, &record.history_json, &|value| {
            storage::relocate_storage_path_to_images_dir(value, &images_dir)
        })?
    else {
        return Ok(false);
    };

    let tx = conn.transaction().map_err(|e| {
        format!(
            "Failed to begin project storage alias repair transaction: {}",
            e
        )
    })?;
    update_project_payload_in_tx(&tx, &record.id, &next_nodes_json, &next_history_json)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit project storage alias repair: {}", e))?;

    record.nodes_json = next_nodes_json;
    record.history_json = next_history_json;
    Ok(true)
}

pub(crate) fn rewrite_storage_media_paths_in_connection(
    conn: &mut Connection,
    from_base: &Path,
    to_base: &Path,
) -> Result<bool, String> {
    ensure_projects_table(conn)?;

    let project_rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, nodes_json, history_json FROM projects")
            .map_err(|e| format!("Failed to prepare project storage rewrite query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query projects for storage rewrite: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read project storage rewrite row: {}", e))?,
            );
        }
        collected
    };

    let asset_rows: Vec<(String, String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  COALESCE(NULLIF(TRIM(source_path), ''), image_path) AS source_path,
                  NULLIF(TRIM(COALESCE(preview_path, preview_image_path, '')), '') AS preview_path
                FROM asset_items
                "#,
            )
            .map_err(|e| format!("Failed to prepare asset storage rewrite query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query assets for storage rewrite: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected
                .push(row.map_err(|e| format!("Failed to read asset storage rewrite row: {}", e))?);
        }
        collected
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin storage media rewrite transaction: {}", e))?;
    let mut changed_any = false;

    for (project_id, nodes_json, history_json) in project_rows {
        let Some((next_nodes_json, next_history_json)) =
            rewrite_project_payload_media_paths(&nodes_json, &history_json, &|value| {
                storage::rebase_storage_path_string(value, from_base, to_base)
            })?
        else {
            continue;
        };

        update_project_payload_in_tx(&tx, &project_id, &next_nodes_json, &next_history_json)?;
        changed_any = true;
    }

    for (asset_id, source_path, preview_path) in asset_rows {
        let next_source_path =
            storage::rebase_storage_path_string(&source_path, from_base, to_base)
                .unwrap_or_else(|| source_path.clone());
        let next_preview_path = preview_path
            .as_deref()
            .and_then(|value| storage::rebase_storage_path_string(value, from_base, to_base))
            .or_else(|| preview_path.clone());

        if next_source_path == source_path && next_preview_path == preview_path {
            continue;
        }

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
            params![asset_id, next_source_path, next_preview_path],
        )
        .map_err(|e| format!("Failed to update asset storage paths: {}", e))?;

        replace_asset_image_refs_in_tx(
            &tx,
            &asset_id,
            &next_source_path,
            next_preview_path.as_deref(),
        )?;
        changed_any = true;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit storage media rewrite transaction: {}", e))?;
    Ok(changed_any)
}

pub(crate) fn prune_unreferenced_images(app: &AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    let mut referenced = HashSet::new();
    for table_name in ["project_image_refs", "asset_image_refs"] {
        let query = format!("SELECT DISTINCT path FROM {}", table_name);
        let mut stmt = conn
            .prepare(&query)
            .map_err(|e| format!("Failed to prepare image refs query: {}", e))?;

        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query image refs: {}", e))?;

        for path_result in rows {
            let path = path_result.map_err(|e| format!("Failed to decode image ref row: {}", e))?;
            if let Some(normalized_path) = normalize_image_ref_path(&path) {
                referenced.insert(normalized_path);
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT nodes_json, history_json FROM projects")
        .map_err(|e| format!("Failed to prepare project image scan query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query project payloads for image scan: {}", e))?;

    for row in rows {
        let (nodes_json, history_json) =
            row.map_err(|e| format!("Failed to read project payload for image scan: {}", e))?;
        referenced.extend(extract_project_image_paths(&nodes_json, &history_json));
    }

    let images_dir = resolve_images_dir(app)?;
    let entries =
        std::fs::read_dir(&images_dir).map_err(|e| format!("Failed to read images dir: {}", e))?;

    for entry_result in entries {
        let entry = entry_result.map_err(|e| format!("Failed to iterate images dir: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let path_string = path.to_string_lossy().to_string();
        let normalized_path =
            normalize_image_ref_path(&path_string).unwrap_or_else(|| path_string.clone());
        if !referenced.contains(&normalized_path) {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete unreferenced image: {}", e))?;
        }
    }

    Ok(())
}

pub(crate) fn replace_project_image_refs(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    nodes_json: &str,
    history_json: &str,
) -> Result<(), String> {
    let image_paths = extract_project_image_paths(nodes_json, history_json);
    tx.execute(
        "DELETE FROM project_image_refs WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| format!("Failed to clear project image refs: {}", e))?;

    for path in image_paths {
        let Some(normalized_path) = normalize_image_ref_path(&path) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO project_image_refs (project_id, path) VALUES (?1, ?2)",
            params![project_id, normalized_path],
        )
        .map_err(|e| format!("Failed to upsert project image ref: {}", e))?;
    }

    Ok(())
}

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal_mode=WAL: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to set synchronous=NORMAL: {}", e))?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .map_err(|e| format!("Failed to set temp_store=MEMORY: {}", e))?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    ensure_projects_table(&conn)?;
    Ok(conn)
}

#[tauri::command]
pub fn list_project_summaries(app: AppHandle) -> Result<Vec<ProjectSummaryRecord>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              name,
              COALESCE(project_type, 'storyboard') as project_type,
              asset_library_id,
              created_at,
              updated_at,
              node_count
            FROM projects
            ORDER BY updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare list summaries query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectSummaryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                project_type: row.get(2)?,
                asset_library_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                node_count: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query project summaries: {}", e))?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| format!("Failed to decode summary row: {}", e))?);
    }
    Ok(projects)
}

#[tauri::command]
pub fn get_project_record(
    app: AppHandle,
    project_id: String,
) -> Result<Option<ProjectRecord>, String> {
    let mut conn = open_db(&app)?;
    let result = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT
                  id,
                  name,
                  COALESCE(project_type, 'storyboard') as project_type,
                  asset_library_id,
                  created_at,
                  updated_at,
                  node_count,
                  nodes_json,
                  edges_json,
                  viewport_json,
                  history_json,
                  color_labels_json
                FROM projects
                WHERE id = ?1
                LIMIT 1
                "#,
            )
            .map_err(|e| format!("Failed to prepare get project query: {}", e))?;

        stmt.query_row(params![project_id], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                project_type: row.get(2)?,
                asset_library_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                node_count: row.get(6)?,
                nodes_json: row.get(7)?,
                edges_json: row.get(8)?,
                viewport_json: row.get(9)?,
                history_json: row.get(10)?,
                color_labels_json: row.get(11)?,
            })
        })
    };

    match result {
        Ok(mut record) => {
            repair_project_record_storage_aliases_if_needed(&mut conn, &app, &mut record)?;
            Ok(Some(record))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project: {}", error)),
    }
}

#[tauri::command]
pub fn upsert_project_record(app: AppHandle, mut record: ProjectRecord) -> Result<(), String> {
    let images_dir = resolve_images_dir(&app)?;
    if let Some((next_nodes_json, next_history_json)) =
        rewrite_project_payload_media_paths(&record.nodes_json, &record.history_json, &|value| {
            storage::relocate_storage_path_to_images_dir(value, &images_dir)
        })?
    {
        record.nodes_json = next_nodes_json;
        record.history_json = next_history_json;
    }

    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    tx.execute(
        r#"
        INSERT INTO projects (
          id,
          name,
          project_type,
          asset_library_id,
          created_at,
          updated_at,
          node_count,
          nodes_json,
          edges_json,
          viewport_json,
          history_json,
          color_labels_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          project_type = excluded.project_type,
          asset_library_id = excluded.asset_library_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          node_count = excluded.node_count,
          nodes_json = excluded.nodes_json,
          edges_json = excluded.edges_json,
          viewport_json = excluded.viewport_json,
          history_json = excluded.history_json,
          color_labels_json = excluded.color_labels_json
        "#,
        params![
            record.id,
            record.name,
            record.project_type,
            record.asset_library_id,
            record.created_at,
            record.updated_at,
            record.node_count,
            record.nodes_json,
            record.edges_json,
            record.viewport_json,
            record.history_json,
            record.color_labels_json,
        ],
    )
    .map_err(|e| format!("Failed to upsert project: {}", e))?;

    replace_project_image_refs(&tx, &record.id, &record.nodes_json, &record.history_json)?;

    tx.commit()
        .map_err(|e| format!("Failed to commit upsert transaction: {}", e))?;

    prune_unreferenced_images(&app)?;
    Ok(())
}

#[tauri::command]
pub fn update_project_viewport_record(
    app: AppHandle,
    project_id: String,
    viewport_json: String,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "UPDATE projects SET viewport_json = ?1 WHERE id = ?2",
        params![viewport_json, project_id],
    )
    .map_err(|e| format!("Failed to update project viewport: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn rename_project_record(
    app: AppHandle,
    project_id: String,
    name: String,
    updated_at: i64,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, updated_at, project_id],
    )
    .map_err(|e| format!("Failed to rename project: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_project_record(app: AppHandle, project_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin delete transaction: {}", e))?;

    tx.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;
    tx.execute(
        "DELETE FROM project_image_refs WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| format!("Failed to delete project image refs: {}", e))?;
    tx.execute(
        "DELETE FROM jimeng_video_queue_jobs WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| format!("Failed to delete Jimeng queue jobs: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit delete transaction: {}", e))?;

    prune_unreferenced_images(&app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::storage;
    use super::{
        ensure_projects_table, extract_project_image_paths, normalize_image_ref_path,
        rewrite_project_payload_media_paths,
    };
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn ensure_projects_table_migrates_legacy_projects_before_creating_indexes() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              node_count INTEGER NOT NULL DEFAULT 0,
              nodes_json TEXT NOT NULL,
              edges_json TEXT NOT NULL,
              viewport_json TEXT NOT NULL,
              history_json TEXT NOT NULL,
              project_type TEXT NOT NULL DEFAULT 'storyboard'
            );
            INSERT INTO projects (
              id,
              name,
              created_at,
              updated_at,
              node_count,
              nodes_json,
              edges_json,
              viewport_json,
              history_json,
              project_type
            )
            VALUES (
              'legacy-project',
              'Legacy',
              1,
              2,
              0,
              '[]',
              '[]',
              '{}',
              '{"past":[],"future":[]}',
              'storyboard'
            );
            "#,
        )
        .expect("failed to seed legacy schema");

        ensure_projects_table(&conn).expect("legacy schema migration should succeed");

        let has_asset_library_id: bool = conn
            .prepare("PRAGMA table_info(projects)")
            .expect("failed to prepare pragma")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("failed to read pragma rows")
            .flatten()
            .any(|column_name| column_name == "asset_library_id");
        let has_color_labels_json: bool = conn
            .prepare("PRAGMA table_info(projects)")
            .expect("failed to prepare pragma")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("failed to read pragma rows")
            .flatten()
            .any(|column_name| column_name == "color_labels_json");
        assert!(
            has_asset_library_id,
            "asset_library_id should be added for legacy projects"
        );
        assert!(
            has_color_labels_json,
            "color_labels_json should be added for legacy projects"
        );

        let legacy_project_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM projects WHERE id = 'legacy-project'",
                [],
                |row| row.get(0),
            )
            .expect("failed to count legacy project");
        assert_eq!(
            legacy_project_count, 1,
            "existing projects should remain readable"
        );
    }

    #[test]
    fn normalize_image_ref_path_treats_windows_separator_variants_as_same_path() {
        let backslash = normalize_image_ref_path(r"C:\Users\Tester\images\frame.png")
            .expect("backslash path should normalize");
        let slash = normalize_image_ref_path("C:/Users/Tester/images/frame.png")
            .expect("slash path should normalize");

        assert_eq!(backslash, slash);
    }

    #[test]
    fn extract_project_image_paths_normalizes_frame_paths_from_image_pool() {
        let nodes_json = r#"
        [
          {
            "id": "split-node",
            "type": "storyboardNode",
            "data": {
              "frames": [
                {
                  "id": "frame-1",
                  "imageUrl": "__img_ref__:0",
                  "previewImageUrl": "__img_ref__:1"
                }
              ]
            }
          }
        ]
        "#;
        let history_json = r#"
        {
          "past": [],
          "future": [],
          "imagePool": [
            "C:\\Users\\Tester\\images\\frame-1.png",
            "C:/Users/Tester/images/frame-1-preview.png"
          ]
        }
        "#;

        let paths = extract_project_image_paths(nodes_json, history_json);

        assert!(paths.contains(
            normalize_image_ref_path(r"C:\Users\Tester\images\frame-1.png")
                .expect("frame image path should normalize")
                .as_str()
        ));
        assert!(paths.contains(
            normalize_image_ref_path("C:/Users/Tester/images/frame-1-preview.png")
                .expect("frame preview path should normalize")
                .as_str()
        ));
    }

    #[test]
    fn extract_project_image_paths_supports_nodes_payload_image_pool_and_node_patch_history() {
        let nodes_json = r#"
        {
          "nodes": [
            {
              "id": "image-node",
              "type": "image",
              "data": {
                "imageUrl": "__img_ref__:0"
              }
            }
          ],
          "imagePool": [
            "C:\\Users\\Tester\\images\\current.png",
            "C:/Users/Tester/images/undo-preview.png"
          ]
        }
        "#;
        let history_json = r#"
        {
          "past": [
            {
              "kind": "nodePatch",
              "entries": [
                {
                  "nodeId": "image-node",
                  "node": {
                    "id": "image-node",
                    "type": "image",
                    "data": {
                      "previewImageUrl": "__img_ref__:1"
                    }
                  }
                }
              ]
            }
          ],
          "future": []
        }
        "#;

        let paths = extract_project_image_paths(nodes_json, history_json);

        assert!(paths.contains(
            normalize_image_ref_path(r"C:\Users\Tester\images\current.png")
                .expect("current image path should normalize")
                .as_str()
        ));
        assert!(paths.contains(
            normalize_image_ref_path("C:/Users/Tester/images/undo-preview.png")
                .expect("patch history image path should normalize")
                .as_str()
        ));
    }

    #[test]
    fn rewrite_project_payload_media_paths_updates_image_pool_and_result_media() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-project-rewrite-test-{}",
            std::process::id()
        ));
        let images_dir = temp_root.join("images");
        fs::create_dir_all(&images_dir).expect("failed to create images dir");
        let relocated_video = images_dir.join("clip.mp4");
        let relocated_poster = images_dir.join("poster.png");
        fs::write(&relocated_video, b"video").expect("failed to write video fixture");
        fs::write(&relocated_poster, b"poster").expect("failed to write poster fixture");

        let nodes_json = r#"
        {
          "nodes": [
            {
              "id": "video-node",
              "type": "jimengVideoResult",
              "data": {
                "resultImages": [
                  {
                    "videoUrl": "C:/legacy-storage/images/clip.mp4",
                    "posterSourceUrl": "C:/legacy-storage/images/poster.png"
                  }
                ]
              }
            }
          ],
          "imagePool": [
            "C:/legacy-storage/images/poster.png"
          ]
        }
        "#;
        let history_json = r#"{"past":[],"future":[]}"#;

        let rewritten = rewrite_project_payload_media_paths(nodes_json, history_json, &|value| {
            storage::relocate_storage_path_to_images_dir(value, &images_dir)
        })
        .expect("rewrite should succeed")
        .expect("payload should change");

        assert!(rewritten
            .0
            .contains(&relocated_video.to_string_lossy().replace('\\', "/")));
        assert!(rewritten
            .0
            .contains(&relocated_poster.to_string_lossy().replace('\\', "/")));

        let _ = fs::remove_dir_all(temp_root);
    }
}
