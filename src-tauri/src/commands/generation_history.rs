use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use uuid::Uuid;

use super::{
    project_state::{open_db, ProjectSummaryRecord},
    storage,
};

const GENERATION_HISTORY_TABLE: &str = "generation_history_items";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryItemRecord {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub media_type: String,
    pub source_path: String,
    pub preview_path: Option<String>,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: Option<String>,
    pub duration_ms: Option<i64>,
    pub aspect_ratio: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub indexed_at: i64,
    pub snapshot_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryProjectGroup {
    pub project_id: String,
    pub project_name: String,
    pub updated_at: i64,
    pub items: Vec<GenerationHistoryItemRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistorySnapshot {
    pub groups: Vec<GenerationHistoryProjectGroup>,
    pub total_count: usize,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryScanResult {
    pub scanned_count: usize,
    pub removed_count: usize,
    pub snapshot: GenerationHistorySnapshot,
}

#[derive(Debug, Clone)]
struct ProjectScanTarget {
    project_id: String,
    project_name: String,
    root: PathBuf,
}

#[derive(Debug, Clone)]
struct ScannedMediaItem {
    project_id: String,
    project_name: String,
    media_type: String,
    source_path: String,
    preview_path: Option<String>,
    file_name: String,
    file_size: i64,
    mime_type: Option<String>,
    duration_ms: Option<i64>,
    aspect_ratio: String,
    created_at: i64,
    modified_at: i64,
    snapshot_json: String,
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn system_time_to_ms(value: SystemTime) -> i64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_optional_project_id(project_id: Option<String>) -> Option<String> {
    project_id.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn read_table_columns(conn: &Connection, table_name: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|e| format!("Failed to inspect {table_name} schema: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect {table_name} columns: {}", e))?;

    let mut columns = HashSet::new();
    for name_result in rows {
        columns.insert(
            name_result.map_err(|e| format!("Failed to read {table_name} column name: {}", e))?,
        );
    }
    Ok(columns)
}

fn ensure_table_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let columns = read_table_columns(conn, table_name)?;
    if columns.contains(column_name) {
        return Ok(());
    }

    let statement =
        format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    conn.execute(&statement, [])
        .map_err(|e| format!("Failed to add {table_name}.{column_name} column: {}", e))?;
    Ok(())
}

fn ensure_generation_history_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        r#"
        CREATE TABLE IF NOT EXISTS generation_history_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT '',
          project_name TEXT NOT NULL DEFAULT '',
          media_type TEXT NOT NULL DEFAULT 'image',
          source_path TEXT NOT NULL DEFAULT '',
          preview_path TEXT,
          file_name TEXT NOT NULL DEFAULT '',
          file_size INTEGER NOT NULL DEFAULT 0,
          mime_type TEXT,
          duration_ms INTEGER,
          aspect_ratio TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT 0,
          modified_at INTEGER NOT NULL DEFAULT 0,
          indexed_at INTEGER NOT NULL DEFAULT 0,
          snapshot_json TEXT NOT NULL DEFAULT '{}'
        )
        "#,
        [],
    )
    .map_err(|e| format!("Failed to ensure generation history table: {}", e))?;

    for (column, definition) in [
        ("project_id", "TEXT NOT NULL DEFAULT ''"),
        ("project_name", "TEXT NOT NULL DEFAULT ''"),
        ("media_type", "TEXT NOT NULL DEFAULT 'image'"),
        ("source_path", "TEXT NOT NULL DEFAULT ''"),
        ("preview_path", "TEXT"),
        ("file_name", "TEXT NOT NULL DEFAULT ''"),
        ("file_size", "INTEGER NOT NULL DEFAULT 0"),
        ("mime_type", "TEXT"),
        ("duration_ms", "INTEGER"),
        ("aspect_ratio", "TEXT NOT NULL DEFAULT ''"),
        ("created_at", "INTEGER NOT NULL DEFAULT 0"),
        ("modified_at", "INTEGER NOT NULL DEFAULT 0"),
        ("indexed_at", "INTEGER NOT NULL DEFAULT 0"),
        ("snapshot_json", "TEXT NOT NULL DEFAULT '{}'"),
    ] {
        ensure_table_column(conn, GENERATION_HISTORY_TABLE, column, definition)?;
    }

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_generation_history_project_modified
          ON generation_history_items(project_id, modified_at DESC);
        CREATE INDEX IF NOT EXISTS idx_generation_history_source_path
          ON generation_history_items(source_path);
        "#,
    )
    .map_err(|e| format!("Failed to ensure generation history indexes: {}", e))?;
    Ok(())
}

