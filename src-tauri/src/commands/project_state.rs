use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
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
          history_json TEXT NOT NULL
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
        "#,
    )
    .map_err(|e| format!("Failed to initialize projects table: {}", e))?;

    let mut has_node_count = false;
    let mut has_project_type = false;
    let mut has_asset_library_id = false;
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

    Ok(())
}

fn parse_image_pool(history_json: &str) -> Vec<String> {
    let parsed: serde_json::Value = match serde_json::from_str(history_json) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parsed
        .get("imagePool")
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str().map(|item| item.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_image_ref(value: &str, image_pool: &[String]) -> Option<String> {
    const IMAGE_REF_PREFIX: &str = "__img_ref__:";

    if let Some(index_text) = value.strip_prefix(IMAGE_REF_PREFIX) {
        let index = index_text.parse::<usize>().ok()?;
        return image_pool.get(index).cloned();
    }

    if value.trim().is_empty() {
        return None;
    }

    Some(value.to_string())
}

fn collect_image_paths_from_nodes(
    nodes: &[serde_json::Value],
    image_pool: &[String],
    paths: &mut HashSet<String>,
) {
    for node in nodes {
        let data = match node.get("data").and_then(|value| value.as_object()) {
            Some(value) => value,
            Option::None => continue,
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
    }
}

fn extract_project_image_paths(nodes_json: &str, history_json: &str) -> HashSet<String> {
    let image_pool = parse_image_pool(history_json);
    let mut paths = HashSet::new();

    if let Ok(parsed_nodes) = serde_json::from_str::<serde_json::Value>(nodes_json) {
        if let Some(nodes) = parsed_nodes.as_array() {
            collect_image_paths_from_nodes(nodes, &image_pool, &mut paths);
        }
    }

    if let Ok(parsed_history) = serde_json::from_str::<serde_json::Value>(history_json) {
        for timeline_key in ["past", "future"] {
            let Some(timeline) = parsed_history
                .get(timeline_key)
                .and_then(|value| value.as_array())
            else {
                continue;
            };

            for snapshot in timeline {
                let Some(nodes) = snapshot.get("nodes").and_then(|value| value.as_array()) else {
                    continue;
                };
                collect_image_paths_from_nodes(nodes, &image_pool, &mut paths);
            }
        }
    }

    paths
}

fn resolve_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    storage::resolve_images_dir(app)
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
            let path =
                path_result.map_err(|e| format!("Failed to decode image ref row: {}", e))?;
            referenced.insert(path);
        }
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
        if !referenced.contains(&path_string) {
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
        tx.execute(
            "INSERT OR IGNORE INTO project_image_refs (project_id, path) VALUES (?1, ?2)",
            params![project_id, path],
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
              node_count,
              nodes_json,
              edges_json,
              viewport_json,
              history_json
            FROM projects
            WHERE id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("Failed to prepare get project query: {}", e))?;

    let result = stmt.query_row(params![project_id], |row| {
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
        })
    });

    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project: {}", error)),
    }
}

#[tauri::command]
pub fn upsert_project_record(app: AppHandle, record: ProjectRecord) -> Result<(), String> {
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
          history_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
          history_json = excluded.history_json
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

    tx.commit()
        .map_err(|e| format!("Failed to commit delete transaction: {}", e))?;

    prune_unreferenced_images(&app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ensure_projects_table;
    use rusqlite::Connection;

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
        assert!(has_asset_library_id, "asset_library_id should be added for legacy projects");

        let legacy_project_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects WHERE id = 'legacy-project'", [], |row| {
                row.get(0)
            })
            .expect("failed to count legacy project");
        assert_eq!(legacy_project_count, 1, "existing projects should remain readable");
    }
}
