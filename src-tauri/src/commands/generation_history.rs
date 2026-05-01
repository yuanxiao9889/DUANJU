use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::project_state::{normalize_image_ref_path, open_db, prune_unreferenced_images};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationHistoryItemRecord {
    pub id: String,
    pub project_id: String,
    pub media_type: String,
    pub node_type: String,
    pub title: String,
    pub snapshot_json: String,
    pub source_path: String,
    #[serde(default)]
    pub preview_path: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn ensure_generation_history_table(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS generation_history_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          node_type TEXT NOT NULL,
          title TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          source_path TEXT NOT NULL,
          preview_path TEXT,
          mime_type TEXT,
          duration_ms INTEGER,
          aspect_ratio TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_generation_history_project_id
          ON generation_history_items(project_id, created_at DESC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_generation_history_source_path
          ON generation_history_items(source_path);
        "#,
    )
    .map_err(|e| format!("Failed to initialize generation history table: {}", e))?;

    Ok(())
}

pub(crate) fn ensure_generation_history_ready(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    ensure_generation_history_table(conn)
}

pub(crate) fn collect_generation_history_paths(
    conn: &rusqlite::Connection,
) -> Result<Vec<String>, String> {
    ensure_generation_history_table(conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT source_path, preview_path
            FROM generation_history_items
            "#,
        )
        .map_err(|e| format!("Failed to prepare generation history path query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(|e| format!("Failed to query generation history paths: {}", e))?;

    let mut paths = Vec::new();
    for row in rows {
        let (source_path, preview_path) =
            row.map_err(|e| format!("Failed to read generation history path row: {}", e))?;
        if let Some(normalized_path) = normalize_image_ref_path(&source_path) {
            paths.push(normalized_path);
        }
        if let Some(preview_path) = preview_path {
            if let Some(normalized_path) = normalize_image_ref_path(&preview_path) {
                paths.push(normalized_path);
            }
        }
    }

    Ok(paths)
}

#[tauri::command]
pub fn list_generation_history_items(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<GenerationHistoryItemRecord>, String> {
    let conn = open_db(&app)?;
    ensure_generation_history_ready(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              project_id,
              media_type,
              node_type,
              title,
              snapshot_json,
              source_path,
              preview_path,
              mime_type,
              duration_ms,
              aspect_ratio,
              created_at,
              updated_at
            FROM generation_history_items
            WHERE project_id = ?1
            ORDER BY created_at DESC, updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare generation history query: {}", e))?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(GenerationHistoryItemRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                media_type: row.get(2)?,
                node_type: row.get(3)?,
                title: row.get(4)?,
                snapshot_json: row.get(5)?,
                source_path: row.get(6)?,
                preview_path: row.get(7)?,
                mime_type: row.get(8)?,
                duration_ms: row.get(9)?,
                aspect_ratio: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to query generation history items: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| format!("Failed to read generation history row: {}", e))?);
    }

    Ok(records)
}

#[tauri::command]
pub fn upsert_generation_history_item(
    app: AppHandle,
    record: GenerationHistoryItemRecord,
) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    ensure_generation_history_ready(&conn)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin generation history transaction: {}", e))?;

    tx.execute(
        r#"
        INSERT INTO generation_history_items (
          id,
          project_id,
          media_type,
          node_type,
          title,
          snapshot_json,
          source_path,
          preview_path,
          mime_type,
          duration_ms,
          aspect_ratio,
          created_at,
          updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
        )
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          media_type = excluded.media_type,
          node_type = excluded.node_type,
          title = excluded.title,
          snapshot_json = excluded.snapshot_json,
          source_path = excluded.source_path,
          preview_path = excluded.preview_path,
          mime_type = excluded.mime_type,
          duration_ms = excluded.duration_ms,
          aspect_ratio = excluded.aspect_ratio,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        "#,
        params![
            record.id,
            record.project_id,
            record.media_type,
            record.node_type,
            record.title,
            record.snapshot_json,
            record.source_path,
            record.preview_path,
            record.mime_type,
            record.duration_ms,
            record.aspect_ratio,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert generation history item: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit generation history transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_generation_history_item(
    app: AppHandle,
    item_id: String,
) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    ensure_generation_history_ready(&conn)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin generation history delete transaction: {}", e))?;
    tx.execute(
        "DELETE FROM generation_history_items WHERE id = ?1",
        params![item_id],
    )
    .map_err(|e| format!("Failed to delete generation history item: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit generation history delete: {}", e))?;

    prune_unreferenced_images(&app)?;
    Ok(())
}