fn load_project_summaries(conn: &Connection) -> Result<Vec<ProjectSummaryRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              name,
              project_type,
              asset_library_id,
              clip_library_id,
              clip_last_folder_id,
              linked_script_project_id,
              linked_ad_project_id,
              created_at,
              updated_at,
              node_count
            FROM projects
            ORDER BY updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare project summary query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectSummaryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                project_type: row.get(2)?,
                asset_library_id: row.get(3)?,
                clip_library_id: row.get(4)?,
                clip_last_folder_id: row.get(5)?,
                linked_script_project_id: row.get(6)?,
                linked_ad_project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                node_count: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to query project summaries: {}", e))?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| format!("Failed to read project summary: {}", e))?);
    }
    Ok(projects)
}

fn resolve_project_media_dir_name(project_id: &str, project_name: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let project_id_part = project_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    if !project_id_part.is_empty() {
        candidates.push(project_id_part.clone());
    }

    let short_id = project_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>();
    let mut name_part = String::new();
    let mut previous_separator = false;
    for ch in project_name.trim().chars() {
        let next = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            ch if ch.is_control() || ch.is_whitespace() => '-',
            ch => ch,
        };
        if next == '-' || next == '_' || next == '.' {
            if previous_separator {
                continue;
            }
            previous_separator = true;
        } else {
            previous_separator = false;
        }
        name_part.push(next);
    }
    let name_part = name_part
        .trim_matches(|ch| ch == '-' || ch == '_' || ch == '.' || ch == ' ')
        .chars()
        .take(48)
        .collect::<String>();
    if !name_part.is_empty() && !short_id.is_empty() {
        candidates.push(format!("{name_part}-{short_id}"));
    } else if !name_part.is_empty() {
        candidates.push(name_part);
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.to_ascii_lowercase()))
        .collect()
}

fn resolve_project_scan_targets(
    app: &AppHandle,
    conn: &Connection,
    project_id: Option<&str>,
) -> Result<Vec<ProjectScanTarget>, String> {
    let base_path = storage::resolve_storage_base_path(app)?;
    let projects_root = base_path.join("projects");
    let projects = load_project_summaries(conn)?;
    let project_dirs = fs::read_dir(&projects_root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    let mut targets = Vec::new();
    let mut matched_roots = HashSet::new();

    for project in projects {
        if project_id.is_some_and(|target_id| target_id != project.id) {
            continue;
        }

        let candidate_names = resolve_project_media_dir_name(&project.id, &project.name)
            .into_iter()
            .map(|value| value.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let short_id = project
            .id
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>()
            .to_ascii_lowercase();
        let matched_root = project_dirs.iter().find(|root| {
            let name = root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            candidate_names.contains(&name)
                || (!short_id.is_empty() && name.ends_with(&format!("-{short_id}")))
        });

        if let Some(root) = matched_root {
            matched_roots.insert(root.to_string_lossy().replace('\\', "/").to_ascii_lowercase());
            targets.push(ProjectScanTarget {
                project_id: project.id.clone(),
                project_name: project.name.clone(),
                root: root.clone(),
            });
        }
    }

    if project_id.is_none() {
        for root in project_dirs {
            let compare_key = root.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
            if matched_roots.contains(&compare_key) {
                continue;
            }
            let Some(dir_name) = root.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            targets.push(ProjectScanTarget {
                project_id: format!("__dir__:{dir_name}"),
                project_name: dir_name.to_string(),
                root,
            });
        }
    }

    Ok(targets)
}

fn is_hidden_or_temp_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || lower.ends_with(".tmp")
        || lower.ends_with(".temp")
        || lower.ends_with(".part")
        || lower.ends_with(".download")
}

fn is_supported_media_file(path: &Path, media_type: &str) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match media_type {
        "video" => matches!(
            extension.as_str(),
            "mp4" | "webm" | "ogv" | "mov" | "avi" | "mkv"
        ),
        "audio" => matches!(
            extension.as_str(),
            "mp3" | "wav" | "ogg" | "oga" | "m4a" | "aac" | "flac" | "webm"
        ),
        _ => matches!(
            extension.as_str(),
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "avif"
        ),
    }
}

fn infer_mime_type(path: &Path, media_type: &str) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "avif" => "image/avif",
        "mp4" if media_type == "video" => "video/mp4",
        "webm" if media_type == "video" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "webm" if media_type == "audio" => "audio/webm",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        _ => return None,
    };
    Some(mime.to_string())
}

