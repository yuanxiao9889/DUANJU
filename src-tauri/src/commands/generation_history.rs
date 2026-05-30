use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use uuid::Uuid;

use super::{project_state::open_db, storage};

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryListPagePayload {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryProjectOption {
    pub project_id: String,
    pub project_name: String,
    pub count: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryListPageResult {
    pub items: Vec<GenerationHistoryItemRecord>,
    pub projects: Vec<GenerationHistoryProjectOption>,
    pub total_count: i64,
    pub limit: i64,
    pub offset: i64,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordGenerationOutputPayload {
    pub project_id: String,
    pub project_name: String,
    pub media_type: String,
    pub source_path: String,
    #[serde(default)]
    pub preview_path: Option<String>,
    pub file_name: String,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    #[serde(default)]
    pub snapshot_json: Option<String>,
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

fn normalize_optional_filter(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed == "all" {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_media_type_filter(value: Option<String>) -> Option<String> {
    normalize_optional_filter(value).filter(|value| {
        matches!(value.as_str(), "image" | "video" | "audio")
    })
}

fn clamp_page_limit(value: Option<i64>) -> i64 {
    value.unwrap_or(50).clamp(1, 100)
}

fn normalize_page_offset(value: Option<i64>) -> i64 {
    value.unwrap_or(0).max(0)
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

fn purge_legacy_generation_history_items(conn: &Connection) -> Result<(), String> {
    conn.execute(
        r#"
        DELETE FROM generation_history_items
        WHERE snapshot_json NOT LIKE '%canvasImageGeneration%'
          AND snapshot_json NOT LIKE '%generationOutputRecord%'
        "#,
        [],
    )
    .map_err(|e| format!("Failed to purge legacy generation history items: {}", e))?;
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
    purge_legacy_generation_history_items(conn)?;
    Ok(())
}

fn upsert_generation_history_item(
    app: &AppHandle,
    conn: &mut Connection,
    item: &ScannedMediaItem,
    now: i64,
) -> Result<(), String> {
    ensure_generation_history_table(conn)?;
    let persisted_source_path = storage::encode_storage_media_ref(app, &item.source_path);
    let persisted_preview_path = item
        .preview_path
        .as_deref()
        .map(|value| storage::encode_storage_media_ref(app, value));
    let existing_id = conn
        .query_row(
            "SELECT id FROM generation_history_items WHERE source_path = ?1 LIMIT 1",
            params![persisted_source_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to find existing generation history item: {}", e))?;

    if let Some(existing_id) = existing_id {
        conn.execute(
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
        conn.execute(
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

    Ok(())
}

fn decode_generation_history_item(app: &AppHandle, item: &mut GenerationHistoryItemRecord) {
    item.source_path = storage::decode_storage_media_ref(app, &item.source_path);
    item.preview_path = item
        .preview_path
        .as_deref()
        .map(|value| storage::decode_storage_media_ref(app, value));
}

fn read_generation_history_projects(
    conn: &Connection,
) -> Result<Vec<GenerationHistoryProjectOption>, String> {
    ensure_generation_history_table(conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              project_id,
              COALESCE(NULLIF(project_name, ''), project_id) AS project_name,
              COUNT(*) AS item_count,
              MAX(modified_at) AS updated_at
            FROM generation_history_items
            WHERE (
              snapshot_json LIKE '%canvasImageGeneration%'
              OR snapshot_json LIKE '%generationOutputRecord%'
            )
            GROUP BY project_id, project_name
            HAVING item_count > 0
            ORDER BY MAX(indexed_at) DESC, updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare generation history project query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(GenerationHistoryProjectOption {
                project_id: row.get(0)?,
                project_name: row.get(1)?,
                count: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query generation history projects: {}", e))?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(
            row.map_err(|e| format!("Failed to read generation history project row: {}", e))?,
        );
    }
    Ok(projects)
}

fn count_generation_history_items(
    conn: &Connection,
    project_id: Option<&str>,
    media_type: Option<&str>,
    search: Option<&str>,
) -> Result<i64, String> {
    ensure_generation_history_table(conn)?;
    let mut sql = String::from(
        "SELECT COUNT(*) FROM generation_history_items WHERE (snapshot_json LIKE '%canvasImageGeneration%' OR snapshot_json LIKE '%generationOutputRecord%')",
    );
    let mut params: Vec<String> = Vec::new();
    if let Some(project_id) = project_id {
        sql.push_str(" AND project_id = ?");
        params.push(project_id.to_string());
    }
    if let Some(media_type) = media_type {
        sql.push_str(" AND media_type = ?");
        params.push(media_type.to_string());
    }
    if let Some(search) = search {
        sql.push_str(
            " AND (LOWER(file_name) LIKE ? OR LOWER(project_name) LIKE ? OR LOWER(source_path) LIKE ?)",
        );
        let pattern = format!("%{}%", search.to_ascii_lowercase());
        params.push(pattern.clone());
        params.push(pattern.clone());
        params.push(pattern);
    }

    let refs = params.iter().map(|value| value as &dyn rusqlite::ToSql).collect::<Vec<_>>();
    conn.query_row(&sql, refs.as_slice(), |row| row.get(0))
        .map_err(|e| format!("Failed to count generation history items: {}", e))
}

fn list_generation_history_page_items(
    conn: &Connection,
    app: &AppHandle,
    project_id: Option<&str>,
    media_type: Option<&str>,
    search: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<GenerationHistoryItemRecord>, String> {
    ensure_generation_history_table(conn)?;
    let mut sql = String::from(
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
        WHERE (
          snapshot_json LIKE '%canvasImageGeneration%'
          OR snapshot_json LIKE '%generationOutputRecord%'
        )
        "#,
    );
    let mut params: Vec<String> = Vec::new();
    if let Some(project_id) = project_id {
        sql.push_str(" AND project_id = ?");
        params.push(project_id.to_string());
    }
    if let Some(media_type) = media_type {
        sql.push_str(" AND media_type = ?");
        params.push(media_type.to_string());
    }
    if let Some(search) = search {
        sql.push_str(
            " AND (LOWER(file_name) LIKE ? OR LOWER(project_name) LIKE ? OR LOWER(source_path) LIKE ?)",
        );
        let pattern = format!("%{}%", search.to_ascii_lowercase());
        params.push(pattern.clone());
        params.push(pattern.clone());
        params.push(pattern);
    }
    sql.push_str(" ORDER BY indexed_at DESC, modified_at DESC, created_at DESC LIMIT ? OFFSET ?");
    params.push(limit.to_string());
    params.push(offset.to_string());

    let refs = params.iter().map(|value| value as &dyn rusqlite::ToSql).collect::<Vec<_>>();
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare generation history page query: {}", e))?;
    let rows = stmt
        .query_map(refs.as_slice(), |row| {
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
        })
        .map_err(|e| format!("Failed to query generation history page: {}", e))?;

    let mut items = Vec::new();
    for row in rows {
        let mut item = row.map_err(|e| format!("Failed to read generation history row: {}", e))?;
        decode_generation_history_item(app, &mut item);
        items.push(item);
    }
    Ok(items)
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
pub fn list_generation_history_page(
    app: AppHandle,
    payload: GenerationHistoryListPagePayload,
) -> Result<GenerationHistoryListPageResult, String> {
    let conn = open_db(&app)?;
    let project_id = normalize_optional_filter(payload.project_id);
    let media_type = normalize_media_type_filter(payload.media_type);
    let search = normalize_optional_filter(payload.search);
    let limit = clamp_page_limit(payload.limit);
    let offset = normalize_page_offset(payload.offset);
    let total_count = count_generation_history_items(
        &conn,
        project_id.as_deref(),
        media_type.as_deref(),
        search.as_deref(),
    )?;
    let items = list_generation_history_page_items(
        &conn,
        &app,
        project_id.as_deref(),
        media_type.as_deref(),
        search.as_deref(),
        limit,
        offset,
    )?;
    let projects = read_generation_history_projects(&conn)?;

    Ok(GenerationHistoryListPageResult {
        items,
        projects,
        total_count,
        limit,
        offset,
        indexed_at: current_timestamp_ms(),
    })
}

#[tauri::command]
pub fn get_generation_history_count(app: AppHandle) -> Result<i64, String> {
    let conn = open_db(&app)?;
    count_generation_history_items(&conn, None, None, None)
}

#[tauri::command]
pub fn record_generation_output(
    app: AppHandle,
    payload: RecordGenerationOutputPayload,
) -> Result<GenerationHistoryItemRecord, String> {
    let mut conn = open_db(&app)?;
    let now = current_timestamp_ms();
    let normalized_source_path = storage::decode_storage_media_ref(&app, payload.source_path.trim());
    if normalized_source_path.trim().is_empty() {
        return Err("Generation output source path is required".to_string());
    }
    let source_path = PathBuf::from(&normalized_source_path);
    let metadata = fs::metadata(&source_path).ok();
    let file_size = metadata.as_ref().map(|value| value.len() as i64).unwrap_or(0);
    let modified_at = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .map(system_time_to_ms)
        .unwrap_or(now);
    let created_at = metadata
        .as_ref()
        .and_then(|value| value.created().ok())
        .map(system_time_to_ms)
        .unwrap_or(modified_at);
    let file_name = if payload.file_name.trim().is_empty() {
        source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("generation-output")
            .to_string()
    } else {
        payload.file_name.trim().to_string()
    };
    let media_type = match payload.media_type.trim() {
        "video" => "video",
        "audio" => "audio",
        _ => "image",
    };
    let aspect_ratio = payload
        .aspect_ratio
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(if media_type == "video" { "16:9" } else { "1:1" })
        .to_string();
    let preview_path = payload
        .preview_path
        .map(|value| storage::decode_storage_media_ref(&app, value.trim()));
    let snapshot_project_id = payload.project_id.clone();
    let snapshot_source_path = normalized_source_path.clone();
    let snapshot_preview_path = preview_path.clone();
    let snapshot_json = payload.snapshot_json.unwrap_or_else(|| {
        json!({
            "source": "generationOutputRecord",
            "projectId": snapshot_project_id,
            "mediaType": media_type,
            "sourcePath": snapshot_source_path,
            "previewPath": snapshot_preview_path,
        })
        .to_string()
    });

    let item = ScannedMediaItem {
        project_id: payload.project_id.trim().to_string(),
        project_name: payload.project_name.trim().to_string(),
        media_type: media_type.to_string(),
        source_path: normalized_source_path,
        preview_path,
        file_name,
        file_size,
        mime_type: payload.mime_type,
        duration_ms: payload.duration_ms,
        aspect_ratio,
        created_at,
        modified_at,
        snapshot_json,
    };

    upsert_generation_history_item(&app, &mut conn, &item, now)?;
    let saved = list_generation_history_page_items(
        &conn,
        &app,
        Some(&item.project_id),
        Some(&item.media_type),
        Some(&item.file_name),
        1,
        0,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| "Failed to reload generation history item".to_string())?;
    Ok(saved)
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
