use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::storage;

const STYLE_TEMPLATE_SETTINGS_REFS_PROJECT_ID: &str = "__settings_style_template_refs__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryRecord {
    pub id: String,
    pub name: String,
    #[serde(default = "default_project_type")]
    pub project_type: String,
    #[serde(default)]
    pub asset_library_id: Option<String>,
    #[serde(default)]
    pub clip_library_id: Option<String>,
    #[serde(default)]
    pub clip_last_folder_id: Option<String>,
    #[serde(default)]
    pub linked_script_project_id: Option<String>,
    #[serde(default)]
    pub linked_ad_project_id: Option<String>,
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
    #[serde(default)]
    pub clip_library_id: Option<String>,
    #[serde(default)]
    pub clip_last_folder_id: Option<String>,
    #[serde(default)]
    pub linked_script_project_id: Option<String>,
    #[serde(default)]
    pub linked_ad_project_id: Option<String>,
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

fn read_table_columns(conn: &Connection, table_name: &str) -> Result<HashSet<String>, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("Failed to inspect {table_name} schema: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect {table_name} columns: {}", e))?;

    let mut columns = HashSet::new();
    for name_result in rows {
        let column_name =
            name_result.map_err(|e| format!("Failed to read {table_name} column name: {}", e))?;
        columns.insert(column_name);
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

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table_name],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect sqlite_master for {table_name}: {}", e))?;
    Ok(count > 0)
}

fn clear_clip_binding_data(data: &mut serde_json::Map<String, Value>) -> bool {
    let mut changed = false;
    for key in [
        "clipLibraryId",
        "clipProjectLinkId",
        "clipFolderId",
        "clipItemId",
    ] {
        let should_clear = data.get(key).is_some_and(|value| !value.is_null());
        if should_clear {
            data.insert(key.to_string(), Value::Null);
            changed = true;
        }
    }
    changed
}

fn clear_node_clip_bindings(node: &mut Value) -> bool {
    node.get_mut("data")
        .and_then(Value::as_object_mut)
        .map(clear_clip_binding_data)
        .unwrap_or(false)
}

fn clear_nodes_clip_bindings(nodes: &mut [Value]) -> bool {
    let mut changed = false;
    for node in nodes {
        changed |= clear_node_clip_bindings(node);
    }
    changed
}

fn clear_history_snapshot_clip_bindings(snapshot: &mut Value) -> bool {
    let mut changed = false;

    if let Some(nodes) = snapshot.get_mut("nodes").and_then(Value::as_array_mut) {
        changed |= clear_nodes_clip_bindings(nodes);
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
        changed |= clear_node_clip_bindings(node);
    }

    changed
}

fn clear_project_clip_binding_payload(
    nodes_json: &str,
    history_json: &str,
) -> Result<Option<(String, String)>, String> {
    let mut parsed_nodes = serde_json::from_str::<Value>(nodes_json)
        .map_err(|e| format!("Failed to parse project nodes json for clip reset: {}", e))?;
    let mut parsed_history = serde_json::from_str::<Value>(history_json)
        .map_err(|e| format!("Failed to parse project history json for clip reset: {}", e))?;

    let mut changed = false;

    if let Some(nodes) = project_nodes_array_mut(&mut parsed_nodes) {
        changed |= clear_nodes_clip_bindings(nodes);
    }

    for timeline_key in ["past", "future"] {
        let Some(timeline) = parsed_history
            .get_mut(timeline_key)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        for snapshot in timeline {
            changed |= clear_history_snapshot_clip_bindings(snapshot);
        }
    }

    if !changed {
        return Ok(None);
    }

    let next_nodes_json = serde_json::to_string(&parsed_nodes)
        .map_err(|e| format!("Failed to serialize cleared project nodes json: {}", e))?;
    let next_history_json = serde_json::to_string(&parsed_history)
        .map_err(|e| format!("Failed to serialize cleared project history json: {}", e))?;

    Ok(Some((next_nodes_json, next_history_json)))
}