fn image_dimensions(path: &Path) -> Option<(u32, u32)> {
    image::image_dimensions(path).ok()
}

fn reduce_aspect_ratio(width: u32, height: u32) -> String {
    fn gcd(mut a: u32, mut b: u32) -> u32 {
        while b != 0 {
            let next = a % b;
            a = b;
            b = next;
        }
        a.max(1)
    }

    if width == 0 || height == 0 {
        return "1:1".to_string();
    }
    let divisor = gcd(width, height);
    format!("{}:{}", width / divisor, height / divisor)
}

fn find_preview_for_video(project_root: &Path, source_path: &Path) -> Option<String> {
    let stem = source_path.file_stem().and_then(|value| value.to_str())?;
    let preview_dir = project_root.join("images").join("previews");
    if !preview_dir.is_dir() {
        return None;
    }

    for extension in ["jpg", "jpeg", "png", "webp"] {
        let candidate = preview_dir.join(format!("{stem}.{extension}"));
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn scan_media_dir(
    target: &ProjectScanTarget,
    dir: &Path,
    media_type: &str,
    now: i64,
) -> Result<Vec<ScannedMediaItem>, String> {
    let mut results = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(results);
    };

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read generation history dir: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            if path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with('.') || name.eq_ignore_ascii_case("thumbnail"))
            {
                continue;
            }
            results.extend(scan_media_dir(target, &path, media_type, now)?);
            continue;
        }

        if is_hidden_or_temp_file(&path) || !is_supported_media_file(&path, media_type) {
            continue;
        }

        let metadata = fs::metadata(&path)
            .map_err(|e| format!("Failed to inspect media file {}: {}", path.display(), e))?;
        if !metadata.is_file() || metadata.len() == 0 {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media")
            .to_string();
        let modified_at = metadata.modified().map(system_time_to_ms).unwrap_or(now);
        let created_at = metadata
            .created()
            .map(system_time_to_ms)
            .unwrap_or(modified_at);
        let source_path = path.to_string_lossy().to_string();
        let preview_path = if media_type == "video" {
            find_preview_for_video(&target.root, &path)
        } else {
            None
        };
        let aspect_ratio = if media_type == "image" {
            image_dimensions(&path)
                .map(|(width, height)| reduce_aspect_ratio(width, height))
                .unwrap_or_else(|| "1:1".to_string())
        } else {
            String::new()
        };
        let snapshot_json = json!({
            "source": "projectMediaScan",
            "projectId": target.project_id,
            "mediaType": media_type,
            "sourcePath": source_path,
            "previewPath": preview_path,
        })
        .to_string();

        results.push(ScannedMediaItem {
            project_id: target.project_id.clone(),
            project_name: target.project_name.clone(),
            media_type: media_type.to_string(),
            source_path,
            preview_path,
            file_name,
            file_size: metadata.len() as i64,
            mime_type: infer_mime_type(&path, media_type),
            duration_ms: None,
            aspect_ratio,
            created_at,
            modified_at,
            snapshot_json,
        });
    }

    Ok(results)
}

fn scan_project_target(
    target: &ProjectScanTarget,
    now: i64,
) -> Result<Vec<ScannedMediaItem>, String> {
    let mut results = Vec::new();
    results.extend(scan_media_dir(
        target,
        &target.root.join("images").join("originals"),
        "image",
        now,
    )?);
    results.extend(scan_media_dir(target, &target.root.join("videos"), "video", now)?);
    results.extend(scan_media_dir(target, &target.root.join("audio"), "audio", now)?);
    Ok(results)
}

