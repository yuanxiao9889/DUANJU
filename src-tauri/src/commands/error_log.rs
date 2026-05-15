use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::AppHandle;

use super::project_state::open_db;

const ERROR_LOG_RETENTION_MS: i64 = 14 * 24 * 60 * 60 * 1000;
const NEW_API_ERROR_LOG_TYPE: i64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLogItemRecord {
    pub id: String,
    #[serde(default)]
    pub user_id: i64,
    #[serde(default = "default_error_log_type", rename = "type")]
    pub log_type: i64,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token_name: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub quota: i64,
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub use_time: i64,
    #[serde(default)]
    pub is_stream: bool,
    #[serde(default)]
    pub channel: i64,
    #[serde(default)]
    pub channel_name: String,
    #[serde(default)]
    pub token_id: i64,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub other: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub node_id: Option<String>,
    pub source_type: String,
    pub failure_stage: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub request_size: Option<String>,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub external_task_id: Option<String>,
    #[serde(default)]
    pub trace_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub status_code: Option<i64>,
    pub message: String,
    #[serde(default)]
    pub details: Option<String>,
    #[serde(default)]
    pub context_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_error_log_type() -> i64 {
    NEW_API_ERROR_LOG_TYPE
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn read_table_columns(
    conn: &rusqlite::Connection,
    table_name: &str,
) -> Result<HashSet<String>, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn
        .prepare(&pragma)
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
    conn: &rusqlite::Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let columns = read_table_columns(conn, table_name)?;
    let normalized_name = column_name.trim_matches('"');
    if columns.contains(normalized_name) {
        return Ok(());
    }

    let statement =
        format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    conn.execute(&statement, [])
        .map_err(|e| format!("Failed to add {table_name}.{normalized_name} column: {}", e))?;

    Ok(())
}

fn ensure_error_log_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_error_logs (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL DEFAULT 0,
          type INTEGER NOT NULL DEFAULT 5,
          content TEXT NOT NULL DEFAULT '',
          username TEXT NOT NULL DEFAULT '',
          token_name TEXT NOT NULL DEFAULT '',
          model_name TEXT NOT NULL DEFAULT '',
          quota INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          use_time INTEGER NOT NULL DEFAULT 0,
          is_stream INTEGER NOT NULL DEFAULT 0,
          channel INTEGER NOT NULL DEFAULT 0,
          channel_name TEXT NOT NULL DEFAULT '',
          token_id INTEGER NOT NULL DEFAULT 0,
          "group" TEXT NOT NULL DEFAULT '',
          ip TEXT NOT NULL DEFAULT '',
          request_id TEXT,
          other TEXT NOT NULL DEFAULT '',
          project_id TEXT,
          node_id TEXT,
          source_type TEXT NOT NULL,
          failure_stage TEXT NOT NULL,
          provider_id TEXT,
          model TEXT,
          request_size TEXT,
          aspect_ratio TEXT,
          job_id TEXT,
          external_task_id TEXT,
          trace_id TEXT,
          category TEXT,
          status_code INTEGER,
          message TEXT NOT NULL,
          details TEXT,
          context_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to initialize error log table: {}", e))?;

    ensure_table_column(
        conn,
        "ai_error_logs",
        "user_id",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(conn, "ai_error_logs", "type", "INTEGER NOT NULL DEFAULT 5")?;
    ensure_table_column(conn, "ai_error_logs", "content", "TEXT NOT NULL DEFAULT ''")?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "username",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "token_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "model_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(conn, "ai_error_logs", "quota", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "prompt_tokens",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "completion_tokens",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "use_time",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "is_stream",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "channel",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "channel_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "token_id",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "ai_error_logs",
        "\"group\"",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(conn, "ai_error_logs", "ip", "TEXT NOT NULL DEFAULT ''")?;
    ensure_table_column(conn, "ai_error_logs", "request_id", "TEXT")?;
    ensure_table_column(conn, "ai_error_logs", "other", "TEXT NOT NULL DEFAULT ''")?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_created_at
          ON ai_error_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_type_created_at
          ON ai_error_logs(type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_request_id
          ON ai_error_logs(request_id);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_job_id
          ON ai_error_logs(job_id);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_model_name
          ON ai_error_logs(model_name);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_token_name
          ON ai_error_logs(token_name);
        CREATE INDEX IF NOT EXISTS idx_ai_error_logs_channel
          ON ai_error_logs(channel);
        "#,
    )
    .map_err(|e| format!("Failed to initialize error log indexes: {}", e))?;

    Ok(())
}

fn prune_error_logs_with_conn(conn: &rusqlite::Connection) -> Result<(), String> {
    let cutoff = now_ms() - ERROR_LOG_RETENTION_MS;
    conn.execute(
        "DELETE FROM ai_error_logs WHERE created_at < ?1",
        params![cutoff],
    )
    .map_err(|e| format!("Failed to prune old error logs: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn prune_error_log_items(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_error_log_table(&conn)?;
    prune_error_logs_with_conn(&conn)
}

#[tauri::command]
pub fn list_error_log_items(app: AppHandle) -> Result<Vec<ErrorLogItemRecord>, String> {
    let conn = open_db(&app)?;
    ensure_error_log_table(&conn)?;
    prune_error_logs_with_conn(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              user_id,
              type,
              content,
              username,
              token_name,
              model_name,
              quota,
              prompt_tokens,
              completion_tokens,
              use_time,
              is_stream,
              channel,
              channel_name,
              token_id,
              "group",
              ip,
              request_id,
              other,
              project_id,
              node_id,
              source_type,
              failure_stage,
              provider_id,
              model,
              request_size,
              aspect_ratio,
              job_id,
              external_task_id,
              trace_id,
              category,
              status_code,
              message,
              details,
              context_json,
              created_at,
              updated_at
            FROM ai_error_logs
            ORDER BY created_at DESC, updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare error log query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let is_stream_value: i64 = row.get(11)?;
            Ok(ErrorLogItemRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                log_type: row.get(2)?,
                content: row.get(3)?,
                username: row.get(4)?,
                token_name: row.get(5)?,
                model_name: row.get(6)?,
                quota: row.get(7)?,
                prompt_tokens: row.get(8)?,
                completion_tokens: row.get(9)?,
                use_time: row.get(10)?,
                is_stream: is_stream_value != 0,
                channel: row.get(12)?,
                channel_name: row.get(13)?,
                token_id: row.get(14)?,
                group: row.get(15)?,
                ip: row.get(16)?,
                request_id: row.get(17)?,
                other: row.get(18)?,
                project_id: row.get(19)?,
                node_id: row.get(20)?,
                source_type: row.get(21)?,
                failure_stage: row.get(22)?,
                provider_id: row.get(23)?,
                model: row.get(24)?,
                request_size: row.get(25)?,
                aspect_ratio: row.get(26)?,
                job_id: row.get(27)?,
                external_task_id: row.get(28)?,
                trace_id: row.get(29)?,
                category: row.get(30)?,
                status_code: row.get(31)?,
                message: row.get(32)?,
                details: row.get(33)?,
                context_json: row.get(34)?,
                created_at: row.get(35)?,
                updated_at: row.get(36)?,
            })
        })
        .map_err(|e| format!("Failed to query error logs: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| format!("Failed to read error log row: {}", e))?);
    }

    Ok(records)
}

#[tauri::command]
pub fn upsert_error_log_item(app: AppHandle, record: ErrorLogItemRecord) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    ensure_error_log_table(&conn)?;
    prune_error_logs_with_conn(&conn)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin error log transaction: {}", e))?;

    tx.execute(
        r#"
        INSERT INTO ai_error_logs (
          id,
          user_id,
          type,
          content,
          username,
          token_name,
          model_name,
          quota,
          prompt_tokens,
          completion_tokens,
          use_time,
          is_stream,
          channel,
          channel_name,
          token_id,
          "group",
          ip,
          request_id,
          other,
          project_id,
          node_id,
          source_type,
          failure_stage,
          provider_id,
          model,
          request_size,
          aspect_ratio,
          job_id,
          external_task_id,
          trace_id,
          category,
          status_code,
          message,
          details,
          context_json,
          created_at,
          updated_at
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
          ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
          ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
          ?31, ?32, ?33, ?34, ?35, ?36, ?37
        )
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          type = excluded.type,
          content = excluded.content,
          username = excluded.username,
          token_name = excluded.token_name,
          model_name = excluded.model_name,
          quota = excluded.quota,
          prompt_tokens = excluded.prompt_tokens,
          completion_tokens = excluded.completion_tokens,
          use_time = excluded.use_time,
          is_stream = excluded.is_stream,
          channel = excluded.channel,
          channel_name = excluded.channel_name,
          token_id = excluded.token_id,
          "group" = excluded."group",
          ip = excluded.ip,
          request_id = excluded.request_id,
          other = excluded.other,
          project_id = excluded.project_id,
          node_id = excluded.node_id,
          source_type = excluded.source_type,
          failure_stage = excluded.failure_stage,
          provider_id = excluded.provider_id,
          model = excluded.model,
          request_size = excluded.request_size,
          aspect_ratio = excluded.aspect_ratio,
          job_id = excluded.job_id,
          external_task_id = excluded.external_task_id,
          trace_id = excluded.trace_id,
          category = excluded.category,
          status_code = excluded.status_code,
          message = excluded.message,
          details = excluded.details,
          context_json = excluded.context_json,
          created_at = CASE
            WHEN excluded.created_at > 0
              AND excluded.created_at < ai_error_logs.created_at
            THEN excluded.created_at
            ELSE ai_error_logs.created_at
          END,
          updated_at = excluded.updated_at
        "#,
        params![
            record.id,
            record.user_id,
            record.log_type,
            record.content,
            record.username,
            record.token_name,
            record.model_name,
            record.quota,
            record.prompt_tokens,
            record.completion_tokens,
            record.use_time,
            if record.is_stream { 1_i64 } else { 0_i64 },
            record.channel,
            record.channel_name,
            record.token_id,
            record.group,
            record.ip,
            record.request_id,
            record.other,
            record.project_id,
            record.node_id,
            record.source_type,
            record.failure_stage,
            record.provider_id,
            record.model,
            record.request_size,
            record.aspect_ratio,
            record.job_id,
            record.external_task_id,
            record.trace_id,
            record.category,
            record.status_code,
            record.message,
            record.details,
            record.context_json,
            record.created_at,
            record.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert error log item: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit error log transaction: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_error_log_item(app: AppHandle, item_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_error_log_table(&conn)?;
    conn.execute("DELETE FROM ai_error_logs WHERE id = ?1", params![item_id])
        .map_err(|e| format!("Failed to delete error log item: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn clear_error_log_items(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    ensure_error_log_table(&conn)?;
    conn.execute("DELETE FROM ai_error_logs", [])
        .map_err(|e| format!("Failed to clear error logs: {}", e))?;
    Ok(())
}
