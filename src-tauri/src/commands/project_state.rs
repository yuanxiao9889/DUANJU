use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use super::storage;

const STYLE_TEMPLATE_SETTINGS_REFS_PROJECT_ID: &str = "__settings_style_template_refs__";
const STYLE_TEMPLATE_STATE_ID: &str = "default";
static NORMALIZED_STORAGE_DBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

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
    #[serde(default)]
    pub script_welcome_skipped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHistoryRecord {
    pub project_id: String,
    pub history_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeProjectMediaResult {
    pub project_id: String,
    pub rewritten: bool,
    pub copied_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTemplateStateRecord {
    pub categories_json: String,
    pub templates_json: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStyleTemplateStatePayload {
    pub categories_json: String,
    pub templates_json: String,
}

#[derive(Debug, Clone)]
struct LegacyProjectPayload {
    legacy_id: String,
    source_dir: PathBuf,
    nodes_json: String,
    edges_json: String,
    viewport_json: String,
    history_json: String,
    node_count: i64,
}

#[derive(Debug, Clone)]
struct ExistingProjectMediaSnapshot {
    node_count: i64,
    media_ref_count: usize,
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    storage::resolve_db_path(app)
}

fn normalize_storage_compare_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

fn read_legacy_project_payload(
    project_db_path: &Path,
) -> Result<Option<LegacyProjectPayload>, String> {
    if !project_db_path.exists() {
        return Ok(None);
    }

    let conn = Connection::open(project_db_path).map_err(|e| {
        format!(
            "Failed to open legacy project db {}: {}",
            project_db_path.display(),
            e
        )
    })?;

    let has_project_data_table = table_exists(&conn, "project_data")?;
    if !has_project_data_table {
        return Ok(None);
    }

    let payload = conn.query_row(
        r#"
            SELECT id, nodes_json, edges_json, viewport_json, history_json
            FROM project_data
            LIMIT 1
            "#,
        [],
        |row| {
            Ok(LegacyProjectPayload {
                legacy_id: row.get(0)?,
                source_dir: project_db_path
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(PathBuf::new),
                nodes_json: row.get(1)?,
                edges_json: row.get(2)?,
                viewport_json: row.get(3)?,
                history_json: row.get(4)?,
                node_count: 0,
            })
        },
    );

    match payload {
        Ok(mut value) => {
            let parsed_nodes = serde_json::from_str::<Value>(&value.nodes_json).map_err(|e| {
                format!(
                    "Failed to parse legacy nodes json {}: {}",
                    project_db_path.display(),
                    e
                )
            })?;
            value.node_count = project_nodes_array(&parsed_nodes)
                .map(|nodes| nodes.len() as i64)
                .unwrap_or(0);
            Ok(Some(value))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!(
            "Failed to load legacy project payload from {}: {}",
            project_db_path.display(),
            error
        )),
    }
}

fn collect_legacy_project_payloads(app: &AppHandle) -> Result<Vec<LegacyProjectPayload>, String> {
    let current_root = storage::resolve_storage_base_path(app)?;
    let current_root_key = normalize_storage_compare_key(&current_root);
    let default_root = storage::get_default_storage_path(app)?;
    let roots = storage::resolve_known_storage_roots(app)?;
    let mut results = Vec::new();
    let mut seen_legacy_ids = HashSet::new();

    for root in roots {
        let root_key = normalize_storage_compare_key(&root);
        if root_key != current_root_key {
            continue;
        }

        let legacy_projects_dir = default_root.join("projects");
        if !legacy_projects_dir.is_dir() {
            continue;
        }

        let entries = fs::read_dir(&legacy_projects_dir).map_err(|e| {
            format!(
                "Failed to read legacy projects directory {}: {}",
                legacy_projects_dir.display(),
                e
            )
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| {
                format!(
                    "Failed to read legacy project directory entry in {}: {}",
                    legacy_projects_dir.display(),
                    e
                )
            })?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let project_db_path = path.join("project.db");
            let Some(payload) = read_legacy_project_payload(&project_db_path)? else {
                continue;
            };

            if seen_legacy_ids.insert(payload.legacy_id.clone()) {
                results.push(payload);
            }
        }
    }

    Ok(results)
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
          color_labels_json TEXT NOT NULL DEFAULT '{}',
          script_welcome_skipped INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS project_image_refs (
          project_id TEXT NOT NULL,
          path TEXT NOT NULL,
          PRIMARY KEY(project_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_project_image_refs_path ON project_image_refs(path);
        CREATE TABLE IF NOT EXISTS style_template_state (
          id TEXT PRIMARY KEY,
          categories_json TEXT NOT NULL DEFAULT '[]',
          templates_json TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS legacy_project_imports (
          legacy_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          source_dir TEXT NOT NULL,
          imported_at INTEGER NOT NULL
        );
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

    ensure_table_column(
        conn,
        "style_template_state",
        "categories_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_table_column(
        conn,
        "style_template_state",
        "templates_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_table_column(
        conn,
        "style_template_state",
        "updated_at",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    let mut has_node_count = false;
    let mut has_project_type = false;
    let mut has_asset_library_id = false;
    let mut has_clip_library_id = false;
    let mut has_clip_last_folder_id = false;
    let mut has_linked_script_project_id = false;
    let mut has_linked_ad_project_id = false;
    let mut has_color_labels_json = false;
    let mut has_script_welcome_skipped = false;
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
        if column_name == "script_welcome_skipped" {
            has_script_welcome_skipped = true;
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

    if !has_script_welcome_skipped {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN script_welcome_skipped INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Failed to add script_welcome_skipped column: {}", e))?;
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
            | "thumbnailUrl"
            | "sourceImageUrl"
            | "maskImageUrl"
            | "sourceUrl"
            | "posterSourceUrl"
            | "videoUrl"
            | "audioUrl"
            | "referenceUrl"
            | "modelPath"
            | "posePath"
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

fn rewrite_project_nodes_media_paths<F>(
    nodes_json: &str,
    rewrite: &F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Option<String>,
{
    let mut parsed_nodes = serde_json::from_str::<Value>(nodes_json).map_err(|e| {
        format!(
            "Failed to parse project nodes json for media rewrite: {}",
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

    if !changed {
        return Ok(None);
    }

    serde_json::to_string(&parsed_nodes)
        .map(Some)
        .map_err(|e| format!("Failed to serialize rewritten project nodes json: {}", e))
}

fn rewrite_project_history_media_paths<F>(
    history_json: &str,
    rewrite: &F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Option<String>,
{
    let mut parsed_history = serde_json::from_str::<Value>(history_json).map_err(|e| {
        format!(
            "Failed to parse project history json for media rewrite: {}",
            e
        )
    })?;

    let mut changed = false;

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

    serde_json::to_string(&parsed_history)
        .map(Some)
        .map_err(|e| format!("Failed to serialize rewritten project history json: {}", e))
}

fn encode_project_payload_storage_refs(
    app: &AppHandle,
    nodes_json: &str,
    history_json: &str,
) -> Result<Option<(String, String)>, String> {
    rewrite_project_payload_media_paths(nodes_json, history_json, &|value| {
        let next = storage::encode_storage_media_ref(app, value);
        (next != value).then_some(next)
    })
}

fn decode_project_payload_storage_refs(
    app: &AppHandle,
    nodes_json: &str,
    history_json: &str,
) -> Result<Option<(String, String)>, String> {
    rewrite_project_payload_media_paths(nodes_json, history_json, &|value| {
        let next = storage::decode_storage_media_ref(app, value);
        (next != value).then_some(next)
    })
}

fn decode_project_record_storage_refs(
    app: &AppHandle,
    record: &mut ProjectRecord,
) -> Result<(), String> {
    if let Some((next_nodes_json, next_history_json)) =
        decode_project_payload_storage_refs(app, &record.nodes_json, &record.history_json)?
    {
        record.nodes_json = next_nodes_json;
        record.history_json = next_history_json;
    }
    Ok(())
}

fn decode_project_record_nodes_storage_refs(
    app: &AppHandle,
    record: &mut ProjectRecord,
) -> Result<(), String> {
    if let Some(next_nodes_json) = rewrite_project_nodes_media_paths(&record.nodes_json, &|value| {
        let next = storage::decode_storage_media_ref(app, value);
        (next != value).then_some(next)
    })? {
        record.nodes_json = next_nodes_json;
    }
    Ok(())
}

fn decode_project_history_storage_refs(
    app: &AppHandle,
    history_json: &mut String,
) -> Result<(), String> {
    if let Some(next_history_json) = rewrite_project_history_media_paths(history_json, &|value| {
        let next = storage::decode_storage_media_ref(app, value);
        (next != value).then_some(next)
    })? {
        *history_json = next_history_json;
    }
    Ok(())
}

fn encode_project_record_storage_refs(
    app: &AppHandle,
    record: &mut ProjectRecord,
) -> Result<(), String> {
    if let Some((next_nodes_json, next_history_json)) =
        encode_project_payload_storage_refs(app, &record.nodes_json, &record.history_json)?
    {
        record.nodes_json = next_nodes_json;
        record.history_json = next_history_json;
    }
    Ok(())
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

fn read_existing_project_media_snapshot(
    conn: &Connection,
    project_id: &str,
) -> Result<Option<ExistingProjectMediaSnapshot>, String> {
    let result = conn.query_row(
        "SELECT node_count, nodes_json, history_json FROM projects WHERE id = ?1 LIMIT 1",
        params![project_id],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    );

    let (node_count, nodes_json, history_json) = match result {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to read existing project media snapshot: {}",
                error
            ))
        }
    };

    Ok(Some(ExistingProjectMediaSnapshot {
        node_count,
        media_ref_count: extract_project_image_paths(&nodes_json, &history_json).len(),
    }))
}

fn is_suspicious_project_media_drop(
    existing: &ExistingProjectMediaSnapshot,
    incoming_node_count: i64,
    incoming_media_ref_count: usize,
) -> bool {
    const MIN_EXISTING_MEDIA_REFS_FOR_GUARD: usize = 8;
    const STABLE_NODE_COUNT_NUMERATOR: i64 = 4;
    const STABLE_NODE_COUNT_DENOMINATOR: i64 = 5;
    const SEVERE_REF_DROP_NUMERATOR: usize = 1;
    const SEVERE_REF_DROP_DENOMINATOR: usize = 10;

    if existing.media_ref_count < MIN_EXISTING_MEDIA_REFS_FOR_GUARD {
        return false;
    }

    let stable_node_count = if existing.node_count <= 0 {
        incoming_node_count > 0
    } else {
        incoming_node_count.saturating_mul(STABLE_NODE_COUNT_DENOMINATOR)
            >= existing
                .node_count
                .saturating_mul(STABLE_NODE_COUNT_NUMERATOR)
    };
    if !stable_node_count {
        return false;
    }

    incoming_media_ref_count == 0
        || incoming_media_ref_count.saturating_mul(SEVERE_REF_DROP_DENOMINATOR)
            <= existing
                .media_ref_count
                .saturating_mul(SEVERE_REF_DROP_NUMERATOR)
}

fn guard_project_media_refs_before_upsert(
    app: &AppHandle,
    conn: &Connection,
    record: &ProjectRecord,
) -> Result<(), String> {
    let Some(existing) = read_existing_project_media_snapshot(conn, &record.id)? else {
        return Ok(());
    };

    let incoming_media_ref_count =
        extract_project_image_paths(&record.nodes_json, &record.history_json).len();
    if !is_suspicious_project_media_drop(&existing, record.node_count, incoming_media_ref_count) {
        return Ok(());
    }

    let backup_message = match storage::create_pre_persist_database_backup(app) {
        Ok(backup) => format!(" A safety backup was created: {}", backup.id),
        Err(error) => format!(" Safety backup failed: {}", error),
    };

    Err(format!(
        "Blocked suspicious project media overwrite for project {}: media references would drop from {} to {} while node count changes from {} to {}.{}",
        record.id,
        existing.media_ref_count,
        incoming_media_ref_count,
        existing.node_count,
        record.node_count,
        backup_message
    ))
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

fn now_timestamp_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn build_recovered_project_name(legacy_id: &str) -> String {
    let short_id = legacy_id.chars().take(8).collect::<String>();
    format!("Recovered {short_id}")
}

fn get_project_name_by_id(conn: &Connection, project_id: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT name FROM projects WHERE id = ?1 LIMIT 1",
        params![project_id],
        |row| row.get::<_, String>(0),
    );

    match result {
        Ok(name) => Ok(Some(name)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to read project name: {}", error)),
    }
}

fn project_has_meaningful_content(node_count: i64, nodes_json: &str, history_json: &str) -> bool {
    if node_count > 0 {
        return true;
    }

    let parsed_nodes = serde_json::from_str::<Value>(nodes_json).ok();
    if parsed_nodes
        .as_ref()
        .and_then(project_nodes_array)
        .is_some_and(|nodes| !nodes.is_empty())
    {
        return true;
    }

    let parsed_history = serde_json::from_str::<Value>(history_json).ok();
    for timeline_key in ["past", "future"] {
        if parsed_history
            .as_ref()
            .and_then(|value| value.get(timeline_key))
            .and_then(Value::as_array)
            .is_some_and(|timeline| !timeline.is_empty())
        {
            return true;
        }
    }

    false
}

fn project_already_imported(
    conn: &Connection,
    legacy_id: &str,
    source_dir: &Path,
) -> Result<bool, String> {
    let source_dir = source_dir.to_string_lossy().replace('\\', "/");
    let count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM legacy_project_imports
            WHERE legacy_id = ?1 AND source_dir = ?2
            "#,
            params![legacy_id, source_dir],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect legacy import registry: {}", e))?;

    Ok(count > 0)
}

fn remember_legacy_project_import_in_tx(
    tx: &rusqlite::Transaction<'_>,
    legacy_id: &str,
    project_id: &str,
    source_dir: &Path,
) -> Result<(), String> {
    tx.execute(
        r#"
        INSERT INTO legacy_project_imports (legacy_id, project_id, source_dir, imported_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(legacy_id) DO UPDATE SET
            project_id = excluded.project_id,
            source_dir = excluded.source_dir,
            imported_at = excluded.imported_at
        "#,
        params![
            legacy_id,
            project_id,
            source_dir.to_string_lossy().replace('\\', "/"),
            now_timestamp_ms()
        ],
    )
    .map_err(|e| format!("Failed to record legacy project import: {}", e))?;

    Ok(())
}

fn find_restore_target_project_id(
    conn: &Connection,
    legacy_payload: &LegacyProjectPayload,
) -> Result<Option<String>, String> {
    let result = conn.query_row(
        r#"
        SELECT id, node_count, nodes_json, history_json
        FROM projects
        WHERE id = ?1
        LIMIT 1
        "#,
        params![legacy_payload.legacy_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    );

    match result {
        Ok((project_id, node_count, nodes_json, history_json)) => {
            if project_has_meaningful_content(node_count, &nodes_json, &history_json) {
                return Ok(None);
            }

            if legacy_payload.node_count <= 0 {
                return Ok(None);
            }

            Ok(Some(project_id))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to query restore target: {}", error)),
    }
}

fn project_id_exists(conn: &Connection, project_id: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect existing project id: {}", e))?;
    Ok(count > 0)
}

fn build_recovered_project_id(conn: &Connection, legacy_id: &str) -> Result<String, String> {
    let mut candidate = legacy_id.to_string();
    if !project_id_exists(conn, &candidate)? {
        return Ok(candidate);
    }

    let short_id = legacy_id.chars().take(8).collect::<String>();
    candidate = format!("recovered-{short_id}");
    if !project_id_exists(conn, &candidate)? {
        return Ok(candidate);
    }

    let mut index = 2;
    loop {
        candidate = format!("recovered-{short_id}-{index}");
        if !project_id_exists(conn, &candidate)? {
            return Ok(candidate);
        }
        index += 1;
    }
}

fn import_legacy_project_payload_in_tx(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    project_name: &str,
    legacy_payload: &LegacyProjectPayload,
    created_at: i64,
    updated_at: i64,
) -> Result<(), String> {
    tx.execute(
        r#"
        INSERT INTO projects (
            id,
            name,
            project_type,
            created_at,
            updated_at,
            node_count,
            nodes_json,
            edges_json,
            viewport_json,
            history_json,
            color_labels_json,
            script_welcome_skipped
        )
        VALUES (?1, ?2, 'storyboard', ?3, ?4, ?5, ?6, ?7, ?8, ?9, '{}', 0)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            updated_at = excluded.updated_at,
            node_count = excluded.node_count,
            nodes_json = excluded.nodes_json,
            edges_json = excluded.edges_json,
            viewport_json = excluded.viewport_json,
            history_json = excluded.history_json
        "#,
        params![
            project_id,
            project_name,
            created_at,
            updated_at,
            legacy_payload.node_count,
            legacy_payload.nodes_json,
            legacy_payload.edges_json,
            legacy_payload.viewport_json,
            legacy_payload.history_json,
        ],
    )
    .map_err(|e| format!("Failed to import legacy project payload: {}", e))?;

    replace_project_image_refs(
        tx,
        project_id,
        &legacy_payload.nodes_json,
        &legacy_payload.history_json,
    )?;

    remember_legacy_project_import_in_tx(
        tx,
        &legacy_payload.legacy_id,
        project_id,
        &legacy_payload.source_dir,
    )?;

    Ok(())
}

fn import_legacy_projects_if_needed(
    conn: &mut Connection,
    app: &AppHandle,
) -> Result<bool, String> {
    let legacy_payloads = collect_legacy_project_payloads(app)?;
    if legacy_payloads.is_empty() {
        return Ok(false);
    }

    let mut changed = false;

    for payload in legacy_payloads {
        if project_already_imported(conn, &payload.legacy_id, &payload.source_dir)? {
            continue;
        }

        let restore_target_id = find_restore_target_project_id(conn, &payload)?;
        let now = now_timestamp_ms();
        let project_id = match restore_target_id.clone() {
            Some(project_id) => project_id,
            None => build_recovered_project_id(conn, &payload.legacy_id)?,
        };
        let project_name = if restore_target_id.is_some() {
            get_project_name_by_id(conn, &project_id)?
                .unwrap_or_else(|| build_recovered_project_name(&payload.legacy_id))
        } else {
            build_recovered_project_name(&payload.legacy_id)
        };
        let created_at = if restore_target_id.is_some() {
            now
        } else {
            now
        };

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin legacy import transaction: {}", e))?;
        import_legacy_project_payload_in_tx(
            &tx,
            &project_id,
            &project_name,
            &payload,
            created_at,
            now,
        )?;
        tx.commit()
            .map_err(|e| format!("Failed to commit legacy project import: {}", e))?;
        changed = true;
    }

    Ok(changed)
}

fn repair_project_record_storage_aliases_if_needed(
    conn: &mut Connection,
    app: &AppHandle,
    record: &mut ProjectRecord,
) -> Result<bool, String> {
    let Some((next_nodes_json, next_history_json)) =
        rewrite_project_payload_media_paths_to_known_storage(
            app,
            &record.nodes_json,
            &record.history_json,
        )?
    else {
        return Ok(false);
    };

    storage::ensure_storage_session_write_allowed(app)?;
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

fn rewrite_project_payload_media_paths_to_known_storage(
    app: &AppHandle,
    nodes_json: &str,
    history_json: &str,
) -> Result<Option<(String, String)>, String> {
    let known_media_dirs = storage::resolve_known_media_dirs(app)?;
    rewrite_project_payload_media_paths(nodes_json, history_json, &|value| {
        storage::relocate_storage_path_to_known_media_dirs(value, &known_media_dirs)
    })
}

fn is_path_under_dir(path: &str, dir: &Path) -> bool {
    let Some(normalized_path) = normalize_image_ref_path(path) else {
        return false;
    };
    let Some(normalized_dir) = normalize_image_ref_path(&dir.to_string_lossy()) else {
        return false;
    };

    normalized_path == normalized_dir || normalized_path.starts_with(&(normalized_dir + "/"))
}

fn is_legacy_images_path(value: &str, legacy_images_dirs: &[PathBuf]) -> bool {
    legacy_images_dirs
        .iter()
        .any(|legacy_dir| is_path_under_dir(value, legacy_dir))
}

fn extension_from_local_path(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(storage::normalize_media_extension)
        .unwrap_or_else(|| "bin".to_string())
}

fn media_ref_exists_under_dir(conn: &Connection, dir: &Path) -> Result<bool, String> {
    if !dir.exists() {
        return Ok(false);
    }

    let Some(normalized_dir) = normalize_image_ref_path(&dir.to_string_lossy()) else {
        return Ok(false);
    };
    let compare_prefix = format!("{}/", normalized_dir);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT path FROM project_image_refs
            UNION
            SELECT path FROM asset_image_refs
            "#,
        )
        .map_err(|e| format!("Failed to prepare media ref lookup: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query media refs: {}", e))?;

    for row in rows {
        let value = row.map_err(|e| format!("Failed to read media ref: {}", e))?;
        let Some(normalized_path) = normalize_image_ref_path(&value) else {
            continue;
        };
        if normalized_path == normalized_dir || normalized_path.starts_with(&compare_prefix) {
            return Ok(true);
        }
    }

    Ok(false)
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

pub(crate) fn normalize_storage_media_refs_in_connection(
    app: &AppHandle,
    conn: &mut Connection,
) -> Result<storage::StorageMediaMigrationStats, String> {
    ensure_projects_table(conn)?;

    let encode = |value: &str| storage::encode_storage_media_ref(app, value);
    let mut stats = storage::StorageMediaMigrationStats::default();

    let project_rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, nodes_json, history_json FROM projects")
            .map_err(|e| format!("Failed to prepare project URI normalization query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query projects for URI normalization: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read project URI normalization row: {}", e))?,
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
            .map_err(|e| format!("Failed to prepare asset URI normalization query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query assets for URI normalization: {}", e))?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read asset URI normalization row: {}", e))?,
            );
        }
        collected
    };

    let generation_rows: Vec<(String, String, Option<String>, String)> =
        if table_exists(conn, "generation_history_items")? {
            let mut stmt = conn
            .prepare(
                "SELECT id, source_path, preview_path, snapshot_json FROM generation_history_items",
            )
            .map_err(|e| {
                format!(
                    "Failed to prepare generation history URI normalization query: {}",
                    e
                )
            })?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| {
                    format!(
                        "Failed to query generation history for URI normalization: {}",
                        e
                    )
                })?;
            let mut collected = Vec::new();
            for row in rows {
                collected.push(row.map_err(|e| {
                    format!(
                        "Failed to read generation history URI normalization row: {}",
                        e
                    )
                })?);
            }
            collected
        } else {
            Vec::new()
        };

    let queue_rows: Vec<(String, String)> = if table_exists(conn, "jimeng_video_queue_jobs")? {
        let mut stmt = conn
            .prepare("SELECT job_id, payload_json FROM jimeng_video_queue_jobs")
            .map_err(|e| format!("Failed to prepare Jimeng URI normalization query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query Jimeng queue for URI normalization: {}", e))?;
        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read Jimeng URI normalization row: {}", e))?,
            );
        }
        collected
    } else {
        Vec::new()
    };

    let clip_rows: Vec<(String, String, Option<String>, Option<String>)> =
        if table_exists(conn, "clip_items")? {
            let mut stmt = conn
                .prepare("SELECT id, source_path, preview_path, waveform_path FROM clip_items")
                .map_err(|e| format!("Failed to prepare clip URI normalization query: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .map_err(|e| format!("Failed to query clip items for URI normalization: {}", e))?;
            let mut collected = Vec::new();
            for row in rows {
                collected.push(
                    row.map_err(|e| format!("Failed to read clip URI normalization row: {}", e))?,
                );
            }
            collected
        } else {
            Vec::new()
        };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin URI normalization transaction: {}", e))?;

    for (project_id, nodes_json, history_json) in project_rows {
        let Some((next_nodes_json, next_history_json)) =
            encode_project_payload_storage_refs(app, &nodes_json, &history_json)?
        else {
            continue;
        };
        tx.execute(
            "UPDATE projects SET nodes_json = ?1, history_json = ?2 WHERE id = ?3",
            params![next_nodes_json, next_history_json, project_id],
        )
        .map_err(|e| format!("Failed to update normalized project media refs: {}", e))?;
        replace_project_image_refs(&tx, &project_id, &nodes_json, &history_json)?;
        stats.project_payloads_rewritten += 1;
    }

    for (asset_id, source_path, preview_path) in asset_rows {
        let next_source_path = encode(&source_path);
        let next_preview_path = preview_path.as_deref().map(encode);
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
        .map_err(|e| format!("Failed to update normalized asset media refs: {}", e))?;
        replace_asset_image_refs_in_tx(&tx, &asset_id, &source_path, preview_path.as_deref())?;
        stats.asset_items_rewritten += 1;
    }

    for (item_id, source_path, preview_path, snapshot_json) in generation_rows {
        let next_source_path = encode(&source_path);
        let next_preview_path = preview_path.as_deref().map(encode);
        let next_snapshot_json =
            storage::rewrite_media_refs_in_json_string(&snapshot_json, &encode)?
                .unwrap_or_else(|| snapshot_json.clone());
        if next_source_path == source_path
            && next_preview_path == preview_path
            && next_snapshot_json == snapshot_json
        {
            continue;
        }
        tx.execute(
            "UPDATE generation_history_items SET source_path = ?2, preview_path = ?3, snapshot_json = ?4 WHERE id = ?1",
            params![item_id, next_source_path, next_preview_path, next_snapshot_json],
        )
        .map_err(|e| format!("Failed to update normalized generation history refs: {}", e))?;
        stats.generation_history_items_rewritten += 1;
    }

    for (job_id, payload_json) in queue_rows {
        let Some(next_payload_json) =
            storage::rewrite_media_refs_in_json_string(&payload_json, &encode)?
        else {
            continue;
        };
        tx.execute(
            "UPDATE jimeng_video_queue_jobs SET payload_json = ?2 WHERE job_id = ?1",
            params![job_id, next_payload_json],
        )
        .map_err(|e| format!("Failed to update normalized Jimeng queue refs: {}", e))?;
        stats.jimeng_queue_jobs_rewritten += 1;
    }

    for (item_id, source_path, preview_path, waveform_path) in clip_rows {
        let next_source_path = encode(&source_path);
        let next_preview_path = preview_path.as_deref().map(encode);
        let next_waveform_path = waveform_path.as_deref().map(encode);
        if next_source_path == source_path
            && next_preview_path == preview_path
            && next_waveform_path == waveform_path
        {
            continue;
        }
        tx.execute(
            "UPDATE clip_items SET source_path = ?2, preview_path = ?3, waveform_path = ?4 WHERE id = ?1",
            params![item_id, next_source_path, next_preview_path, next_waveform_path],
        )
        .map_err(|e| format!("Failed to update normalized clip item refs: {}", e))?;
        stats.clip_items_rewritten += 1;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit URI normalization transaction: {}", e))?;
    rebuild_media_ref_indexes(app, conn)?;

    Ok(stats)
}

pub(crate) fn rebuild_media_ref_indexes(
    app: &AppHandle,
    conn: &mut Connection,
) -> Result<(), String> {
    ensure_projects_table(conn)?;

    let project_rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, nodes_json, history_json FROM projects")
            .map_err(|e| format!("Failed to prepare project media ref rebuild query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query projects for media ref rebuild: {}", e))?;
        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read project media ref rebuild row: {}", e))?,
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
            .map_err(|e| format!("Failed to prepare asset media ref rebuild query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query assets for media ref rebuild: {}", e))?;
        let mut collected = Vec::new();
        for row in rows {
            collected.push(
                row.map_err(|e| format!("Failed to read asset media ref rebuild row: {}", e))?,
            );
        }
        collected
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin media ref rebuild transaction: {}", e))?;

    for (project_id, nodes_json, history_json) in project_rows {
        let decoded_payload = decode_project_payload_storage_refs(app, &nodes_json, &history_json)?
            .unwrap_or((nodes_json, history_json));
        replace_project_image_refs(&tx, &project_id, &decoded_payload.0, &decoded_payload.1)?;
    }

    for (asset_id, source_path, preview_path) in asset_rows {
        let decoded_source_path = storage::decode_storage_media_ref(app, &source_path);
        let decoded_preview_path = preview_path
            .as_deref()
            .map(|value| storage::decode_storage_media_ref(app, value));
        replace_asset_image_refs_in_tx(
            &tx,
            &asset_id,
            &decoded_source_path,
            decoded_preview_path.as_deref(),
        )?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit media ref rebuild transaction: {}", e))?;
    Ok(())
}

pub(crate) fn prune_unreferenced_images(app: &AppHandle) -> Result<(), String> {
    let _ = app;
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

fn empty_style_template_state_record() -> StyleTemplateStateRecord {
    StyleTemplateStateRecord {
        categories_json: "[]".to_string(),
        templates_json: "[]".to_string(),
        updated_at: 0,
    }
}

fn validate_style_template_json_array(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok("[]".to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed)
        .map_err(|e| format!("Failed to parse style template {label} json: {}", e))?;
    if !parsed.is_array() {
        return Err(format!("Style template {label} json must be an array"));
    }

    serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to serialize style template {label} json: {}", e))
}

fn read_style_template_state_from_connection(
    conn: &Connection,
) -> Result<StyleTemplateStateRecord, String> {
    let result = conn.query_row(
        r#"
        SELECT categories_json, templates_json, updated_at
        FROM style_template_state
        WHERE id = ?1
        LIMIT 1
        "#,
        params![STYLE_TEMPLATE_STATE_ID],
        |row| {
            Ok(StyleTemplateStateRecord {
                categories_json: row.get(0)?,
                templates_json: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    );

    match result {
        Ok(record) => Ok(record),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(empty_style_template_state_record()),
        Err(error) => Err(format!("Failed to read style template state: {}", error)),
    }
}

fn save_style_template_state_in_connection(
    conn: &Connection,
    payload: &SaveStyleTemplateStatePayload,
) -> Result<StyleTemplateStateRecord, String> {
    let categories_json =
        validate_style_template_json_array(&payload.categories_json, "categories")?;
    let templates_json = validate_style_template_json_array(&payload.templates_json, "templates")?;
    let updated_at = now_timestamp_ms();

    conn.execute(
        r#"
        INSERT INTO style_template_state (
          id,
          categories_json,
          templates_json,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(id) DO UPDATE SET
          categories_json = excluded.categories_json,
          templates_json = excluded.templates_json,
          updated_at = excluded.updated_at
        "#,
        params![
            STYLE_TEMPLATE_STATE_ID,
            categories_json,
            templates_json,
            updated_at
        ],
    )
    .map_err(|e| format!("Failed to save style template state: {}", e))?;

    Ok(StyleTemplateStateRecord {
        categories_json,
        templates_json,
        updated_at,
    })
}

#[tauri::command]
pub fn get_style_template_state(app: AppHandle) -> Result<StyleTemplateStateRecord, String> {
    let conn = open_db(&app)?;
    read_style_template_state_from_connection(&conn)
}

#[tauri::command]
pub fn save_style_template_state(
    app: AppHandle,
    payload: SaveStyleTemplateStatePayload,
) -> Result<StyleTemplateStateRecord, String> {
    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin style template state transaction: {}", e))?;
    let record = save_style_template_state_in_connection(&tx, &payload)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit style template state transaction: {}", e))?;
    Ok(record)
}

#[tauri::command]
pub fn sync_style_template_image_refs(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    storage::ensure_storage_session_write_allowed(&app)?;
    let known_media_dirs = storage::resolve_known_media_dirs(&app)?;
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

        let relocated_path =
            storage::relocate_storage_path_to_known_media_dirs(trimmed, &known_media_dirs)
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
    storage::ensure_storage_session_write_allowed(app)?;
    let db_path = resolve_db_path(app)?;
    let mut conn =
        Connection::open(&db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal_mode=WAL: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to set synchronous=NORMAL: {}", e))?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .map_err(|e| format!("Failed to set temp_store=MEMORY: {}", e))?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    ensure_projects_table(&conn)?;
    import_legacy_projects_if_needed(&mut conn, app)?;
    let db_key = db_path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    let should_normalize = {
        let normalized = NORMALIZED_STORAGE_DBS.get_or_init(|| Mutex::new(HashSet::new()));
        let mut guard = normalized
            .lock()
            .map_err(|_| "Failed to lock normalized storage db set".to_string())?;
        guard.insert(db_key)
    };
    if should_normalize {
        let stats = normalize_storage_media_refs_in_connection(app, &mut conn)?;
        if stats.project_payloads_rewritten > 0
            || stats.asset_items_rewritten > 0
            || stats.generation_history_items_rewritten > 0
            || stats.jimeng_queue_jobs_rewritten > 0
            || stats.clip_items_rewritten > 0
        {
            tracing::info!("normalized storage media refs: {:?}", stats);
        }
    }
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
                    color_labels_json,
                    script_welcome_skipped
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
                script_welcome_skipped: row.get(16)?,
            })
        })
    };

    match result {
        Ok(mut record) => {
            repair_project_record_storage_aliases_if_needed(&mut conn, &app, &mut record)?;
            decode_project_record_storage_refs(&app, &mut record)?;
            Ok(Some(record))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project: {}", error)),
    }
}

#[tauri::command]
pub fn get_project_record_without_history(
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
                    color_labels_json,
                    script_welcome_skipped
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
                history_json: r#"{"past":[],"future":[]}"#.to_string(),
                color_labels_json: row.get(14)?,
                script_welcome_skipped: row.get(15)?,
            })
        })
    };

    match result {
        Ok(mut record) => {
            repair_project_record_storage_aliases_if_needed(&mut conn, &app, &mut record)?;
            decode_project_record_nodes_storage_refs(&app, &mut record)?;
            Ok(Some(record))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project: {}", error)),
    }
}

#[tauri::command]
pub fn get_project_history_record(
    app: AppHandle,
    project_id: String,
) -> Result<Option<ProjectHistoryRecord>, String> {
    let conn = open_db(&app)?;
    let result: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT history_json FROM projects WHERE id = ?1 LIMIT 1",
        params![project_id],
        |row| row.get(0),
    );

    match result {
        Ok(mut history_json) => {
            decode_project_history_storage_refs(&app, &mut history_json)?;
            Ok(Some(ProjectHistoryRecord {
                project_id,
                history_json,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project history: {}", error)),
    }
}

#[tauri::command]
pub fn upsert_project_record(app: AppHandle, mut record: ProjectRecord) -> Result<(), String> {
    storage::ensure_storage_session_write_allowed(&app)?;
    if let Some((next_nodes_json, next_history_json)) =
        rewrite_project_payload_media_paths_to_known_storage(
            &app,
            &record.nodes_json,
            &record.history_json,
        )?
    {
        record.nodes_json = next_nodes_json;
        record.history_json = next_history_json;
    }

    let mut conn = open_db(&app)?;
    guard_project_media_refs_before_upsert(&app, &conn, &record)?;
    let refs_nodes_json = record.nodes_json.clone();
    let refs_history_json = record.history_json.clone();
    encode_project_record_storage_refs(&app, &mut record)?;

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
            color_labels_json,
            script_welcome_skipped
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
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
            color_labels_json = excluded.color_labels_json,
            script_welcome_skipped = excluded.script_welcome_skipped
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
            record.script_welcome_skipped,
        ],
    )
    .map_err(|e| format!("Failed to upsert project: {}", e))?;

    replace_project_image_refs(&tx, &record.id, &refs_nodes_json, &refs_history_json)?;

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
    storage::ensure_storage_session_write_allowed(&app)?;
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
    storage::ensure_storage_session_write_allowed(&app)?;
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
    storage::ensure_storage_session_write_allowed(&app)?;
    let mut conn = open_db(&app)?;
    let project_media_root = storage::resolve_project_media_root(&app, &project_id)?;
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
    if table_exists(&tx, "generation_history_items")? {
        tx.execute(
            "DELETE FROM generation_history_items WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(|e| format!("Failed to delete generation history items: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit delete transaction: {}", e))?;

    prune_unreferenced_images(&app)?;
    if let Some(project_media_root) = project_media_root {
        if project_media_root.exists() && !media_ref_exists_under_dir(&conn, &project_media_root)? {
            storage::move_path_to_system_trash(&project_media_root)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn organize_project_media(
    app: AppHandle,
    project_id: String,
) -> Result<OrganizeProjectMediaResult, String> {
    storage::ensure_storage_session_write_allowed(&app)?;
    let normalized_project_id = project_id.trim().to_string();
    if normalized_project_id.is_empty() {
        return Err("Project id is required".to_string());
    }

    let mut conn = open_db(&app)?;
    let (nodes_json, history_json): (String, String) = conn
        .query_row(
            "SELECT nodes_json, history_json FROM projects WHERE id = ?1 LIMIT 1",
            params![&normalized_project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to load project for media organization: {}", e))?;
    let legacy_images_dirs = storage::resolve_known_storage_roots(&app)?
        .into_iter()
        .map(|root| root.join("images"))
        .collect::<Vec<_>>();
    let copied_by_source = RefCell::new(HashMap::<String, String>::new());
    let copied_count = RefCell::new(0_u64);

    let rewritten = rewrite_project_payload_media_paths(&nodes_json, &history_json, &|value| {
        let normalized_value = normalize_image_ref_path(value)?;
        if let Some(cached_path) = copied_by_source.borrow().get(&normalized_value) {
            return Some(cached_path.clone());
        }

        if !is_legacy_images_path(value, &legacy_images_dirs) {
            return None;
        }

        let local_path = PathBuf::from(value.trim());
        if !local_path.is_file() {
            return None;
        }

        let bytes = fs::read(&local_path).ok()?;
        if bytes.is_empty() {
            return None;
        }

        let extension = extension_from_local_path(&local_path);
        let media_context = storage::MediaPersistContext {
            project_id: Some(normalized_project_id.clone()),
            media_type: Some(storage::media_type_from_extension(&extension)),
            role: None,
        };
        let persisted_path = storage::persist_media_bytes(
            &app,
            &bytes,
            &extension,
            Some(&media_context),
            "original",
        )
        .ok()?;

        copied_by_source
            .borrow_mut()
            .insert(normalized_value, persisted_path.clone());
        *copied_count.borrow_mut() += 1;
        Some(persisted_path)
    })?;

    let Some((next_nodes_json, next_history_json)) = rewritten else {
        return Ok(OrganizeProjectMediaResult {
            project_id: normalized_project_id,
            rewritten: false,
            copied_count: *copied_count.borrow(),
        });
    };

    let (persisted_nodes_json, persisted_history_json) =
        encode_project_payload_storage_refs(&app, &next_nodes_json, &next_history_json)?
            .unwrap_or((next_nodes_json.clone(), next_history_json.clone()));

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin media organization transaction: {}", e))?;
    update_project_payload_in_tx(
        &tx,
        &normalized_project_id,
        &persisted_nodes_json,
        &persisted_history_json,
    )?;
    replace_project_image_refs(
        &tx,
        &normalized_project_id,
        &next_nodes_json,
        &next_history_json,
    )?;
    tx.commit()
        .map_err(|e| format!("Failed to commit media organization transaction: {}", e))?;

    let copied_count = *copied_count.borrow();
    Ok(OrganizeProjectMediaResult {
        project_id: normalized_project_id,
        rewritten: true,
        copied_count,
    })
}

#[cfg(test)]
mod tests {
    use super::storage;
    use super::{
        ensure_projects_table, extract_project_image_paths, find_restore_target_project_id,
        normalize_image_ref_path, project_has_meaningful_content,
        read_style_template_state_from_connection, read_table_columns,
        rewrite_project_payload_media_paths, save_style_template_state_in_connection,
        LegacyProjectPayload, SaveStyleTemplateStatePayload,
    };
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

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
        let has_script_welcome_skipped: bool = conn
            .prepare("PRAGMA table_info(projects)")
            .expect("failed to prepare pragma")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("failed to read pragma rows")
            .flatten()
            .any(|column_name| column_name == "script_welcome_skipped");
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
        assert!(
            has_script_welcome_skipped,
            "script_welcome_skipped should be added for legacy projects"
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

        let legacy_project_script_welcome_skipped: bool = conn
            .query_row(
                "SELECT script_welcome_skipped FROM projects WHERE id = 'legacy-project'",
                [],
                |row| row.get(0),
            )
            .expect("failed to read legacy project script welcome flag");
        assert!(
            !legacy_project_script_welcome_skipped,
            "legacy projects should default script_welcome_skipped to false"
        );
    }

    #[test]
    fn style_template_state_empty_read_returns_empty_arrays() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        ensure_projects_table(&conn).expect("failed to prepare projects schema");

        let state = read_style_template_state_from_connection(&conn)
            .expect("empty style template state should read");

        assert_eq!(state.categories_json, "[]");
        assert_eq!(state.templates_json, "[]");
        assert_eq!(state.updated_at, 0);
    }

    #[test]
    fn style_template_state_round_trips_saved_payload() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        ensure_projects_table(&conn).expect("failed to prepare projects schema");

        let saved = save_style_template_state_in_connection(
            &conn,
            &SaveStyleTemplateStatePayload {
                categories_json:
                    r#"[{"id":"category-1","name":"Custom","sortOrder":0,"createdAt":1,"updatedAt":1}]"#
                        .to_string(),
                templates_json:
                    r#"[{"id":"template-1","name":"Look","prompt":"cinematic","imageUrl":null,"categoryId":"category-1","sortOrder":0,"createdAt":1,"updatedAt":1,"lastUsedAt":null}]"#
                        .to_string(),
            },
        )
        .expect("style template state should save");
        let loaded = read_style_template_state_from_connection(&conn)
            .expect("saved style template state should read");

        assert_eq!(loaded.categories_json, saved.categories_json);
        assert_eq!(loaded.templates_json, saved.templates_json);
        assert!(loaded.updated_at > 0);
    }

    #[test]
    fn ensure_projects_table_preserves_projects_when_adding_style_template_state() {
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
            "#,
        )
        .expect("failed to seed legacy projects table");

        ensure_projects_table(&conn).expect("schema migration should succeed");

        let project_name: String = conn
            .query_row(
                "SELECT name FROM projects WHERE id = 'project-1'",
                [],
                |row| row.get(0),
            )
            .expect("existing project should remain readable");
        let style_columns = read_table_columns(&conn, "style_template_state")
            .expect("style_template_state schema should be readable");

        assert_eq!(project_name, "Storyboard A");
        assert!(style_columns.contains("categories_json"));
        assert!(style_columns.contains("templates_json"));
        assert!(style_columns.contains("updated_at"));
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
            storage::relocate_storage_path_to_known_images_dirs(
                value,
                std::slice::from_ref(&images_dir),
            )
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
            storage::relocate_storage_path_to_known_images_dirs(
                value,
                std::slice::from_ref(&images_dir),
            )
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

    #[test]
    fn project_has_meaningful_content_detects_non_empty_nodes_and_history() {
        assert!(!project_has_meaningful_content(
            0,
            r#"{"nodes":[],"imagePool":[]}"#,
            r#"{"past":[],"future":[]}"#
        ));
        assert!(project_has_meaningful_content(
            1,
            r#"{"nodes":[]}"#,
            r#"{"past":[],"future":[]}"#
        ));
        assert!(project_has_meaningful_content(
            0,
            r#"[{"id":"node-1","type":"image","data":{}}]"#,
            r#"{"past":[],"future":[]}"#
        ));
        assert!(project_has_meaningful_content(
            0,
            r#"{"nodes":[]}"#,
            r#"{"past":[{"nodes":[],"edges":[]}],"future":[]}"#
        ));
    }

    #[test]
    fn find_restore_target_project_id_only_matches_same_id_blank_project() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        ensure_projects_table(&conn).expect("failed to prepare projects schema");
        conn.execute_batch(
            r#"
            INSERT INTO projects (
              id, name, project_type, created_at, updated_at, node_count,
              nodes_json, edges_json, viewport_json, history_json, color_labels_json, script_welcome_skipped
            ) VALUES
              ('legacy-ep2', '第二集', 'storyboard', 1, 10, 0, '[]', '[]', '{}', '{"past":[],"future":[]}', '{}', 0),
              ('filled-ep2', '第二集', 'storyboard', 1, 9, 2, '[{"id":"a"},{"id":"b"}]', '[]', '{}', '{"past":[],"future":[]}', '{}', 0),
              ('other-project', '第一集', 'storyboard', 1, 8, 0, '[]', '[]', '{}', '{"past":[],"future":[]}', '{}', 0);
            "#,
        )
        .expect("failed to seed projects");

        let legacy_payload = LegacyProjectPayload {
            legacy_id: "legacy-ep2".to_string(),
            source_dir: PathBuf::from("C:/legacy/projects/legacy-ep2"),
            nodes_json: r#"[{"id":"legacy-node","type":"directorStageNode","data":{}}]"#
                .to_string(),
            edges_json: "[]".to_string(),
            viewport_json: "{}".to_string(),
            history_json: r#"{"past":[{"nodes":[],"edges":[]}],"future":[]}"#.to_string(),
            node_count: 1,
        };

        let matched = find_restore_target_project_id(&conn, &legacy_payload)
            .expect("restore target query should succeed");
        assert_eq!(matched.as_deref(), Some("legacy-ep2"));
    }
}