fn upsert_scanned_items(
    app: &AppHandle,
    conn: &mut Connection,
    targets: &[ProjectScanTarget],
    items: &[ScannedMediaItem],
    now: i64,
) -> Result<usize, String> {
    ensure_generation_history_table(conn)?;
    let target_project_ids = targets
        .iter()
        .map(|target| target.project_id.clone())
        .collect::<HashSet<_>>();
    let target_source_paths = items
        .iter()
        .map(|item| storage::encode_storage_media_ref(app, &item.source_path))
        .collect::<HashSet<_>>();

    let existing_rows: Vec<(String, String, String)> = if target_project_ids.is_empty() {
        Vec::new()
    } else {
        let mut stmt = conn
            .prepare("SELECT id, project_id, source_path FROM generation_history_items")
            .map_err(|e| format!("Failed to prepare generation history cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query generation history cleanup rows: {}", e))?;
        let mut collected = Vec::new();
        for row in rows {
            let row = row.map_err(|e| format!("Failed to read generation history cleanup row: {}", e))?;
            collected.push(row);
        }
        collected
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin generation history transaction: {}", e))?;
    for item in items {
        let persisted_source_path = storage::encode_storage_media_ref(app, &item.source_path);
        let persisted_preview_path = item
            .preview_path
            .as_deref()
            .map(|value| storage::encode_storage_media_ref(app, value));
        let existing_id = tx
            .query_row(
                "SELECT id FROM generation_history_items WHERE source_path = ?1 LIMIT 1",
                params![persisted_source_path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to find existing generation history item: {}", e))?;

        if let Some(existing_id) = existing_id {
            tx.execute(
                r#"
                UPDATE generation_history_items
                SET
                  project_id = ?2,
                  project_name = ?3,
                  media_type = ?4,
                  source_path = ?5,
                  preview_path = ?6,
                  file_name = ?7,
                  file_size = ?8,
                  mime_type = ?9,
                  duration_ms = ?10,
                  aspect_ratio = ?11,
                  created_at = ?12,
                  modified_at = ?13,
                  indexed_at = ?14,
                  snapshot_json = ?15
                WHERE id = ?1
                "#,
                params![
                    existing_id,
                    item.project_id,
                    item.project_name,
                    item.media_type,
                    persisted_source_path,
                    persisted_preview_path,
                    item.file_name,
                    item.file_size,
                    item.mime_type,
                    item.duration_ms,
                    item.aspect_ratio,
                    item.created_at,
                    item.modified_at,
                    now,
                    item.snapshot_json,
                ],
            )
            .map_err(|e| format!("Failed to update generation history item: {}", e))?;
        } else {
            tx.execute(
                r#"
                INSERT INTO generation_history_items (
                  id,
                  project_id,
                  project_name,
                  media_type,
                  source_path,
                  preview_path,
                  file_name,
                  file_size,
                  mime_type,
                  duration_ms,
                  aspect_ratio,
                  created_at,
                  modified_at,
                  indexed_at,
                  snapshot_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    item.project_id,
                    item.project_name,
                    item.media_type,
                    persisted_source_path,
                    persisted_preview_path,
                    item.file_name,
                    item.file_size,
                    item.mime_type,
                    item.duration_ms,
                    item.aspect_ratio,
                    item.created_at,
                    item.modified_at,
                    now,
                    item.snapshot_json,
                ],
            )
            .map_err(|e| format!("Failed to insert generation history item: {}", e))?;
        }
    }

    let mut removed_count = 0;
    for (item_id, row_project_id, source_path) in existing_rows {
        if !target_project_ids.contains(&row_project_id) {
            continue;
        }
        if target_source_paths.contains(&source_path) {
            continue;
        }
        tx.execute(
            "DELETE FROM generation_history_items WHERE id = ?1",
            params![item_id],
        )
        .map_err(|e| format!("Failed to remove stale generation history item: {}", e))?;
        removed_count += 1;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit generation history transaction: {}", e))?;
    Ok(removed_count)
}

fn read_generation_history_items(
    conn: &Connection,
    app: &AppHandle,
    project_id: Option<&str>,
) -> Result<Vec<GenerationHistoryItemRecord>, String> {
    ensure_generation_history_table(conn)?;

    let sql = if project_id.is_some() {
        r#"
        SELECT
          id,
          project_id,
          project_name,
          media_type,
          source_path,
          preview_path,
          file_name,
          file_size,
          mime_type,
          duration_ms,
          aspect_ratio,
          created_at,
          modified_at,
          indexed_at,
          snapshot_json
        FROM generation_history_items
        WHERE project_id = ?1
        ORDER BY modified_at DESC, indexed_at DESC
        "#
    } else {
        r#"
        SELECT
          id,
          project_id,
          project_name,
          media_type,
          source_path,
          preview_path,
          file_name,
          file_size,
          mime_type,
          duration_ms,
          aspect_ratio,
          created_at,
          modified_at,
          indexed_at,
          snapshot_json
        FROM generation_history_items
        ORDER BY modified_at DESC, indexed_at DESC
        "#
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("Failed to prepare generation history list query: {}", e))?;
    let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<GenerationHistoryItemRecord> {
        Ok(GenerationHistoryItemRecord {
            id: row.get(0)?,
            project_id: row.get(1)?,
            project_name: row.get(2)?,
            media_type: row.get(3)?,
            source_path: row.get(4)?,
            preview_path: row.get(5)?,
            file_name: row.get(6)?,
            file_size: row.get(7)?,
            mime_type: row.get(8)?,
            duration_ms: row.get(9)?,
            aspect_ratio: row.get(10)?,
            created_at: row.get(11)?,
            modified_at: row.get(12)?,
            indexed_at: row.get(13)?,
            snapshot_json: row.get(14)?,
        })
    };

    let rows = if let Some(project_id) = project_id {
        stmt.query_map(params![project_id], map_row)
            .map_err(|e| format!("Failed to query generation history: {}", e))?
    } else {
        stmt.query_map([], map_row)
            .map_err(|e| format!("Failed to query generation history: {}", e))?
    };

    let mut items = Vec::new();
    for row in rows {
        let mut item = row.map_err(|e| format!("Failed to read generation history row: {}", e))?;
        item.source_path = storage::decode_storage_media_ref(app, &item.source_path);
        item.preview_path = item
            .preview_path
            .as_deref()
            .map(|value| storage::decode_storage_media_ref(app, value));
        items.push(item);
    }
    Ok(items)
}

fn build_generation_history_snapshot(
    conn: &Connection,
    app: &AppHandle,
    project_id: Option<&str>,
) -> Result<GenerationHistorySnapshot, String> {
    let items = read_generation_history_items(conn, app, project_id)?;
    let projects = load_project_summaries(conn)?
        .into_iter()
        .map(|project| (project.id.clone(), project.updated_at))
        .collect::<HashMap<_, _>>();
    let total_count = items.len();
    let mut groups_by_project = HashMap::<String, GenerationHistoryProjectGroup>::new();

    for item in items {
        let updated_at = projects
            .get(&item.project_id)
            .copied()
            .unwrap_or(item.modified_at);
        let group = groups_by_project
            .entry(item.project_id.clone())
            .or_insert_with(|| GenerationHistoryProjectGroup {
                project_id: item.project_id.clone(),
                project_name: item.project_name.clone(),
                updated_at,
                items: Vec::new(),
            });
        group.updated_at = group.updated_at.max(item.modified_at).max(updated_at);
        group.items.push(item);
    }

    let mut groups = groups_by_project.into_values().collect::<Vec<_>>();
    groups.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));

    Ok(GenerationHistorySnapshot {
        groups,
        total_count,
        indexed_at: current_timestamp_ms(),
    })
}

fn open_directory_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder {}: {}", path.display(), e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder {}: {}", path.display(), e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder {}: {}", path.display(), e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn list_generation_history(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<GenerationHistorySnapshot, String> {
    let conn = open_db(&app)?;
    let project_id = normalize_optional_project_id(project_id);
    build_generation_history_snapshot(&conn, &app, project_id.as_deref())
}

#[tauri::command]
pub fn scan_generation_history(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<GenerationHistoryScanResult, String> {
    let mut conn = open_db(&app)?;
    ensure_generation_history_table(&conn)?;
    let project_id = normalize_optional_project_id(project_id);
    let now = current_timestamp_ms();
    let targets = resolve_project_scan_targets(&app, &conn, project_id.as_deref())?;
    let mut scanned_items = Vec::new();

    for target in &targets {
        scanned_items.extend(scan_project_target(target, now)?);
    }

    let removed_count = upsert_scanned_items(&app, &mut conn, &targets, &scanned_items, now)?;
    let snapshot = build_generation_history_snapshot(&conn, &app, project_id.as_deref())?;

    Ok(GenerationHistoryScanResult {
        scanned_count: scanned_items.len(),
        removed_count,
        snapshot,
    })
}

#[tauri::command]
pub fn open_generation_history_item_in_folder(
    app: AppHandle,
    item_id: String,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_generation_history_table(&conn)?;
    let source_path: String = conn
        .query_row(
            "SELECT source_path FROM generation_history_items WHERE id = ?1 LIMIT 1",
            params![item_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to load generation history item: {}", e))?
        .ok_or_else(|| "Generation history item not found".to_string())?;
    let decoded_source_path = storage::decode_storage_media_ref(&app, &source_path);
    let source_path = PathBuf::from(decoded_source_path);
    let folder = source_path
        .parent()
        .ok_or_else(|| "Generation history item has no parent folder".to_string())?;
    open_directory_in_file_manager(folder)
}
