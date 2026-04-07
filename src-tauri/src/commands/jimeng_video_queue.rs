use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::storage;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengVideoQueueJobRecord {
    pub job_id: String,
    pub project_id: String,
    pub source_node_id: String,
    pub result_node_id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub scheduled_at: Option<i64>,
    #[serde(default)]
    pub submit_id: Option<String>,
    pub payload_json: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    #[serde(default)]
    pub last_error: Option<String>,
    pub warnings_json: String,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub next_retry_at: Option<i64>,
    #[serde(default)]
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    storage::resolve_db_path(app)
}

fn ensure_jimeng_video_queue_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
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
    .map_err(|e| format!("Failed to initialize Jimeng video queue table: {}", e))?;

    Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
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

    ensure_jimeng_video_queue_table(&conn)?;
    Ok(conn)
}

#[tauri::command]
pub fn list_jimeng_video_queue_jobs(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<JimengVideoQueueJobRecord>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              job_id,
              project_id,
              source_node_id,
              result_node_id,
              title,
              status,
              scheduled_at,
              submit_id,
              payload_json,
              attempt_count,
              max_attempts,
              last_error,
              warnings_json,
              started_at,
              next_retry_at,
              completed_at,
              created_at,
              updated_at
            FROM jimeng_video_queue_jobs
            WHERE project_id = ?1
            ORDER BY created_at ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare Jimeng queue query: {}", e))?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(JimengVideoQueueJobRecord {
                job_id: row.get(0)?,
                project_id: row.get(1)?,
                source_node_id: row.get(2)?,
                result_node_id: row.get(3)?,
                title: row.get(4)?,
                status: row.get(5)?,
                scheduled_at: row.get(6)?,
                submit_id: row.get(7)?,
                payload_json: row.get(8)?,
                attempt_count: row.get(9)?,
                max_attempts: row.get(10)?,
                last_error: row.get(11)?,
                warnings_json: row.get(12)?,
                started_at: row.get(13)?,
                next_retry_at: row.get(14)?,
                completed_at: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(|e| format!("Failed to query Jimeng queue jobs: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| format!("Failed to read Jimeng queue job row: {}", e))?);
    }

    Ok(records)
}

#[tauri::command]
pub fn upsert_jimeng_video_queue_job(
    app: AppHandle,
    record: JimengVideoQueueJobRecord,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        r#"
        INSERT INTO jimeng_video_queue_jobs (
          job_id,
          project_id,
          source_node_id,
          result_node_id,
          title,
          status,
          scheduled_at,
          submit_id,
          payload_json,
          attempt_count,
          max_attempts,
          last_error,
          warnings_json,
          started_at,
          next_retry_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
        )
        ON CONFLICT(job_id) DO UPDATE SET
          project_id = excluded.project_id,
          source_node_id = excluded.source_node_id,
          result_node_id = excluded.result_node_id,
          title = excluded.title,
          status = excluded.status,
          scheduled_at = excluded.scheduled_at,
          submit_id = excluded.submit_id,
          payload_json = excluded.payload_json,
          attempt_count = excluded.attempt_count,
          max_attempts = excluded.max_attempts,
          last_error = excluded.last_error,
          warnings_json = excluded.warnings_json,
          started_at = excluded.started_at,
          next_retry_at = excluded.next_retry_at,
          completed_at = excluded.completed_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        "#,
        params![
            record.job_id,
            record.project_id,
            record.source_node_id,
            record.result_node_id,
            record.title,
            record.status,
            record.scheduled_at,
            record.submit_id,
            record.payload_json,
            record.attempt_count,
            record.max_attempts,
            record.last_error,
            record.warnings_json,
            record.started_at,
            record.next_retry_at,
            record.completed_at,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert Jimeng queue job: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_jimeng_video_queue_job(app: AppHandle, job_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "DELETE FROM jimeng_video_queue_jobs WHERE job_id = ?1",
        params![job_id],
    )
    .map_err(|e| format!("Failed to delete Jimeng queue job: {}", e))?;

    Ok(())
}