fn ensure_clip_library_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS clip_library_chapters (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          fs_name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_folders (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          parent_id TEXT,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          shot_order INTEGER,
          number_code TEXT,
          fs_name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_items (
          id TEXT PRIMARY KEY,
          library_id TEXT NOT NULL,
          folder_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          name TEXT NOT NULL,
          description_text TEXT NOT NULL DEFAULT '',
          file_name TEXT NOT NULL,
          source_path TEXT NOT NULL,
          preview_path TEXT,
          duration_ms INTEGER,
          mime_type TEXT,
          waveform_path TEXT,
          source_node_id TEXT,
          source_node_title TEXT,
          source_project_id TEXT,
          source_project_name TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_library_ui_state (
          library_id TEXT PRIMARY KEY,
          expanded_keys_json TEXT NOT NULL DEFAULT '[]',
          selected_key TEXT,
          scroll_top REAL NOT NULL DEFAULT 0,
          left_width REAL,
          right_width REAL,
          last_filter_json TEXT NOT NULL DEFAULT '{}',
          always_on_top INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("Failed to initialize clip library tables: {}", e))?;

    Ok(())
}

fn reset_clip_library_prototype_data_if_needed(conn: &Connection) -> Result<(), String> {
    let has_project_links = table_exists(conn, "clip_library_project_links")?;
    let folder_columns = if table_exists(conn, "clip_folders")? {
        Some(read_table_columns(conn, "clip_folders")?)
    } else {
        None
    };
    let item_columns = if table_exists(conn, "clip_items")? {
        Some(read_table_columns(conn, "clip_items")?)
    } else {
        None
    };

    let needs_reset = has_project_links
        || folder_columns.as_ref().is_some_and(|columns| {
            columns.contains("project_link_id") || !columns.contains("chapter_id")
        })
        || item_columns.as_ref().is_some_and(|columns| {
            columns.contains("project_link_id")
                || !columns.contains("source_project_id")
                || !columns.contains("source_project_name")
        });

    if !needs_reset {
        return Ok(());
    }

    let project_rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, nodes_json, history_json FROM projects")
            .map_err(|e| format!("Failed to prepare project clip reset query: {}", e))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("Failed to query projects for clip reset: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results
                .push(row.map_err(|e| format!("Failed to decode project clip reset row: {}", e))?);
        }
        results
    };

    for (project_id, nodes_json, history_json) in project_rows {
        let Some((next_nodes_json, next_history_json)) =
            clear_project_clip_binding_payload(&nodes_json, &history_json)?
        else {
            continue;
        };

        conn.execute(
            "UPDATE projects SET nodes_json = ?1, history_json = ?2 WHERE id = ?3",
            params![next_nodes_json, next_history_json, project_id],
        )
        .map_err(|e| format!("Failed to clear stale clip bindings in project: {}", e))?;
    }

    conn.execute("UPDATE projects SET clip_last_folder_id = NULL", [])
        .map_err(|e| {
            format!(
                "Failed to clear clip_last_folder_id during clip reset: {}",
                e
            )
        })?;

    conn.execute_batch(
        r#"
        DROP TABLE IF EXISTS clip_library_project_links;
        DROP TABLE IF EXISTS clip_items;
        DROP TABLE IF EXISTS clip_folders;
        DROP TABLE IF EXISTS clip_library_chapters;
        DROP TABLE IF EXISTS clip_library_ui_state;
        "#,
    )
    .map_err(|e| format!("Failed to reset legacy clip library tables: {}", e))?;

    Ok(())
}

fn ensure_projects_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_type TEXT NOT NULL DEFAULT 'storyboard',
          asset_library_id TEXT,
          clip_library_id TEXT,
          clip_last_folder_id TEXT,
          linked_script_project_id TEXT,
          linked_ad_project_id TEXT,
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
        CREATE TABLE IF NOT EXISTS clip_libraries (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
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
    let mut has_clip_library_id = false;
    let mut has_clip_last_folder_id = false;
    let mut has_linked_script_project_id = false;
    let mut has_linked_ad_project_id = false;
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
        if column_name == "clip_library_id" {
            has_clip_library_id = true;
        }
        if column_name == "clip_last_folder_id" {
            has_clip_last_folder_id = true;
        }
        if column_name == "linked_script_project_id" {
            has_linked_script_project_id = true;
        }
        if column_name == "linked_ad_project_id" {
            has_linked_ad_project_id = true;
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

    if !has_clip_library_id {
        conn.execute("ALTER TABLE projects ADD COLUMN clip_library_id TEXT", [])
            .map_err(|e| format!("Failed to add clip_library_id column: {}", e))?;
    }

    if !has_clip_last_folder_id {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN clip_last_folder_id TEXT",
            [],
        )
        .map_err(|e| format!("Failed to add clip_last_folder_id column: {}", e))?;
    }

    if !has_linked_script_project_id {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN linked_script_project_id TEXT",
            [],
        )
        .map_err(|e| format!("Failed to add linked_script_project_id column: {}", e))?;
    }

    if !has_linked_ad_project_id {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN linked_ad_project_id TEXT",
            [],
        )
        .map_err(|e| format!("Failed to add linked_ad_project_id column: {}", e))?;
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
        CREATE INDEX IF NOT EXISTS idx_projects_clip_library_id ON projects(clip_library_id);
        CREATE INDEX IF NOT EXISTS idx_projects_clip_last_folder_id
          ON projects(clip_last_folder_id);
        CREATE INDEX IF NOT EXISTS idx_projects_linked_script_project_id
          ON projects(linked_script_project_id);
        CREATE INDEX IF NOT EXISTS idx_projects_linked_ad_project_id
          ON projects(linked_ad_project_id);
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

    reset_clip_library_prototype_data_if_needed(conn)?;
    ensure_clip_library_tables(conn)?;

    ensure_table_column(
        conn,
        "clip_library_chapters",
        "fs_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(
        conn,
        "clip_folders",
        "chapter_id",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(conn, "clip_folders", "shot_order", "INTEGER")?;
    ensure_table_column(conn, "clip_folders", "number_code", "TEXT")?;
    ensure_table_column(conn, "clip_folders", "fs_name", "TEXT NOT NULL DEFAULT ''")?;
    ensure_table_column(
        conn,
        "clip_items",
        "description_text",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(conn, "clip_items", "file_name", "TEXT NOT NULL DEFAULT ''")?;
    ensure_table_column(
        conn,
        "clip_items",
        "source_path",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(conn, "clip_items", "preview_path", "TEXT")?;
    ensure_table_column(conn, "clip_items", "duration_ms", "INTEGER")?;
    ensure_table_column(conn, "clip_items", "mime_type", "TEXT")?;
    ensure_table_column(conn, "clip_items", "waveform_path", "TEXT")?;
    ensure_table_column(conn, "clip_items", "source_node_id", "TEXT")?;
    ensure_table_column(conn, "clip_items", "source_node_title", "TEXT")?;
    ensure_table_column(conn, "clip_items", "source_project_id", "TEXT")?;
    ensure_table_column(
        conn,
        "clip_items",
        "source_project_name",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_table_column(
        conn,
        "clip_library_ui_state",
        "expanded_keys_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_table_column(conn, "clip_library_ui_state", "selected_key", "TEXT")?;
    ensure_table_column(
        conn,
        "clip_library_ui_state",
        "scroll_top",
        "REAL NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(conn, "clip_library_ui_state", "left_width", "REAL")?;
    ensure_table_column(conn, "clip_library_ui_state", "right_width", "REAL")?;
    ensure_table_column(
        conn,
        "clip_library_ui_state",
        "last_filter_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_table_column(
        conn,
        "clip_library_ui_state",
        "always_on_top",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_table_column(
        conn,
        "clip_library_ui_state",
        "updated_at",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    conn.execute(
        r#"
        UPDATE clip_library_chapters
        SET fs_name = COALESCE(NULLIF(TRIM(name), ''), 'Untitled Chapter')
        WHERE TRIM(COALESCE(fs_name, '')) = ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill clip_library_chapters.fs_name: {}", e))?;

    conn.execute(
        r#"
        UPDATE clip_folders
        SET fs_name = CASE
          WHEN kind IN ('shot', 'script') AND TRIM(COALESCE(number_code, '')) <> '' AND TRIM(COALESCE(name, '')) <> ''
            THEN TRIM(number_code) || ' ' || TRIM(name)
          WHEN kind IN ('shot', 'script') AND TRIM(COALESCE(number_code, '')) <> ''
            THEN TRIM(number_code)
          WHEN TRIM(COALESCE(name, '')) <> ''
            THEN TRIM(name)
          WHEN kind = 'script'
            THEN 'Untitled Script'
          ELSE 'Untitled Shot'
        END
        WHERE TRIM(COALESCE(fs_name, '')) = ''
        "#,
        [],
    )
    .map_err(|e| format!("Failed to backfill clip_folders.fs_name: {}", e))?;

    conn.execute(
        r#"
        UPDATE clip_library_ui_state
        SET last_filter_json = '{}'
        WHERE TRIM(COALESCE(last_filter_json, '')) = ''
        "#,
        [],
    )
    .map_err(|e| {
        format!(
            "Failed to backfill clip_library_ui_state.last_filter_json: {}",
            e
        )
    })?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_clip_libraries_updated_at ON clip_libraries(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clip_library_chapters_library_id
          ON clip_library_chapters(library_id, sort_order, created_at);
        CREATE INDEX IF NOT EXISTS idx_clip_folders_library_id
          ON clip_folders(library_id, chapter_id, parent_id, sort_order, created_at);
        CREATE INDEX IF NOT EXISTS idx_clip_folders_number_code
          ON clip_folders(library_id, number_code);
        CREATE INDEX IF NOT EXISTS idx_clip_folders_kind
          ON clip_folders(library_id, kind, chapter_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_clip_items_library_id
          ON clip_items(library_id, folder_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clip_items_media_type
          ON clip_items(library_id, media_type, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clip_items_name
          ON clip_items(library_id, name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_clip_items_description
          ON clip_items(library_id, description_text COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_clip_items_source_project
          ON clip_items(library_id, source_project_id, created_at DESC);
        "#,
    )
    .map_err(|e| format!("Failed to initialize clip library indexes: {}", e))?;

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

fn is_media_path_key(key: &str) -> bool {
    matches!(
        key,
        "imageUrl"
            | "previewImageUrl"
            | "sourceUrl"
            | "posterSourceUrl"
            | "videoUrl"
            | "audioUrl"
            | "referenceUrl"
    )
}

fn rewrite_media_paths_in_object<F>(
    object: &mut serde_json::Map<String, Value>,
    rewrite: &F,
) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let mut changed = false;

    for (key, nested) in object.iter_mut() {
        if is_media_path_key(key) {
            if let Some(current_value) = nested.as_str() {
                if let Some(next_value) = rewrite(current_value) {
                    if next_value != current_value {
                        *nested = Value::String(next_value);
                        changed = true;
                        continue;
                    }
                }
            }
        }

        changed |= rewrite_media_paths_in_value(nested, rewrite);
    }

    changed
}

fn rewrite_media_paths_in_value<F>(value: &mut Value, rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    match value {
        Value::Object(object) => rewrite_media_paths_in_object(object, rewrite),
        Value::Array(items) => {
            let mut changed = false;
            for item in items {
                changed |= rewrite_media_paths_in_value(item, rewrite);
            }
            changed
        }
        _ => false,
    }
}

fn rewrite_node_media_paths<F>(node: &mut Value, rewrite: &F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    let Some(data) = node.get_mut("data").and_then(Value::as_object_mut) else {
        return false;
    };

    rewrite_media_paths_in_object(data, rewrite)
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
    let Some(data) = node.get("data") else {
        return;
    };
    collect_image_paths_from_value(data, image_pool, paths);
}

fn collect_image_paths_from_value(
    value: &Value,
    image_pool: &[String],
    paths: &mut HashSet<String>,
) {
    match value {
        Value::Object(record) => {
            for (key, nested) in record {
                if is_media_path_key(key) {
                    if let Some(raw_value) = nested.as_str() {
                        if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                            paths.insert(path);
                        }
                    }
                }
                collect_image_paths_from_value(nested, image_pool, paths);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_image_paths_from_value(item, image_pool, paths);
            }
        }
        _ => {}
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

#[tauri::command]
pub fn sync_style_template_image_refs(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let images_dir = resolve_images_dir(&app)?;
    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin style template refs transaction: {}", e))?;

    tx.execute(
        "DELETE FROM project_image_refs WHERE project_id = ?1",
        params![STYLE_TEMPLATE_SETTINGS_REFS_PROJECT_ID],
    )
    .map_err(|e| format!("Failed to clear style template image refs: {}", e))?;

    for raw_path in paths {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let relocated_path = storage::relocate_storage_path_to_images_dir(trimmed, &images_dir)
            .unwrap_or_else(|| trimmed.to_string());
        let Some(normalized_path) = normalize_image_ref_path(&relocated_path) else {
            continue;
        };

        tx.execute(
            "INSERT OR IGNORE INTO project_image_refs (project_id, path) VALUES (?1, ?2)",
            params![STYLE_TEMPLATE_SETTINGS_REFS_PROJECT_ID, normalized_path],
        )
        .map_err(|e| format!("Failed to upsert style template image ref: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit style template refs transaction: {}", e))?;

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
        .map_err(|e| format!("Failed to prepare list summaries query: {}", e))?;

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
                    clip_library_id,
                    clip_last_folder_id,
                    linked_script_project_id,
                    linked_ad_project_id,
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
                clip_library_id: row.get(4)?,
                clip_last_folder_id: row.get(5)?,
                linked_script_project_id: row.get(6)?,
                linked_ad_project_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                node_count: row.get(10)?,
                nodes_json: row.get(11)?,
                edges_json: row.get(12)?,
                viewport_json: row.get(13)?,
                history_json: row.get(14)?,
                color_labels_json: row.get(15)?,
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
            clip_library_id,
            clip_last_folder_id,
            linked_script_project_id,
            linked_ad_project_id,
            created_at,
            updated_at,
            node_count,
            nodes_json,
            edges_json,
            viewport_json,
            history_json,
            color_labels_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            project_type = excluded.project_type,
            asset_library_id = excluded.asset_library_id,
            clip_library_id = excluded.clip_library_id,
            clip_last_folder_id = excluded.clip_last_folder_id,
            linked_script_project_id = excluded.linked_script_project_id,
            linked_ad_project_id = excluded.linked_ad_project_id,
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
            record.clip_library_id,
            record.clip_last_folder_id,
            record.linked_script_project_id,
            record.linked_ad_project_id,
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
        read_table_columns, rewrite_project_payload_media_paths,
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
        let has_linked_script_project_id: bool = conn
            .prepare("PRAGMA table_info(projects)")
            .expect("failed to prepare pragma")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("failed to read pragma rows")
            .flatten()
            .any(|column_name| column_name == "linked_script_project_id");
        let has_linked_ad_project_id: bool = conn
            .prepare("PRAGMA table_info(projects)")
            .expect("failed to prepare pragma")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("failed to read pragma rows")
            .flatten()
            .any(|column_name| column_name == "linked_ad_project_id");
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
            has_linked_script_project_id,
            "linked_script_project_id should be added for legacy projects"
        );
        assert!(
            has_linked_ad_project_id,
            "linked_ad_project_id should be added for legacy projects"
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
    fn ensure_projects_table_migrates_clip_library_tables_with_missing_layout_columns() {
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
            CREATE TABLE clip_library_chapters (
              id TEXT PRIMARY KEY,
              library_id TEXT NOT NULL,
              name TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE clip_library_project_links (
              id TEXT PRIMARY KEY,
              library_id TEXT NOT NULL,
              chapter_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE clip_folders (
              id TEXT PRIMARY KEY,
              library_id TEXT NOT NULL,
              project_link_id TEXT NOT NULL,
              parent_id TEXT,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
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
              'project-1',
              'Storyboard A',
              1,
              1,
              0,
              '[]',
              '[]',
              '{}',
              '{"past":[],"future":[]}',
              'storyboard'
            );
            INSERT INTO clip_library_chapters (id, library_id, name, sort_order, created_at, updated_at)
            VALUES ('chapter-1', 'library-1', '第一章', 0, 1, 1);
            INSERT INTO clip_library_project_links (
              id,
              library_id,
              chapter_id,
              project_id,
              sort_order,
              created_at,
              updated_at
            )
            VALUES ('link-1', 'library-1', 'chapter-1', 'project-1', 0, 1, 1);
            INSERT INTO clip_folders (
              id,
              library_id,
              project_link_id,
              parent_id,
              kind,
              name,
              sort_order,
              created_at,
              updated_at
            )
            VALUES ('folder-1', 'library-1', 'link-1', NULL, 'shot', '开场', 0, 1, 1);
            "#,
        )
        .expect("failed to seed legacy clip library schema");

        ensure_projects_table(&conn).expect("clip library schema migration should succeed");

        let chapter_columns = read_table_columns(&conn, "clip_library_chapters")
            .expect("failed to inspect clip_library_chapters");
        let project_link_columns = read_table_columns(&conn, "clip_library_project_links")
            .expect("failed to inspect clip_library_project_links");
        let folder_columns =
            read_table_columns(&conn, "clip_folders").expect("failed to inspect clip_folders");

        assert!(
            chapter_columns.contains("fs_name"),
            "clip_library_chapters.fs_name should be added for legacy data"
        );
        assert!(
            project_link_columns.contains("fs_name"),
            "clip_library_project_links.fs_name should be added for legacy data"
        );
        assert!(
            folder_columns.contains("shot_order"),
            "clip_folders.shot_order should be added for legacy data"
        );
        assert!(
            folder_columns.contains("number_code"),
            "clip_folders.number_code should be added for legacy data"
        );
        assert!(
            folder_columns.contains("fs_name"),
            "clip_folders.fs_name should be added for legacy data"
        );

        let chapter_fs_name: String = conn
            .query_row(
                "SELECT fs_name FROM clip_library_chapters WHERE id = 'chapter-1'",
                [],
                |row| row.get(0),
            )
            .expect("failed to read migrated clip chapter fs_name");
        let project_link_fs_name: String = conn
            .query_row(
                "SELECT fs_name FROM clip_library_project_links WHERE id = 'link-1'",
                [],
                |row| row.get(0),
            )
            .expect("failed to read migrated clip project link fs_name");
        let folder_fs_name: String = conn
            .query_row(
                "SELECT fs_name FROM clip_folders WHERE id = 'folder-1'",
                [],
                |row| row.get(0),
            )
            .expect("failed to read migrated clip folder fs_name");

        assert_eq!(chapter_fs_name, "第一章");
        assert_eq!(project_link_fs_name, "Storyboard A");
        assert_eq!(folder_fs_name, "开场");
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
    fn extract_project_image_paths_supports_midjourney_batch_images() {
        let nodes_json = r#"
        {
          "nodes": [
            {
              "id": "mj-result-node",
              "type": "mjResultNode",
              "data": {
                "batches": [
                  {
                    "id": "batch-1",
                    "images": [
                      {
                        "imageUrl": "__img_ref__:0",
                        "previewImageUrl": "__img_ref__:1",
                        "sourceUrl": "__img_ref__:2"
                      }
                    ]
                  }
                ]
              }
            }
          ],
          "imagePool": [
            "C:\\Users\\Tester\\images\\mj-0.png",
            "C:/Users/Tester/images/mj-0-preview.png",
            "C:/Users/Tester/images/mj-0-source.png"
          ]
        }
        "#;
        let history_json = r#"{"past":[],"future":[]}"#;

        let paths = extract_project_image_paths(nodes_json, history_json);

        assert!(paths.contains(
            normalize_image_ref_path(r"C:\Users\Tester\images\mj-0.png")
                .expect("mj image path should normalize")
                .as_str()
        ));
        assert!(paths.contains(
            normalize_image_ref_path("C:/Users/Tester/images/mj-0-preview.png")
                .expect("mj preview path should normalize")
                .as_str()
        ));
        assert!(paths.contains(
            normalize_image_ref_path("C:/Users/Tester/images/mj-0-source.png")
                .expect("mj source path should normalize")
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

    #[test]
    fn rewrite_project_payload_media_paths_recurses_into_nested_media_structures() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-project-rewrite-nested-test-{}",
            std::process::id()
        ));
        let images_dir = temp_root.join("images");
        fs::create_dir_all(&images_dir).expect("failed to create images dir");

        let batch_image = images_dir.join("mj-0.png");
        let batch_preview = images_dir.join("mj-0-preview.png");
        let batch_source = images_dir.join("mj-0-source.png");
        let nested_image = images_dir.join("nested.png");
        let history_preview = images_dir.join("history-preview.png");

        for path in [
            &batch_image,
            &batch_preview,
            &batch_source,
            &nested_image,
            &history_preview,
        ] {
            fs::write(path, b"fixture").expect("failed to write fixture");
        }

        let nodes_json = r#"
        {
          "nodes": [
            {
              "id": "complex-node",
              "type": "mjResultNode",
              "data": {
                "batches": [
                  {
                    "images": [
                      {
                        "imageUrl": "C:/legacy-storage/images/mj-0.png",
                        "previewImageUrl": "C:/legacy-storage/images/mj-0-preview.png",
                        "sourceUrl": "C:/legacy-storage/images/mj-0-source.png"
                      }
                    ]
                  }
                ],
                "nested": {
                  "gallery": [
                    {
                      "imageUrl": "C:/legacy-storage/images/nested.png"
                    }
                  ]
                }
              }
            }
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
                  "nodeId": "complex-node",
                  "node": {
                    "id": "complex-node",
                    "type": "mjResultNode",
                    "data": {
                      "nested": {
                        "gallery": [
                          {
                            "previewImageUrl": "C:/legacy-storage/images/history-preview.png"
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          ],
          "future": []
        }
        "#;

        let rewritten = rewrite_project_payload_media_paths(nodes_json, history_json, &|value| {
            storage::relocate_storage_path_to_images_dir(value, &images_dir)
        })
        .expect("rewrite should succeed")
        .expect("payload should change");

        assert!(rewritten
            .0
            .contains(&batch_image.to_string_lossy().replace('\\', "/")));
        assert!(rewritten
            .0
            .contains(&batch_preview.to_string_lossy().replace('\\', "/")));
        assert!(rewritten
            .0
            .contains(&batch_source.to_string_lossy().replace('\\', "/")));
        assert!(rewritten
            .0
            .contains(&nested_image.to_string_lossy().replace('\\', "/")));
        assert!(rewritten
            .1
            .contains(&history_preview.to_string_lossy().replace('\\', "/")));

        let _ = fs::remove_dir_all(temp_root);
    }
}
