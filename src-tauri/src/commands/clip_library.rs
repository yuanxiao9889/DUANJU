use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::project_state::{open_db, project_nodes_array, project_nodes_array_mut, ProjectRecord};

const DEFAULT_LIBRARY_NAME: &str = "Untitled Clip Library";
const DEFAULT_CHAPTER_NAME: &str = "Untitled Chapter";
const DEFAULT_SHOT_NAME: &str = "Untitled Shot";
const DEFAULT_SCRIPT_NAME: &str = "Untitled Script";
const DEFAULT_ITEM_NAME: &str = "Untitled Item";
const VIDEO_NODE_TYPE: &str = "videoNode";
const AUDIO_NODE_TYPE: &str = "audioNode";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLibraryRecord {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLibraryChapterRecord {
    pub id: String,
    pub library_id: String,
    pub name: String,
    pub sort_order: i64,
    pub fs_name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipFolderRecord {
    pub id: String,
    pub library_id: String,
    pub chapter_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub sort_order: i64,
    pub shot_order: Option<i64>,
    pub number_code: Option<String>,
    pub fs_name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipItemRecord {
    pub id: String,
    pub library_id: String,
    pub folder_id: String,
    pub media_type: String,
    pub name: String,
    pub description_text: String,
    pub file_name: String,
    pub source_path: String,
    pub preview_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub mime_type: Option<String>,
    pub waveform_path: Option<String>,
    pub source_node_id: Option<String>,
    pub source_node_title: Option<String>,
    pub source_project_id: Option<String>,
    pub source_project_name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLibraryUiStateRecord {
    pub library_id: String,
    pub expanded_keys_json: String,
    pub selected_key: Option<String>,
    pub scroll_top: f64,
    pub left_width: Option<f64>,
    pub right_width: Option<f64>,
    pub last_filter_json: String,
    pub always_on_top: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLibrarySnapshot {
    pub library: ClipLibraryRecord,
    pub chapters: Vec<ClipLibraryChapterRecord>,
    pub folders: Vec<ClipFolderRecord>,
    pub items: Vec<ClipItemRecord>,
    pub ui_state: Option<ClipLibraryUiStateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClipLibraryPayload {
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClipLibraryPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClipLibraryChapterPayload {
    pub library_id: String,
    pub name: String,
    pub insert_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClipLibraryChapterPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveClipLibraryChapterPayload {
    pub chapter_id: String,
    pub target_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClipFolderPayload {
    pub library_id: String,
    pub chapter_id: Option<String>,
    pub parent_id: Option<String>,
    pub kind: String,
    pub name: Option<String>,
    pub insert_before_id: Option<String>,
    pub insert_after_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveClipFolderPayload {
    pub folder_id: String,
    pub target_chapter_id: Option<String>,
    pub target_parent_id: Option<String>,
    pub target_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameClipFolderPayload {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClipItemDescriptionPayload {
    pub item_id: String,
    pub description_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameClipItemPayload {
    pub item_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveClipItemPayload {
    pub item_id: String,
    pub target_folder_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClipLibraryUiStatePayload {
    pub library_id: String,
    pub expanded_keys_json: String,
    pub selected_key: Option<String>,
    pub scroll_top: f64,
    pub left_width: Option<f64>,
    pub right_width: Option<f64>,
    pub last_filter_json: String,
    pub always_on_top: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDeleteImpactQuery {
    pub library_id: Option<String>,
    pub chapter_id: Option<String>,
    pub folder_id: Option<String>,
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDeleteImpactRecord {
    pub project_count: i64,
    pub node_count: i64,
    pub folder_count: i64,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNodeMediaToClipLibraryPayload {
    pub project_id: String,
    pub node_id: String,
    pub library_id: String,
    pub folder_id: String,
    pub media_override: Option<AddNodeMediaToClipLibraryMediaOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNodeMediaToClipLibraryResult {
    pub item: ClipItemRecord,
    pub clip_library_id: String,
    pub clip_folder_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNodeMediaToClipLibraryMediaOverride {
    pub media_type: String,
    pub source_path: String,
    pub preview_path: Option<String>,
    pub title: Option<String>,
    pub description_text: Option<String>,
    pub duration_ms: Option<i64>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ProjectNodeMediaRecord {
    node_id: String,
    media_type: String,
    title: String,
    description_text: String,
    source_path: String,
    preview_path: Option<String>,
    duration_ms: Option<i64>,
    mime_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ProjectBindingStateRecord {
    id: String,
    clip_library_id: Option<String>,
    clip_last_folder_id: Option<String>,
    nodes_json: String,
    history_json: String,
}

#[derive(Debug, Clone)]
struct BindingPatchTarget {
    library_id: Option<String>,
    folder_ids: HashSet<String>,
    item_ids: HashSet<String>,
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_required_name(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
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

fn normalize_folder_kind(value: &str) -> Result<&str, String> {
    match value.trim() {
        "shot" => Ok("shot"),
        "script" => Ok("script"),
        _ => Err("Clip folder kind must be either 'shot' or 'script'".to_string()),
    }
}

fn pad_code(order: usize) -> String {
    if order >= 100 {
        order.to_string()
    } else {
        format!("{order:02}")
    }
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

fn resolve_local_path(value: &str) -> Option<PathBuf> {
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

fn sanitize_fs_component(value: &str, fallback: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .trim()
        .to_string();

    while sanitized.contains("  ") {
        sanitized = sanitized.replace("  ", " ");
    }

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory {}: {}", path.display(), e))
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

fn unique_path_with_suffix(base_dir: &Path, file_name: &str) -> PathBuf {
    let candidate = base_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let file_path = Path::new(file_name);
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let extension = file_path.extension().and_then(|value| value.to_str());

    let mut index = 2usize;
    loop {
        let next_name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem}-{index}.{extension}"),
            _ => format!("{stem}-{index}"),
        };
        let next_path = base_dir.join(next_name);
        if !next_path.exists() {
            return next_path;
        }
        index += 1;
    }
}

fn copy_file_to_dir(
    source_path: &Path,
    target_dir: &Path,
    preferred_name: &str,
) -> Result<String, String> {
    ensure_dir(target_dir)?;
    let target_path = unique_path_with_suffix(target_dir, preferred_name);
    fs::copy(source_path, &target_path).map_err(|e| {
        format!(
            "Failed to copy media from {} to {}: {}",
            source_path.display(),
            target_path.display(),
            e
        )
    })?;

    Ok(target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(preferred_name)
        .to_string())
}

fn preferred_file_name_from_path(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_fs_component(value, fallback))
        .unwrap_or_else(|| fallback.to_string())
}

fn build_preview_fallback_name(source_path: &Path, preview_path: &Path) -> String {
    let preview_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_fs_component(&format!("{value}-preview"), "preview"))
        .unwrap_or_else(|| "preview".to_string());
    let preview_extension = preview_path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    format!("{preview_stem}{preview_extension}")
}

fn copy_optional_preview_to_dir(
    preview_path: Option<&str>,
    source_path: &Path,
    target_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(preview_path) = preview_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let Some(resolved_preview_path) = resolve_local_path(preview_path) else {
        return Ok(None);
    };
    if !resolved_preview_path.exists() {
        return Ok(None);
    }

    let fallback_name = build_preview_fallback_name(source_path, &resolved_preview_path);
    let preferred_name = preferred_file_name_from_path(&resolved_preview_path, &fallback_name);
    let copied_file_name = copy_file_to_dir(&resolved_preview_path, target_dir, &preferred_name)?;

    Ok(Some(
        target_dir
            .join(copied_file_name)
            .to_string_lossy()
            .to_string(),
    ))
}

fn move_file_to_dir(
    source_path: &Path,
    target_dir: &Path,
    preferred_name: &str,
) -> Result<String, String> {
    ensure_dir(target_dir)?;
    let target_path = unique_path_with_suffix(target_dir, preferred_name);

    match fs::rename(source_path, &target_path) {
        Ok(_) => {}
        Err(_) => {
            fs::copy(source_path, &target_path).map_err(|e| {
                format!(
                    "Failed to move media from {} to {}: {}",
                    source_path.display(),
                    target_path.display(),
                    e
                )
            })?;
            let _ = fs::remove_file(source_path);
        }
    }

    Ok(target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(preferred_name)
        .to_string())
}

fn sync_optional_preview_path_to_dir(
    preview_path: Option<&str>,
    source_path: &Path,
    target_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(preview_path) = preview_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let Some(resolved_preview_path) = resolve_local_path(preview_path) else {
        return Ok(Some(preview_path.to_string()));
    };

    let fallback_name = build_preview_fallback_name(source_path, &resolved_preview_path);
    let preferred_name = preferred_file_name_from_path(&resolved_preview_path, &fallback_name);
    let target_path = target_dir.join(&preferred_name);
    if resolved_preview_path == target_path {
        return Ok(Some(target_path.to_string_lossy().to_string()));
    }

    if resolved_preview_path.exists() {
        let moved_file_name =
            move_file_to_dir(&resolved_preview_path, target_dir, &preferred_name)?;
        return Ok(Some(
            target_dir
                .join(moved_file_name)
                .to_string_lossy()
                .to_string(),
        ));
    }

    if target_path.exists() {
        return Ok(Some(target_path.to_string_lossy().to_string()));
    }

    Ok(Some(preview_path.to_string()))
}

fn normalize_path_for_prefix_match(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(target_os = "windows") {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn is_path_within_dir(path: &Path, dir: &Path) -> bool {
    let normalized_path = normalize_path_for_prefix_match(path);
    let mut normalized_dir = normalize_path_for_prefix_match(dir);
    if !normalized_dir.ends_with('/') {
        normalized_dir.push('/');
    }

    normalized_path == normalized_dir.trim_end_matches('/')
        || normalized_path.starts_with(&normalized_dir)
}

fn maybe_remove_path(path: Option<&str>, root_path: &Path) {
    let Some(value) = path else {
        return;
    };
    let Some(local_path) = resolve_local_path(value) else {
        return;
    };
    if !is_path_within_dir(&local_path, root_path) {
        return;
    }
    let _ = fs::remove_file(&local_path);
}

fn infer_mime_from_path(path: &Path, media_type: &str) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match (media_type, extension.as_str()) {
        ("video", "mp4") => "video/mp4",
        ("video", "mov") => "video/quicktime",
        ("video", "mkv") => "video/x-matroska",
        ("video", "webm") => "video/webm",
        ("video", "avi") => "video/x-msvideo",
        ("audio", "wav") => "audio/wav",
        ("audio", "mp3") => "audio/mpeg",
        ("audio", "ogg") => "audio/ogg",
        ("audio", "m4a") => "audio/mp4",
        ("audio", "flac") => "audio/flac",
        _ => return None,
    };
    Some(mime.to_string())
}

fn build_chapter_display_name(code: &str, name: &str) -> String {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        code.to_string()
    } else {
        format!("{code} {trimmed_name}")
    }
}

fn build_numbered_display_name(number_code: &str, name: &str) -> String {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        number_code.to_string()
    } else {
        format!("{number_code} {trimmed_name}")
    }
}

fn extract_description_text(data: &Map<String, Value>) -> String {
    for key in [
        "descriptionText",
        "nodeDescription",
        "description",
        "prompt",
        "note",
        "caption",
        "scriptText",
    ] {
        if let Some(value) = data
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return value.to_string();
        }
    }
    String::new()
}

fn collect_string_array_values(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

fn extract_project_media_image_pool(
    parsed_nodes: &Value,
    parsed_history: Option<&Value>,
) -> Vec<String> {
    let image_pool = collect_string_array_values(parsed_nodes.get("imagePool"));
    if !image_pool.is_empty() {
        return image_pool;
    }

    collect_string_array_values(parsed_history.and_then(|value| value.get("imagePool")))
}

fn resolve_project_media_ref(value: &str, image_pool: &[String]) -> Option<String> {
    const IMAGE_REF_PREFIX: &str = "__img_ref__:";

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(index_text) = trimmed.strip_prefix(IMAGE_REF_PREFIX) {
        let index = index_text.parse::<usize>().ok()?;
        return image_pool
            .get(index)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
    }

    Some(trimmed.to_string())
}

fn allow_clip_library_root_asset_scope(app: &AppHandle, root_path: &Path) -> Result<(), String> {
    ensure_dir(root_path)?;
    app.asset_protocol_scope()
        .allow_directory(root_path, true)
        .map_err(|error| {
            format!(
                "Failed to allow clip library root for asset protocol ({}): {}",
                root_path.display(),
                error
            )
        })?;
    Ok(())
}

fn allow_clip_library_asset_scope(app: &AppHandle, root_path: &str) -> Result<(), String> {
    let trimmed_root_path = root_path.trim();
    if trimmed_root_path.is_empty() {
        return Err("Clip library root path is required".to_string());
    }

    let resolved_root_path =
        resolve_local_path(trimmed_root_path).unwrap_or_else(|| PathBuf::from(trimmed_root_path));
    allow_clip_library_root_asset_scope(app, &resolved_root_path)
}

fn read_clip_library(conn: &Connection, library_id: &str) -> Result<ClipLibraryRecord, String> {
    conn.query_row(
        r#"
        SELECT id, name, root_path, created_at, updated_at
        FROM clip_libraries
        WHERE id = ?1
        LIMIT 1
        "#,
        params![library_id],
        |row| {
            Ok(ClipLibraryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|_| "The requested clip library could not be found".to_string())
}

fn read_clip_library_chapters(
    conn: &Connection,
    library_id: &str,
) -> Result<Vec<ClipLibraryChapterRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, library_id, name, sort_order, fs_name, created_at, updated_at
            FROM clip_library_chapters
            WHERE library_id = ?1
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare clip chapters query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id], |row| {
            Ok(ClipLibraryChapterRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                name: row.get(2)?,
                sort_order: row.get(3)?,
                fs_name: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query clip chapters: {}", e))?;

    let mut chapters = Vec::new();
    for row in rows {
        chapters.push(row.map_err(|e| format!("Failed to decode clip chapter row: {}", e))?);
    }
    Ok(chapters)
}

fn read_clip_folders(conn: &Connection, library_id: &str) -> Result<Vec<ClipFolderRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              library_id,
              chapter_id,
              parent_id,
              kind,
              name,
              sort_order,
              shot_order,
              number_code,
              fs_name,
              created_at,
              updated_at
            FROM clip_folders
            WHERE library_id = ?1
            ORDER BY chapter_id ASC, parent_id ASC, sort_order ASC, created_at ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare clip folders query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id], |row| {
            Ok(ClipFolderRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                chapter_id: row.get(2)?,
                parent_id: row.get(3)?,
                kind: row.get(4)?,
                name: row.get(5)?,
                sort_order: row.get(6)?,
                shot_order: row.get(7)?,
                number_code: row.get(8)?,
                fs_name: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query clip folders: {}", e))?;

    let mut folders = Vec::new();
    for row in rows {
        folders.push(row.map_err(|e| format!("Failed to decode clip folder row: {}", e))?);
    }
    Ok(folders)
}

fn read_clip_items(conn: &Connection, library_id: &str) -> Result<Vec<ClipItemRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              library_id,
              folder_id,
              media_type,
              name,
              description_text,
              file_name,
              source_path,
              preview_path,
              duration_ms,
              mime_type,
              waveform_path,
              source_node_id,
              source_node_title,
              source_project_id,
              source_project_name,
              created_at,
              updated_at
            FROM clip_items
            WHERE library_id = ?1
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare clip items query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id], |row| {
            Ok(ClipItemRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                folder_id: row.get(2)?,
                media_type: row.get(3)?,
                name: row.get(4)?,
                description_text: row.get(5)?,
                file_name: row.get(6)?,
                source_path: row.get(7)?,
                preview_path: row.get(8)?,
                duration_ms: row.get(9)?,
                mime_type: row.get(10)?,
                waveform_path: row.get(11)?,
                source_node_id: row.get(12)?,
                source_node_title: row.get(13)?,
                source_project_id: row.get(14)?,
                source_project_name: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })
        .map_err(|e| format!("Failed to query clip items: {}", e))?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("Failed to decode clip item row: {}", e))?);
    }
    Ok(items)
}

fn read_clip_library_ui_state(
    conn: &Connection,
    library_id: &str,
) -> Result<Option<ClipLibraryUiStateRecord>, String> {
    conn.query_row(
        r#"
        SELECT
          library_id,
          expanded_keys_json,
          selected_key,
          scroll_top,
          left_width,
          right_width,
          last_filter_json,
          always_on_top,
          updated_at
        FROM clip_library_ui_state
        WHERE library_id = ?1
        LIMIT 1
        "#,
        params![library_id],
        |row| {
            Ok(ClipLibraryUiStateRecord {
                library_id: row.get(0)?,
                expanded_keys_json: row.get(1)?,
                selected_key: row.get(2)?,
                scroll_top: row.get(3)?,
                left_width: row.get(4)?,
                right_width: row.get(5)?,
                last_filter_json: row.get(6)?,
                always_on_top: row.get::<_, i64>(7)? != 0,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to load clip library ui state: {}", e))
}

fn read_chapter(conn: &Connection, chapter_id: &str) -> Result<ClipLibraryChapterRecord, String> {
    conn.query_row(
        r#"
        SELECT id, library_id, name, sort_order, fs_name, created_at, updated_at
        FROM clip_library_chapters
        WHERE id = ?1
        LIMIT 1
        "#,
        params![chapter_id],
        |row| {
            Ok(ClipLibraryChapterRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                name: row.get(2)?,
                sort_order: row.get(3)?,
                fs_name: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|_| "The requested clip chapter could not be found".to_string())
}

fn read_folder(conn: &Connection, folder_id: &str) -> Result<ClipFolderRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          library_id,
          chapter_id,
          parent_id,
          kind,
          name,
          sort_order,
          shot_order,
          number_code,
          fs_name,
          created_at,
          updated_at
        FROM clip_folders
        WHERE id = ?1
        LIMIT 1
        "#,
        params![folder_id],
        |row| {
            Ok(ClipFolderRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                chapter_id: row.get(2)?,
                parent_id: row.get(3)?,
                kind: row.get(4)?,
                name: row.get(5)?,
                sort_order: row.get(6)?,
                shot_order: row.get(7)?,
                number_code: row.get(8)?,
                fs_name: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        },
    )
    .map_err(|_| "The requested clip folder could not be found".to_string())
}

fn read_item(conn: &Connection, item_id: &str) -> Result<ClipItemRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          library_id,
          folder_id,
          media_type,
          name,
          description_text,
          file_name,
          source_path,
          preview_path,
          duration_ms,
          mime_type,
          waveform_path,
          source_node_id,
          source_node_title,
          source_project_id,
          source_project_name,
          created_at,
          updated_at
        FROM clip_items
        WHERE id = ?1
        LIMIT 1
        "#,
        params![item_id],
        |row| {
            Ok(ClipItemRecord {
                id: row.get(0)?,
                library_id: row.get(1)?,
                folder_id: row.get(2)?,
                media_type: row.get(3)?,
                name: row.get(4)?,
                description_text: row.get(5)?,
                file_name: row.get(6)?,
                source_path: row.get(7)?,
                preview_path: row.get(8)?,
                duration_ms: row.get(9)?,
                mime_type: row.get(10)?,
                waveform_path: row.get(11)?,
                source_node_id: row.get(12)?,
                source_node_title: row.get(13)?,
                source_project_id: row.get(14)?,
                source_project_name: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        },
    )
    .map_err(|_| "The requested clip item could not be found".to_string())
}

fn build_clip_library_snapshot(
    conn: &Connection,
    library_id: &str,
) -> Result<ClipLibrarySnapshot, String> {
    Ok(ClipLibrarySnapshot {
        library: read_clip_library(conn, library_id)?,
        chapters: read_clip_library_chapters(conn, library_id)?,
        folders: read_clip_folders(conn, library_id)?,
        items: read_clip_items(conn, library_id)?,
        ui_state: read_clip_library_ui_state(conn, library_id)?,
    })
}

fn touch_library_updated_at(tx: &Transaction<'_>, library_id: &str) -> Result<(), String> {
    tx.execute(
        "UPDATE clip_libraries SET updated_at = ?1 WHERE id = ?2",
        params![current_timestamp_ms(), library_id],
    )
    .map_err(|e| format!("Failed to touch clip library updated_at: {}", e))?;
    Ok(())
}

fn load_project_record(conn: &Connection, project_id: &str) -> Result<ProjectRecord, String> {
    conn.query_row(
        r#"
        SELECT
          id,
          name,
          COALESCE(project_type, 'storyboard'),
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
        params![project_id],
        |row| {
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
        },
    )
    .map_err(|_| "The requested project could not be found".to_string())
}

fn load_project_binding_states(
    conn: &Connection,
) -> Result<Vec<ProjectBindingStateRecord>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, clip_library_id, clip_last_folder_id, nodes_json, history_json
            FROM projects
            ORDER BY updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare project binding state query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectBindingStateRecord {
                id: row.get(0)?,
                clip_library_id: row.get(1)?,
                clip_last_folder_id: row.get(2)?,
                nodes_json: row.get(3)?,
                history_json: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query project binding states: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records
            .push(row.map_err(|e| format!("Failed to decode project binding state row: {}", e))?);
    }
    Ok(records)
}

fn ordered_chapter_ids(conn: &Connection, library_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id
            FROM clip_library_chapters
            WHERE library_id = ?1
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare ordered chapter query: {}", e))?;
    let rows = stmt
        .query_map(params![library_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query ordered chapters: {}", e))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("Failed to decode ordered chapter row: {}", e))?);
    }
    Ok(ids)
}

fn ordered_folder_ids(
    conn: &Connection,
    library_id: &str,
    chapter_id: &str,
    parent_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id
            FROM clip_folders
            WHERE library_id = ?1 AND chapter_id = ?2 AND
              ((?3 IS NULL AND parent_id IS NULL) OR parent_id = ?3)
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare ordered folder query: {}", e))?;

    let rows = stmt
        .query_map(params![library_id, chapter_id, parent_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| format!("Failed to query ordered folders: {}", e))?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| format!("Failed to decode ordered folder row: {}", e))?);
    }
    Ok(ids)
}

fn write_chapter_sort_orders(
    tx: &Transaction<'_>,
    library_id: &str,
    ordered_ids: &[String],
) -> Result<(), String> {
    let now = current_timestamp_ms();
    for (index, chapter_id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE clip_library_chapters SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND library_id = ?4",
            params![index as i64, now, chapter_id, library_id],
        )
        .map_err(|e| format!("Failed to write clip chapter sort order: {}", e))?;
    }
    Ok(())
}

fn write_folder_sort_orders(
    tx: &Transaction<'_>,
    library_id: &str,
    chapter_id: &str,
    parent_id: Option<&str>,
    ordered_ids: &[String],
) -> Result<(), String> {
    let now = current_timestamp_ms();
    for (index, folder_id) in ordered_ids.iter().enumerate() {
        tx.execute(
            r#"
            UPDATE clip_folders
            SET sort_order = ?1, updated_at = ?2
            WHERE id = ?3 AND library_id = ?4 AND chapter_id = ?5 AND
              ((?6 IS NULL AND parent_id IS NULL) OR parent_id = ?6)
            "#,
            params![
                index as i64,
                now,
                folder_id,
                library_id,
                chapter_id,
                parent_id
            ],
        )
        .map_err(|e| format!("Failed to write clip folder sort order: {}", e))?;
    }
    Ok(())
}

fn clamp_insert_index(index: Option<i64>, length: usize) -> usize {
    match index {
        Some(value) if value <= 0 => 0,
        Some(value) => usize::min(value as usize, length),
        None => length,
    }
}

fn insert_id_at(ids: &mut Vec<String>, id: String, target_index: usize) {
    ids.insert(target_index.min(ids.len()), id);
}

fn relocate_id(ids: &mut Vec<String>, id: &str, target_index: usize) -> Result<(), String> {
    let current_index = ids.iter().position(|value| value == id).ok_or_else(|| {
        "The requested record could not be found in the current ordering".to_string()
    })?;
    let value = ids.remove(current_index);
    let next_index = target_index.min(ids.len());
    ids.insert(next_index, value);
    Ok(())
}

fn folder_children_by_parent(
    snapshot: &ClipLibrarySnapshot,
) -> BTreeMap<Option<String>, Vec<ClipFolderRecord>> {
    let mut result = BTreeMap::new();
    for folder in &snapshot.folders {
        result
            .entry(folder.parent_id.clone())
            .or_insert_with(Vec::new)
            .push(folder.clone());
    }
    for items in result.values_mut() {
        items.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.created_at.cmp(&right.created_at))
        });
    }
    result
}

fn recompute_clip_library_layout(tx: &Transaction<'_>, library_id: &str) -> Result<(), String> {
    let chapters = read_clip_library_chapters(tx, library_id)?;
    let folders = read_clip_folders(tx, library_id)?;
    let chapter_code_map = chapters
        .iter()
        .enumerate()
        .map(|(index, chapter)| (chapter.id.clone(), pad_code(index + 1)))
        .collect::<HashMap<_, _>>();
    let now = current_timestamp_ms();

    for (index, chapter) in chapters.iter().enumerate() {
        let chapter_code = chapter_code_map
            .get(&chapter.id)
            .cloned()
            .unwrap_or_else(|| pad_code(index + 1));
        tx.execute(
            "UPDATE clip_library_chapters SET sort_order = ?1, fs_name = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                index as i64,
                build_chapter_display_name(&chapter_code, &chapter.name),
                now,
                chapter.id
            ],
        )
        .map_err(|e| format!("Failed to recompute clip chapter layout: {}", e))?;
    }

    let mut shots_by_chapter = BTreeMap::<String, Vec<ClipFolderRecord>>::new();
    let mut scripts_by_shot = BTreeMap::<String, Vec<ClipFolderRecord>>::new();
    for folder in folders {
        if folder.kind == "shot" && folder.parent_id.is_none() {
            shots_by_chapter
                .entry(folder.chapter_id.clone())
                .or_default()
                .push(folder);
        } else if folder.kind == "script" {
            if let Some(parent_id) = folder.parent_id.clone() {
                scripts_by_shot.entry(parent_id).or_default().push(folder);
            }
        }
    }

    for shots in shots_by_chapter.values_mut() {
        shots.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.created_at.cmp(&right.created_at))
        });
    }
    for scripts in scripts_by_shot.values_mut() {
        scripts.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then_with(|| left.created_at.cmp(&right.created_at))
        });
    }

    for chapter in &chapters {
        let Some(chapter_code) = chapter_code_map.get(&chapter.id) else {
            continue;
        };
        let Some(shots) = shots_by_chapter.get(&chapter.id) else {
            continue;
        };

        for (shot_index, shot) in shots.iter().enumerate() {
            let shot_code = format!("{}-{}", chapter_code, pad_code(shot_index + 1));
            tx.execute(
                r#"
                UPDATE clip_folders
                SET chapter_id = ?1,
                    parent_id = NULL,
                    sort_order = ?2,
                    shot_order = ?3,
                    number_code = ?4,
                    fs_name = ?5,
                    updated_at = ?6
                WHERE id = ?7
                "#,
                params![
                    chapter.id,
                    shot_index as i64,
                    (shot_index + 1) as i64,
                    shot_code,
                    build_numbered_display_name(&shot_code, &shot.name),
                    now,
                    shot.id
                ],
            )
            .map_err(|e| format!("Failed to recompute clip shot layout: {}", e))?;

            let Some(scripts) = scripts_by_shot.get(&shot.id) else {
                continue;
            };
            for (script_index, script) in scripts.iter().enumerate() {
                let script_code = format!("{}-{}", shot_code, pad_code(script_index + 1));
                tx.execute(
                    r#"
                    UPDATE clip_folders
                    SET chapter_id = ?1,
                        parent_id = ?2,
                        sort_order = ?3,
                        shot_order = NULL,
                        number_code = ?4,
                        fs_name = ?5,
                        updated_at = ?6
                    WHERE id = ?7
                    "#,
                    params![
                        chapter.id,
                        shot.id,
                        script_index as i64,
                        script_code,
                        build_numbered_display_name(&script_code, &script.name),
                        now,
                        script.id
                    ],
                )
                .map_err(|e| format!("Failed to recompute clip script layout: {}", e))?;
            }
        }
    }

    touch_library_updated_at(tx, library_id)?;
    Ok(())
}

fn build_directory_maps(
    snapshot: &ClipLibrarySnapshot,
) -> Result<
    (
        HashMap<String, ClipLibraryChapterRecord>,
        HashMap<String, ClipFolderRecord>,
        HashMap<String, PathBuf>,
    ),
    String,
> {
    let root_path = PathBuf::from(&snapshot.library.root_path);
    let chapter_map = snapshot
        .chapters
        .iter()
        .map(|chapter| (chapter.id.clone(), chapter.clone()))
        .collect::<HashMap<_, _>>();
    let folder_map = snapshot
        .folders
        .iter()
        .map(|folder| (folder.id.clone(), folder.clone()))
        .collect::<HashMap<_, _>>();
    let mut path_map = HashMap::new();

    for folder in &snapshot.folders {
        let chapter = chapter_map
            .get(&folder.chapter_id)
            .ok_or_else(|| "Clip folder is missing its parent chapter".to_string())?;
        let chapter_path = root_path.join(&chapter.fs_name);
        if folder.kind == "shot" {
            path_map.insert(folder.id.clone(), chapter_path.join(&folder.fs_name));
            continue;
        }

        let shot_id = folder
            .parent_id
            .as_ref()
            .ok_or_else(|| "Clip script folder is missing its parent shot".to_string())?;
        let shot = folder_map
            .get(shot_id)
            .ok_or_else(|| "Clip script folder references a missing shot".to_string())?;
        path_map.insert(
            folder.id.clone(),
            chapter_path.join(&shot.fs_name).join(&folder.fs_name),
        );
    }

    Ok((chapter_map, folder_map, path_map))
}

fn cleanup_empty_dirs(path: &Path, keep_paths: &HashSet<String>) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let child_path = entry.path();
        if child_path.is_dir() {
            cleanup_empty_dirs(&child_path, keep_paths);
        }
    }

    let normalized = normalize_path_for_prefix_match(path);
    if keep_paths.contains(&normalized) {
        return;
    }

    let is_empty = fs::read_dir(path)
        .ok()
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false);
    if is_empty {
        let _ = fs::remove_dir(path);
    }
}

fn reconcile_library_files(tx: &Transaction<'_>, library_id: &str) -> Result<(), String> {
    let snapshot = build_clip_library_snapshot(tx, library_id)?;
    let root_path = PathBuf::from(&snapshot.library.root_path);
    ensure_dir(&root_path)?;

    let (_, _, path_map) = build_directory_maps(&snapshot)?;
    let mut keep_paths = HashSet::new();
    keep_paths.insert(normalize_path_for_prefix_match(&root_path));

    for chapter in &snapshot.chapters {
        let chapter_path = root_path.join(&chapter.fs_name);
        ensure_dir(&chapter_path)?;
        keep_paths.insert(normalize_path_for_prefix_match(&chapter_path));
    }
    for folder_path in path_map.values() {
        ensure_dir(folder_path)?;
        keep_paths.insert(normalize_path_for_prefix_match(folder_path));
    }

    for item in &snapshot.items {
        let Some(target_dir) = path_map.get(&item.folder_id) else {
            continue;
        };
        let current_path = PathBuf::from(&item.source_path);
        let target_path = target_dir.join(&item.file_name);

        let next_source_path = if current_path == target_path {
            item.source_path.clone()
        } else if current_path.exists() {
            let next_file_name = move_file_to_dir(&current_path, target_dir, &item.file_name)?;
            target_dir
                .join(&next_file_name)
                .to_string_lossy()
                .to_string()
        } else if target_path.exists() {
            target_path.to_string_lossy().to_string()
        } else {
            item.source_path.clone()
        };

        let next_file_name = Path::new(&next_source_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&item.file_name)
            .to_string();
        let next_preview_path = sync_optional_preview_path_to_dir(
            item.preview_path.as_deref(),
            Path::new(&next_source_path),
            target_dir,
        )?;

        if next_source_path != item.source_path || next_preview_path != item.preview_path {
            tx.execute(
                "UPDATE clip_items SET source_path = ?1, file_name = ?2, preview_path = ?3, updated_at = ?4 WHERE id = ?5",
                params![
                    next_source_path,
                    next_file_name,
                    next_preview_path,
                    current_timestamp_ms(),
                    item.id
                ],
            )
            .map_err(|e| format!("Failed to update clip item path after layout sync: {}", e))?;
        }
    }

    cleanup_empty_dirs(&root_path, &keep_paths);
    Ok(())
}

fn resolve_node_data_map(node: &Value) -> Option<&Map<String, Value>> {
    node.as_object()?.get("data")?.as_object()
}

fn resolve_node_data_map_mut(node: &mut Value) -> Option<&mut Map<String, Value>> {
    let object = node.as_object_mut()?;
    if !object.contains_key("data") {
        object.insert("data".to_string(), Value::Object(Map::new()));
    }
    object.get_mut("data")?.as_object_mut()
}

fn extract_duration_ms(data: &Map<String, Value>) -> Option<i64> {
    let duration = data.get("duration").and_then(Value::as_f64)?;
    if !duration.is_finite() || duration <= 0.0 {
        return None;
    }
    Some((duration * 1000.0).round() as i64)
}

fn extract_project_node_media(
    node: &Value,
    image_pool: &[String],
) -> Option<ProjectNodeMediaRecord> {
    let node_object = node.as_object()?;
    let node_type = node_object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("");

    let node_id = node_object.get("id")?.as_str()?.to_string();
    let data = resolve_node_data_map(node)?;
    let resolved_audio_path = data
        .get("audioUrl")
        .and_then(Value::as_str)
        .and_then(|value| resolve_project_media_ref(value, image_pool));
    let resolved_video_path = data
        .get("videoUrl")
        .and_then(Value::as_str)
        .and_then(|value| resolve_project_media_ref(value, image_pool));

    let (media_type, source_path) = if node_type == AUDIO_NODE_TYPE {
        ("audio", resolved_audio_path.or(resolved_video_path)?)
    } else if node_type == VIDEO_NODE_TYPE {
        ("video", resolved_video_path.or(resolved_audio_path)?)
    } else if let Some(audio_path) = resolved_audio_path {
        ("audio", audio_path)
    } else if let Some(video_path) = resolved_video_path {
        ("video", video_path)
    } else {
        return None;
    };

    if resolve_local_path(&source_path).is_none() {
        return None;
    }

    let preview_path = data
        .get("previewImageUrl")
        .and_then(Value::as_str)
        .and_then(|value| resolve_project_media_ref(value, image_pool));

    let title = data
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            data.get(if media_type == "video" {
                "videoFileName"
            } else {
                "audioFileName"
            })
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
        })
        .unwrap_or_else(|| {
            if media_type == "video" {
                "Video".to_string()
            } else {
                "Audio".to_string()
            }
        });

    let mime_type = data
        .get("mimeType")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            resolve_local_path(&source_path)
                .as_deref()
                .and_then(|path| infer_mime_from_path(path, media_type))
        });

    Some(ProjectNodeMediaRecord {
        node_id,
        media_type: media_type.to_string(),
        title,
        description_text: extract_description_text(data),
        source_path,
        preview_path,
        duration_ms: extract_duration_ms(data),
        mime_type,
    })
}

fn find_project_node_media(
    record: &ProjectRecord,
    node_id: &str,
) -> Result<ProjectNodeMediaRecord, String> {
    let parsed_nodes = serde_json::from_str::<Value>(&record.nodes_json)
        .map_err(|e| format!("Failed to parse project nodes json for clip scan: {}", e))?;
    let parsed_history = serde_json::from_str::<Value>(&record.history_json)
        .map_err(|e| format!("Failed to parse project history json for clip scan: {}", e))?;
    let Some(nodes) = project_nodes_array(&parsed_nodes) else {
        return Err("The requested project does not contain a node list".to_string());
    };
    let image_pool = extract_project_media_image_pool(&parsed_nodes, Some(&parsed_history));

    for node in nodes {
        if let Some(media) = extract_project_node_media(node, &image_pool) {
            if media.node_id == node_id {
                return Ok(media);
            }
        }
    }

    Err(
        "The requested media node could not be found or is not a local video/audio node"
            .to_string(),
    )
}

fn media_override_to_record(
    node_id: &str,
    payload: &AddNodeMediaToClipLibraryMediaOverride,
) -> Option<ProjectNodeMediaRecord> {
    let media_type = match payload.media_type.trim() {
        "video" => "video",
        "audio" => "audio",
        _ => return None,
    };
    let source_path = payload.source_path.trim();
    if source_path.is_empty() || resolve_local_path(source_path).is_none() {
        return None;
    }

    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            if media_type == "video" {
                "Video".to_string()
            } else {
                "Audio".to_string()
            }
        });

    Some(ProjectNodeMediaRecord {
        node_id: node_id.to_string(),
        media_type: media_type.to_string(),
        title,
        description_text: payload
            .description_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .unwrap_or_default(),
        source_path: source_path.to_string(),
        preview_path: payload
            .preview_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string()),
        duration_ms: payload.duration_ms.filter(|value| *value > 0),
        mime_type: payload
            .mime_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .or_else(|| {
                resolve_local_path(source_path)
                    .as_deref()
                    .and_then(|path| infer_mime_from_path(path, media_type))
            }),
    })
}

fn patch_node_clip_binding(
    node: &mut Value,
    node_id: &str,
    clip_library_id: &str,
    clip_folder_id: &str,
    clip_item_id: &str,
) -> bool {
    let matches_node = node
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(Value::as_str)
        .is_some_and(|value| value == node_id);
    if !matches_node {
        return false;
    }

    let Some(data) = resolve_node_data_map_mut(node) else {
        return false;
    };

    data.insert(
        "clipLibraryId".to_string(),
        Value::String(clip_library_id.to_string()),
    );
    data.insert("clipProjectLinkId".to_string(), Value::Null);
    data.insert(
        "clipFolderId".to_string(),
        Value::String(clip_folder_id.to_string()),
    );
    data.insert(
        "clipItemId".to_string(),
        Value::String(clip_item_id.to_string()),
    );
    true
}

fn matches_binding_target(data: &Map<String, Value>, target: &BindingPatchTarget) -> bool {
    let clip_library_id = data
        .get("clipLibraryId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let clip_folder_id = data
        .get("clipFolderId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let clip_item_id = data
        .get("clipItemId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();

    target
        .library_id
        .as_ref()
        .is_some_and(|library_id| clip_library_id == library_id)
        || target.folder_ids.contains(clip_folder_id)
        || target.item_ids.contains(clip_item_id)
}

fn clear_node_clip_binding(node: &mut Value, target: &BindingPatchTarget) -> bool {
    let Some(data) = resolve_node_data_map_mut(node) else {
        return false;
    };
    if !matches_binding_target(data, target) {
        return false;
    }

    data.insert("clipLibraryId".to_string(), Value::Null);
    data.insert("clipProjectLinkId".to_string(), Value::Null);
    data.insert("clipFolderId".to_string(), Value::Null);
    data.insert("clipItemId".to_string(), Value::Null);
    true
}

fn rebind_node_clip_item(
    node: &mut Value,
    item_id: &str,
    clip_library_id: &str,
    clip_folder_id: &str,
) -> bool {
    let Some(data) = resolve_node_data_map_mut(node) else {
        return false;
    };
    let current_item_id = data
        .get("clipItemId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if current_item_id != item_id {
        return false;
    }

    data.insert(
        "clipLibraryId".to_string(),
        Value::String(clip_library_id.to_string()),
    );
    data.insert("clipProjectLinkId".to_string(), Value::Null);
    data.insert(
        "clipFolderId".to_string(),
        Value::String(clip_folder_id.to_string()),
    );
    true
}

fn mutate_history_snapshot_nodes<F>(snapshot: &mut Value, node_mutator: &mut F) -> bool
where
    F: FnMut(&mut Value) -> bool,
{
    let mut changed = false;

    if let Some(nodes) = snapshot.get_mut("nodes").and_then(Value::as_array_mut) {
        for node in nodes {
            changed |= node_mutator(node);
        }
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
        changed |= node_mutator(node);
    }

    changed
}

fn rewrite_project_clip_bindings<F>(
    nodes_json: &str,
    history_json: &str,
    mut node_mutator: F,
) -> Result<Option<(String, String)>, String>
where
    F: FnMut(&mut Value) -> bool,
{
    let mut parsed_nodes = serde_json::from_str::<Value>(nodes_json).map_err(|e| {
        format!(
            "Failed to parse project nodes json for clip binding rewrite: {}",
            e
        )
    })?;
    let mut parsed_history = serde_json::from_str::<Value>(history_json).map_err(|e| {
        format!(
            "Failed to parse project history json for clip binding rewrite: {}",
            e
        )
    })?;

    let mut changed = false;

    if let Some(nodes) = project_nodes_array_mut(&mut parsed_nodes) {
        for node in nodes {
            changed |= node_mutator(node);
        }
    }

    for timeline_key in ["past", "future"] {
        let Some(timeline) = parsed_history
            .get_mut(timeline_key)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        for snapshot in timeline {
            changed |= mutate_history_snapshot_nodes(snapshot, &mut node_mutator);
        }
    }

    if !changed {
        return Ok(None);
    }

    let next_nodes_json = serde_json::to_string(&parsed_nodes)
        .map_err(|e| format!("Failed to serialize clip-bound project nodes json: {}", e))?;
    let next_history_json = serde_json::to_string(&parsed_history)
        .map_err(|e| format!("Failed to serialize clip-bound project history json: {}", e))?;

    Ok(Some((next_nodes_json, next_history_json)))
}

fn update_project_binding_state_in_tx(
    tx: &Transaction<'_>,
    project_id: &str,
    nodes_json: &str,
    history_json: &str,
    clip_library_id: Option<&str>,
    clip_last_folder_id: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        r#"
        UPDATE projects
        SET nodes_json = ?1,
            history_json = ?2,
            clip_library_id = ?3,
            clip_last_folder_id = ?4,
            updated_at = ?5
        WHERE id = ?6
        "#,
        params![
            nodes_json,
            history_json,
            clip_library_id,
            clip_last_folder_id,
            current_timestamp_ms(),
            project_id
        ],
    )
    .map_err(|e| format!("Failed to update project clip binding state: {}", e))?;
    Ok(())
}

fn clear_clip_bindings_in_projects(
    tx: &Transaction<'_>,
    target: &BindingPatchTarget,
) -> Result<(), String> {
    for record in load_project_binding_states(tx)? {
        let mut next_nodes_json = record.nodes_json.clone();
        let mut next_history_json = record.history_json.clone();
        let mut next_clip_library_id = record.clip_library_id.clone();
        let mut next_clip_last_folder_id = record.clip_last_folder_id.clone();
        let mut changed = false;

        if target.library_id.as_ref().is_some_and(|library_id| {
            record.clip_library_id.as_deref() == Some(library_id.as_str())
        }) {
            next_clip_library_id = None;
            next_clip_last_folder_id = None;
            changed = true;
        }

        if next_clip_last_folder_id
            .as_ref()
            .is_some_and(|folder_id| target.folder_ids.contains(folder_id))
        {
            next_clip_last_folder_id = None;
            changed = true;
        }

        if let Some((rewritten_nodes_json, rewritten_history_json)) =
            rewrite_project_clip_bindings(&record.nodes_json, &record.history_json, |node| {
                clear_node_clip_binding(node, target)
            })?
        {
            next_nodes_json = rewritten_nodes_json;
            next_history_json = rewritten_history_json;
            changed = true;
        }

        if changed {
            update_project_binding_state_in_tx(
                tx,
                &record.id,
                &next_nodes_json,
                &next_history_json,
                next_clip_library_id.as_deref(),
                next_clip_last_folder_id.as_deref(),
            )?;
        }
    }

    Ok(())
}

fn rebind_clip_item_in_projects(
    tx: &Transaction<'_>,
    item_id: &str,
    clip_library_id: &str,
    clip_folder_id: &str,
) -> Result<(), String> {
    for record in load_project_binding_states(tx)? {
        let Some((next_nodes_json, next_history_json)) =
            rewrite_project_clip_bindings(&record.nodes_json, &record.history_json, |node| {
                rebind_node_clip_item(node, item_id, clip_library_id, clip_folder_id)
            })?
        else {
            continue;
        };

        update_project_binding_state_in_tx(
            tx,
            &record.id,
            &next_nodes_json,
            &next_history_json,
            record.clip_library_id.as_deref(),
            record.clip_last_folder_id.as_deref(),
        )?;
    }

    Ok(())
}

fn patch_clip_binding_on_project_node(
    tx: &Transaction<'_>,
    record: &ProjectRecord,
    node_id: &str,
    clip_library_id: &str,
    clip_folder_id: &str,
    clip_item_id: &str,
) -> Result<(), String> {
    let Some((next_nodes_json, next_history_json)) =
        rewrite_project_clip_bindings(&record.nodes_json, &record.history_json, |node| {
            patch_node_clip_binding(node, node_id, clip_library_id, clip_folder_id, clip_item_id)
        })?
    else {
        return Ok(());
    };

    update_project_binding_state_in_tx(
        tx,
        &record.id,
        &next_nodes_json,
        &next_history_json,
        Some(clip_library_id),
        Some(clip_folder_id),
    )
}

fn collect_descendant_folder_ids(
    snapshot: &ClipLibrarySnapshot,
    folder_id: &str,
) -> HashSet<String> {
    let children_by_parent = folder_children_by_parent(snapshot);
    let mut result = HashSet::new();
    let mut queue = vec![Some(folder_id.to_string())];

    while let Some(parent_id) = queue.pop() {
        let Some(children) = children_by_parent.get(&parent_id) else {
            continue;
        };
        for child in children {
            if result.insert(child.id.clone()) {
                queue.push(Some(child.id.clone()));
            }
        }
    }

    result.insert(folder_id.to_string());
    result
}

fn collect_item_ids_for_folders(
    snapshot: &ClipLibrarySnapshot,
    folder_ids: &HashSet<String>,
) -> HashSet<String> {
    snapshot
        .items
        .iter()
        .filter(|item| folder_ids.contains(&item.folder_id))
        .map(|item| item.id.clone())
        .collect()
}

fn count_bound_nodes(
    record: &ProjectBindingStateRecord,
    target: &BindingPatchTarget,
) -> Result<i64, String> {
    let parsed_nodes = serde_json::from_str::<Value>(&record.nodes_json).map_err(|e| {
        format!(
            "Failed to parse project nodes json for delete impact: {}",
            e
        )
    })?;
    let Some(nodes) = project_nodes_array(&parsed_nodes) else {
        return Ok(0);
    };

    let mut count = 0i64;
    for node in nodes {
        let Some(data) = resolve_node_data_map(node) else {
            continue;
        };
        if matches_binding_target(data, target) {
            count += 1;
        }
    }
    Ok(count)
}

fn validate_storyboard_project(record: &ProjectRecord) -> Result<(), String> {
    if record.project_type != "storyboard" {
        return Err("Only storyboard projects can bind clip libraries".to_string());
    }
    Ok(())
}

fn delete_item_files(snapshot: &ClipLibrarySnapshot, item_ids: &HashSet<String>) {
    let root_path = PathBuf::from(&snapshot.library.root_path);
    for item in snapshot
        .items
        .iter()
        .filter(|item| item_ids.contains(&item.id))
    {
        maybe_remove_path(Some(&item.source_path), &root_path);
        maybe_remove_path(item.preview_path.as_deref(), &root_path);
        maybe_remove_path(item.waveform_path.as_deref(), &root_path);
    }
}

fn finalize_layout(tx: &Transaction<'_>, library_id: &str) -> Result<ClipLibrarySnapshot, String> {
    recompute_clip_library_layout(tx, library_id)?;
    reconcile_library_files(tx, library_id)?;
    build_clip_library_snapshot(tx, library_id)
}

#[tauri::command]
pub fn list_clip_libraries(app: AppHandle) -> Result<Vec<ClipLibraryRecord>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, name, root_path, created_at, updated_at
            FROM clip_libraries
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare clip library list query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ClipLibraryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query clip libraries: {}", e))?;

    let mut libraries = Vec::new();
    for row in rows {
        let library = row.map_err(|e| format!("Failed to decode clip library row: {}", e))?;
        allow_clip_library_asset_scope(&app, &library.root_path)?;
        libraries.push(library);
    }
    Ok(libraries)
}

#[tauri::command]
pub fn get_clip_library_snapshot(
    app: AppHandle,
    library_id: String,
) -> Result<ClipLibrarySnapshot, String> {
    let mut conn = open_db(&app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip library snapshot transaction: {}", e))?;
    let snapshot = finalize_layout(&tx, library_id.trim())?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip library snapshot transaction: {}", e))?;
    allow_clip_library_asset_scope(&app, &snapshot.library.root_path)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn create_clip_library(
    app: AppHandle,
    payload: CreateClipLibraryPayload,
) -> Result<ClipLibraryRecord, String> {
    let name = normalize_required_name(&payload.name, DEFAULT_LIBRARY_NAME);
    let root_path = payload.root_path.trim();
    if root_path.is_empty() {
        return Err("Clip library root path is required".to_string());
    }

    let root_dir = PathBuf::from(root_path);
    ensure_dir(&root_dir)?;
    allow_clip_library_root_asset_scope(&app, &root_dir)?;

    let conn = open_db(&app)?;
    let now = current_timestamp_ms();
    let id = Uuid::new_v4().to_string();

    conn.execute(
        r#"
        INSERT INTO clip_libraries (id, name, root_path, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![id, name, root_path, now, now],
    )
    .map_err(|e| format!("Failed to create clip library: {}", e))?;

    read_clip_library(&conn, &id)
}

#[tauri::command]
pub fn open_clip_library_root(app: AppHandle, library_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let library = read_clip_library(&conn, &library_id)?;
    let root_path = resolve_local_path(&library.root_path)
        .unwrap_or_else(|| PathBuf::from(library.root_path.trim()));

    ensure_dir(&root_path)?;
    open_directory_in_file_manager(&root_path)
}

#[tauri::command]
pub fn update_clip_library(
    app: AppHandle,
    payload: UpdateClipLibraryPayload,
) -> Result<ClipLibraryRecord, String> {
    let conn = open_db(&app)?;
    let library = read_clip_library(&conn, &payload.id)?;
    let next_name = normalize_required_name(&payload.name, &library.name);

    conn.execute(
        "UPDATE clip_libraries SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![next_name, current_timestamp_ms(), payload.id],
    )
    .map_err(|e| format!("Failed to update clip library: {}", e))?;

    read_clip_library(&conn, &library.id)
}

#[tauri::command]
pub fn delete_clip_library(app: AppHandle, library_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let snapshot = build_clip_library_snapshot(&conn, library_id.trim())?;
    let item_ids = snapshot
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    let folder_ids = snapshot
        .folders
        .iter()
        .map(|folder| folder.id.clone())
        .collect::<HashSet<_>>();
    let target = BindingPatchTarget {
        library_id: Some(snapshot.library.id.clone()),
        folder_ids,
        item_ids: item_ids.clone(),
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip library delete transaction: {}", e))?;

    clear_clip_bindings_in_projects(&tx, &target)?;
    tx.execute(
        "DELETE FROM clip_items WHERE library_id = ?1",
        params![snapshot.library.id],
    )
    .map_err(|e| format!("Failed to delete clip items: {}", e))?;
    tx.execute(
        "DELETE FROM clip_folders WHERE library_id = ?1",
        params![snapshot.library.id],
    )
    .map_err(|e| format!("Failed to delete clip folders: {}", e))?;
    tx.execute(
        "DELETE FROM clip_library_chapters WHERE library_id = ?1",
        params![snapshot.library.id],
    )
    .map_err(|e| format!("Failed to delete clip chapters: {}", e))?;
    tx.execute(
        "DELETE FROM clip_library_ui_state WHERE library_id = ?1",
        params![snapshot.library.id],
    )
    .map_err(|e| format!("Failed to delete clip ui state: {}", e))?;
    tx.execute(
        "DELETE FROM clip_libraries WHERE id = ?1",
        params![snapshot.library.id],
    )
    .map_err(|e| format!("Failed to delete clip library record: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit clip library delete transaction: {}", e))?;

    delete_item_files(&snapshot, &item_ids);
    let root_path = PathBuf::from(&snapshot.library.root_path);
    let keep_paths = HashSet::from([normalize_path_for_prefix_match(&root_path)]);
    cleanup_empty_dirs(&root_path, &keep_paths);
    Ok(())
}

#[tauri::command]
pub fn create_clip_library_chapter(
    app: AppHandle,
    payload: CreateClipLibraryChapterPayload,
) -> Result<ClipLibraryChapterRecord, String> {
    let mut conn = open_db(&app)?;
    let library = read_clip_library(&conn, &payload.library_id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip chapter create transaction: {}", e))?;

    let mut ordered_ids = ordered_chapter_ids(&tx, &library.id)?;
    let chapter_id = Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    tx.execute(
        r#"
        INSERT INTO clip_library_chapters (id, library_id, name, sort_order, fs_name, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            chapter_id,
            library.id,
            normalize_required_name(&payload.name, DEFAULT_CHAPTER_NAME),
            ordered_ids.len() as i64,
            String::new(),
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to create clip chapter: {}", e))?;

    let insert_index = clamp_insert_index(payload.insert_index, ordered_ids.len());
    insert_id_at(&mut ordered_ids, chapter_id.clone(), insert_index);
    write_chapter_sort_orders(&tx, &library.id, &ordered_ids)?;
    finalize_layout(&tx, &library.id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip chapter create transaction: {}", e))?;

    read_chapter(&conn, &chapter_id)
}

#[tauri::command]
pub fn update_clip_library_chapter(
    app: AppHandle,
    payload: UpdateClipLibraryChapterPayload,
) -> Result<ClipLibraryChapterRecord, String> {
    let mut conn = open_db(&app)?;
    let chapter = read_chapter(&conn, &payload.id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip chapter update transaction: {}", e))?;

    tx.execute(
        "UPDATE clip_library_chapters SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            normalize_required_name(&payload.name, DEFAULT_CHAPTER_NAME),
            current_timestamp_ms(),
            chapter.id
        ],
    )
    .map_err(|e| format!("Failed to update clip chapter: {}", e))?;

    finalize_layout(&tx, &chapter.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip chapter update transaction: {}", e))?;

    read_chapter(&conn, &chapter.id)
}

#[tauri::command]
pub fn move_clip_library_chapter(
    app: AppHandle,
    payload: MoveClipLibraryChapterPayload,
) -> Result<ClipLibrarySnapshot, String> {
    let mut conn = open_db(&app)?;
    let chapter = read_chapter(&conn, &payload.chapter_id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip chapter move transaction: {}", e))?;

    let mut ordered_ids = ordered_chapter_ids(&tx, &chapter.library_id)?;
    let target_index = clamp_insert_index(Some(payload.target_index), ordered_ids.len());
    relocate_id(&mut ordered_ids, &chapter.id, target_index)?;
    write_chapter_sort_orders(&tx, &chapter.library_id, &ordered_ids)?;

    let snapshot = finalize_layout(&tx, &chapter.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip chapter move transaction: {}", e))?;
    Ok(snapshot)
}

#[tauri::command]
pub fn delete_clip_library_chapter(app: AppHandle, chapter_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let chapter = read_chapter(&conn, chapter_id.trim())?;
    let snapshot = build_clip_library_snapshot(&conn, &chapter.library_id)?;

    let folder_ids = snapshot
        .folders
        .iter()
        .filter(|folder| folder.chapter_id == chapter.id)
        .map(|folder| folder.id.clone())
        .collect::<HashSet<_>>();
    let item_ids = collect_item_ids_for_folders(&snapshot, &folder_ids);
    let target = BindingPatchTarget {
        library_id: None,
        folder_ids: folder_ids.clone(),
        item_ids: item_ids.clone(),
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip chapter delete transaction: {}", e))?;

    clear_clip_bindings_in_projects(&tx, &target)?;
    tx.execute(
        "DELETE FROM clip_items WHERE library_id = ?1 AND folder_id IN (SELECT id FROM clip_folders WHERE chapter_id = ?2)",
        params![chapter.library_id, chapter.id],
    )
    .map_err(|e| format!("Failed to delete clip items under chapter: {}", e))?;
    tx.execute(
        "DELETE FROM clip_folders WHERE chapter_id = ?1",
        params![chapter.id],
    )
    .map_err(|e| format!("Failed to delete clip folders under chapter: {}", e))?;
    tx.execute(
        "DELETE FROM clip_library_chapters WHERE id = ?1",
        params![chapter.id],
    )
    .map_err(|e| format!("Failed to delete clip chapter: {}", e))?;

    finalize_layout(&tx, &chapter.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip chapter delete transaction: {}", e))?;

    delete_item_files(&snapshot, &item_ids);
    let root_path = PathBuf::from(&snapshot.library.root_path);
    let keep_paths = HashSet::from([normalize_path_for_prefix_match(&root_path)]);
    cleanup_empty_dirs(&root_path, &keep_paths);
    Ok(())
}

fn resolve_target_parent(
    conn: &Connection,
    payload: &CreateClipFolderPayload,
) -> Result<(String, Option<String>), String> {
    let kind = normalize_folder_kind(&payload.kind)?;
    if kind == "shot" {
        let chapter_id = normalize_optional_text(payload.chapter_id.clone()).ok_or_else(|| {
            "A target chapter is required when creating a shot folder".to_string()
        })?;
        if payload
            .parent_id
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err("Shot folders cannot be created under another folder".to_string());
        }
        return Ok((chapter_id, None));
    }

    let parent_id = normalize_optional_text(payload.parent_id.clone())
        .ok_or_else(|| "A target shot is required when creating a script folder".to_string())?;
    let parent = read_folder(conn, &parent_id)?;
    if parent.kind != "shot" {
        return Err("Script folders can only be created under shot folders".to_string());
    }
    Ok((parent.chapter_id.clone(), Some(parent_id)))
}

#[tauri::command]
pub fn create_clip_folder(
    app: AppHandle,
    payload: CreateClipFolderPayload,
) -> Result<ClipFolderRecord, String> {
    let mut conn = open_db(&app)?;
    let library = read_clip_library(&conn, &payload.library_id)?;
    let kind = normalize_folder_kind(&payload.kind)?;
    let (chapter_id, parent_id) = resolve_target_parent(&conn, &payload)?;
    let chapter = read_chapter(&conn, &chapter_id)?;
    if chapter.library_id != library.id {
        return Err("The requested chapter does not belong to this clip library".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip folder create transaction: {}", e))?;

    let mut sibling_ids = ordered_folder_ids(&tx, &library.id, &chapter_id, parent_id.as_deref())?;
    let folder_id = Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    tx.execute(
        r#"
        INSERT INTO clip_folders (
          id,
          library_id,
          chapter_id,
          parent_id,
          kind,
          name,
          sort_order,
          shot_order,
          number_code,
          fs_name,
          created_at,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, '', ?8, ?9)
        "#,
        params![
            folder_id,
            library.id,
            chapter_id,
            parent_id,
            kind,
            normalize_required_name(
                payload.name.as_deref().unwrap_or(""),
                if kind == "shot" {
                    DEFAULT_SHOT_NAME
                } else {
                    DEFAULT_SCRIPT_NAME
                }
            ),
            sibling_ids.len() as i64,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to create clip folder: {}", e))?;

    let insert_index = if let Some(insert_before_id) =
        normalize_optional_text(payload.insert_before_id.clone())
    {
        sibling_ids
            .iter()
            .position(|value| value == &insert_before_id)
            .ok_or_else(|| "The requested insert_before folder could not be found".to_string())?
    } else if let Some(insert_after_id) = normalize_optional_text(payload.insert_after_id.clone()) {
        sibling_ids
            .iter()
            .position(|value| value == &insert_after_id)
            .map(|index| index + 1)
            .ok_or_else(|| "The requested insert_after folder could not be found".to_string())?
    } else {
        sibling_ids.len()
    };

    insert_id_at(&mut sibling_ids, folder_id.clone(), insert_index);
    write_folder_sort_orders(
        &tx,
        &library.id,
        &chapter_id,
        parent_id.as_deref(),
        &sibling_ids,
    )?;
    finalize_layout(&tx, &library.id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip folder create transaction: {}", e))?;

    read_folder(&conn, &folder_id)
}

#[tauri::command]
pub fn move_clip_folder(
    app: AppHandle,
    payload: MoveClipFolderPayload,
) -> Result<ClipLibrarySnapshot, String> {
    let mut conn = open_db(&app)?;
    let folder = read_folder(&conn, &payload.folder_id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip folder move transaction: {}", e))?;

    let (target_chapter_id, target_parent_id) = if folder.kind == "shot" {
        let chapter_id = normalize_optional_text(payload.target_chapter_id.clone())
            .unwrap_or_else(|| folder.chapter_id.clone());
        (chapter_id, None)
    } else {
        let target_parent_id = normalize_optional_text(payload.target_parent_id.clone())
            .ok_or_else(|| "A target shot is required when moving a script folder".to_string())?;
        let target_parent = read_folder(&tx, &target_parent_id)?;
        if target_parent.kind != "shot" {
            return Err("Script folders can only be moved under shot folders".to_string());
        }
        (target_parent.chapter_id.clone(), Some(target_parent_id))
    };

    let mut old_sibling_ids = ordered_folder_ids(
        &tx,
        &folder.library_id,
        &folder.chapter_id,
        folder.parent_id.as_deref(),
    )?;
    old_sibling_ids.retain(|value| value != &folder.id);
    write_folder_sort_orders(
        &tx,
        &folder.library_id,
        &folder.chapter_id,
        folder.parent_id.as_deref(),
        &old_sibling_ids,
    )?;

    let mut target_sibling_ids = ordered_folder_ids(
        &tx,
        &folder.library_id,
        &target_chapter_id,
        target_parent_id.as_deref(),
    )?;
    target_sibling_ids.retain(|value| value != &folder.id);
    let target_index = clamp_insert_index(Some(payload.target_index), target_sibling_ids.len());
    insert_id_at(&mut target_sibling_ids, folder.id.clone(), target_index);

    tx.execute(
        "UPDATE clip_folders SET chapter_id = ?1, parent_id = ?2, updated_at = ?3 WHERE id = ?4",
        params![
            target_chapter_id,
            target_parent_id,
            current_timestamp_ms(),
            folder.id
        ],
    )
    .map_err(|e| format!("Failed to update clip folder parent: {}", e))?;

    if folder.kind == "shot" {
        tx.execute(
            "UPDATE clip_folders SET chapter_id = ?1, updated_at = ?2 WHERE parent_id = ?3",
            params![target_chapter_id, current_timestamp_ms(), folder.id],
        )
        .map_err(|e| format!("Failed to update child script chapter ids: {}", e))?;
    }

    write_folder_sort_orders(
        &tx,
        &folder.library_id,
        &target_chapter_id,
        target_parent_id.as_deref(),
        &target_sibling_ids,
    )?;

    let snapshot = finalize_layout(&tx, &folder.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip folder move transaction: {}", e))?;
    Ok(snapshot)
}

#[tauri::command]
pub fn rename_clip_folder(
    app: AppHandle,
    payload: RenameClipFolderPayload,
) -> Result<ClipFolderRecord, String> {
    let mut conn = open_db(&app)?;
    let folder = read_folder(&conn, &payload.id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip folder rename transaction: {}", e))?;

    tx.execute(
        "UPDATE clip_folders SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            normalize_required_name(
                &payload.name,
                if folder.kind == "shot" {
                    DEFAULT_SHOT_NAME
                } else {
                    DEFAULT_SCRIPT_NAME
                }
            ),
            current_timestamp_ms(),
            folder.id
        ],
    )
    .map_err(|e| format!("Failed to rename clip folder: {}", e))?;

    finalize_layout(&tx, &folder.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip folder rename transaction: {}", e))?;

    read_folder(&conn, &folder.id)
}

#[tauri::command]
pub fn delete_clip_folder(app: AppHandle, folder_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let folder = read_folder(&conn, folder_id.trim())?;
    let snapshot = build_clip_library_snapshot(&conn, &folder.library_id)?;
    let folder_ids = collect_descendant_folder_ids(&snapshot, &folder.id);
    let item_ids = collect_item_ids_for_folders(&snapshot, &folder_ids);
    let target = BindingPatchTarget {
        library_id: None,
        folder_ids: folder_ids.clone(),
        item_ids: item_ids.clone(),
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip folder delete transaction: {}", e))?;

    clear_clip_bindings_in_projects(&tx, &target)?;
    for item_id in &item_ids {
        tx.execute("DELETE FROM clip_items WHERE id = ?1", params![item_id])
            .map_err(|e| format!("Failed to delete clip item under folder: {}", e))?;
    }
    for descendant_id in &folder_ids {
        tx.execute(
            "DELETE FROM clip_folders WHERE id = ?1",
            params![descendant_id],
        )
        .map_err(|e| format!("Failed to delete clip folder descendant: {}", e))?;
    }

    let mut sibling_ids = ordered_folder_ids(
        &tx,
        &folder.library_id,
        &folder.chapter_id,
        folder.parent_id.as_deref(),
    )?;
    sibling_ids.retain(|value| value != &folder.id);
    write_folder_sort_orders(
        &tx,
        &folder.library_id,
        &folder.chapter_id,
        folder.parent_id.as_deref(),
        &sibling_ids,
    )?;

    finalize_layout(&tx, &folder.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip folder delete transaction: {}", e))?;

    delete_item_files(&snapshot, &item_ids);
    let root_path = PathBuf::from(&snapshot.library.root_path);
    let keep_paths = HashSet::from([normalize_path_for_prefix_match(&root_path)]);
    cleanup_empty_dirs(&root_path, &keep_paths);
    Ok(())
}

#[tauri::command]
pub fn add_node_media_to_clip_library(
    app: AppHandle,
    payload: AddNodeMediaToClipLibraryPayload,
) -> Result<AddNodeMediaToClipLibraryResult, String> {
    let mut conn = open_db(&app)?;
    let project = load_project_record(&conn, &payload.project_id)?;
    validate_storyboard_project(&project)?;

    let library_id = payload.library_id.trim();
    if project.clip_library_id.as_deref() != Some(library_id) {
        return Err(
            "Bind the storyboard project to this clip library before importing media".to_string(),
        );
    }

    let folder = read_folder(&conn, payload.folder_id.trim())?;
    if folder.library_id != library_id {
        return Err(
            "The target clip folder does not belong to the selected clip library".to_string(),
        );
    }
    if folder.kind != "script" {
        return Err("Media can only be imported into script folders".to_string());
    }

    let media = match find_project_node_media(&project, &payload.node_id) {
        Ok(media) => media,
        Err(error) => payload
            .media_override
            .as_ref()
            .and_then(|media_override| media_override_to_record(&payload.node_id, media_override))
            .ok_or(error)?,
    };
    let source_path = resolve_local_path(&media.source_path).ok_or_else(|| {
        "The selected node does not contain a supported local media file".to_string()
    })?;
    if !source_path.exists() {
        return Err("The selected media file does not exist on disk".to_string());
    }

    let library = read_clip_library(&conn, library_id)?;
    let snapshot = build_clip_library_snapshot(&conn, library_id)?;
    let (_, _, path_map) = build_directory_maps(&snapshot)?;
    let target_dir = path_map
        .get(&folder.id)
        .cloned()
        .ok_or_else(|| "The target clip folder path could not be resolved".to_string())?;

    let preferred_file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_fs_component(value, DEFAULT_ITEM_NAME))
        .unwrap_or_else(|| DEFAULT_ITEM_NAME.to_string());
    let copied_file_name = copy_file_to_dir(&source_path, &target_dir, &preferred_file_name)?;
    let copied_path = target_dir.join(&copied_file_name);
    let copied_preview_path =
        copy_optional_preview_to_dir(media.preview_path.as_deref(), &source_path, &target_dir)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip item add transaction: {}", e))?;

    let item_id = Uuid::new_v4().to_string();
    let now = current_timestamp_ms();
    tx.execute(
        r#"
        INSERT INTO clip_items (
          id,
          library_id,
          folder_id,
          media_type,
          name,
          description_text,
          file_name,
          source_path,
          preview_path,
          duration_ms,
          mime_type,
          waveform_path,
          source_node_id,
          source_node_title,
          source_project_id,
          source_project_name,
          created_at,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, ?14, ?15, ?16, ?17)
        "#,
        params![
            item_id,
            library.id,
            folder.id,
            media.media_type,
            media.title,
            media.description_text,
            copied_file_name,
            copied_path.to_string_lossy().to_string(),
            copied_preview_path,
            media.duration_ms,
            media.mime_type,
            media.node_id,
            media.title,
            project.id,
            project.name,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert clip item: {}", e))?;

    patch_clip_binding_on_project_node(
        &tx,
        &project,
        &payload.node_id,
        &library.id,
        &folder.id,
        &item_id,
    )?;
    touch_library_updated_at(&tx, &library.id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip item add transaction: {}", e))?;

    let item = read_item(&conn, &item_id)?;
    Ok(AddNodeMediaToClipLibraryResult {
        item,
        clip_library_id: library.id,
        clip_folder_id: folder.id,
    })
}

#[tauri::command]
pub fn update_clip_item_description(
    app: AppHandle,
    payload: UpdateClipItemDescriptionPayload,
) -> Result<ClipItemRecord, String> {
    let conn = open_db(&app)?;
    let item = read_item(&conn, &payload.item_id)?;
    conn.execute(
        "UPDATE clip_items SET description_text = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            payload.description_text.trim(),
            current_timestamp_ms(),
            item.id
        ],
    )
    .map_err(|e| format!("Failed to update clip item description: {}", e))?;
    read_item(&conn, &item.id)
}

#[tauri::command]
pub fn rename_clip_item(
    app: AppHandle,
    payload: RenameClipItemPayload,
) -> Result<ClipItemRecord, String> {
    let mut conn = open_db(&app)?;
    let item = read_item(&conn, &payload.item_id)?;
    let folder = read_folder(&conn, &item.folder_id)?;
    let library = read_clip_library(&conn, &item.library_id)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip item rename transaction: {}", e))?;

    let snapshot = build_clip_library_snapshot(&tx, &library.id)?;
    let (_, _, path_map) = build_directory_maps(&snapshot)?;
    let target_dir = path_map
        .get(&folder.id)
        .cloned()
        .ok_or_else(|| "The clip item folder path could not be resolved".to_string())?;

    let next_name = normalize_required_name(&payload.name, DEFAULT_ITEM_NAME);
    let extension = Path::new(&item.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let preferred_file_name = format!(
        "{}{}",
        sanitize_fs_component(&next_name, DEFAULT_ITEM_NAME),
        extension
    );

    let current_path = PathBuf::from(&item.source_path);
    let (next_file_name, next_source_path) = if current_path.exists() {
        let next_file_name = move_file_to_dir(&current_path, &target_dir, &preferred_file_name)?;
        let next_source_path = target_dir
            .join(&next_file_name)
            .to_string_lossy()
            .to_string();
        (next_file_name, next_source_path)
    } else {
        (item.file_name.clone(), item.source_path.clone())
    };
    let next_preview_path = sync_optional_preview_path_to_dir(
        item.preview_path.as_deref(),
        Path::new(&next_source_path),
        &target_dir,
    )?;

    tx.execute(
        r#"
        UPDATE clip_items
        SET name = ?1,
            file_name = ?2,
            source_path = ?3,
            preview_path = ?4,
            updated_at = ?5
        WHERE id = ?6
        "#,
        params![
            next_name,
            next_file_name,
            next_source_path,
            next_preview_path,
            current_timestamp_ms(),
            item.id
        ],
    )
    .map_err(|e| format!("Failed to rename clip item: {}", e))?;

    touch_library_updated_at(&tx, &library.id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip item rename transaction: {}", e))?;

    read_item(&conn, &item.id)
}

#[tauri::command]
pub fn move_clip_item(
    app: AppHandle,
    payload: MoveClipItemPayload,
) -> Result<ClipItemRecord, String> {
    let mut conn = open_db(&app)?;
    let item = read_item(&conn, &payload.item_id)?;
    let target_folder = read_folder(&conn, &payload.target_folder_id)?;
    if target_folder.library_id != item.library_id {
        return Err("Clip items can only be moved within the same clip library".to_string());
    }
    if target_folder.kind != "script" {
        return Err("Clip items can only be moved into script folders".to_string());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip item move transaction: {}", e))?;

    let snapshot = build_clip_library_snapshot(&tx, &item.library_id)?;
    let (_, _, path_map) = build_directory_maps(&snapshot)?;
    let target_dir = path_map
        .get(&target_folder.id)
        .cloned()
        .ok_or_else(|| "The target clip folder path could not be resolved".to_string())?;
    let current_path = PathBuf::from(&item.source_path);

    let (next_file_name, next_source_path) = if current_path.exists() {
        let next_file_name = move_file_to_dir(&current_path, &target_dir, &item.file_name)?;
        let next_source_path = target_dir
            .join(&next_file_name)
            .to_string_lossy()
            .to_string();
        (next_file_name, next_source_path)
    } else {
        (item.file_name.clone(), item.source_path.clone())
    };
    let next_preview_path = sync_optional_preview_path_to_dir(
        item.preview_path.as_deref(),
        Path::new(&next_source_path),
        &target_dir,
    )?;

    tx.execute(
        "UPDATE clip_items SET folder_id = ?1, file_name = ?2, source_path = ?3, preview_path = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            target_folder.id,
            next_file_name,
            next_source_path,
            next_preview_path,
            current_timestamp_ms(),
            item.id
        ],
    )
    .map_err(|e| format!("Failed to move clip item: {}", e))?;

    rebind_clip_item_in_projects(&tx, &item.id, &item.library_id, &target_folder.id)?;
    touch_library_updated_at(&tx, &item.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip item move transaction: {}", e))?;

    read_item(&conn, &item.id)
}

#[tauri::command]
pub fn delete_clip_item(app: AppHandle, item_id: String) -> Result<(), String> {
    let mut conn = open_db(&app)?;
    let item = read_item(&conn, item_id.trim())?;
    let snapshot = build_clip_library_snapshot(&conn, &item.library_id)?;
    let target = BindingPatchTarget {
        library_id: None,
        folder_ids: HashSet::new(),
        item_ids: HashSet::from([item.id.clone()]),
    };

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin clip item delete transaction: {}", e))?;

    clear_clip_bindings_in_projects(&tx, &target)?;
    tx.execute("DELETE FROM clip_items WHERE id = ?1", params![item.id])
        .map_err(|e| format!("Failed to delete clip item: {}", e))?;
    touch_library_updated_at(&tx, &item.library_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clip item delete transaction: {}", e))?;

    delete_item_files(&snapshot, &HashSet::from([item.id]));
    Ok(())
}

#[tauri::command]
pub fn save_clip_library_ui_state(
    app: AppHandle,
    payload: SaveClipLibraryUiStatePayload,
) -> Result<ClipLibraryUiStateRecord, String> {
    let conn = open_db(&app)?;
    let library = read_clip_library(&conn, &payload.library_id)?;

    conn.execute(
        r#"
        INSERT INTO clip_library_ui_state (
          library_id,
          expanded_keys_json,
          selected_key,
          scroll_top,
          left_width,
          right_width,
          last_filter_json,
          always_on_top,
          updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(library_id) DO UPDATE SET
          expanded_keys_json = excluded.expanded_keys_json,
          selected_key = excluded.selected_key,
          scroll_top = excluded.scroll_top,
          left_width = excluded.left_width,
          right_width = excluded.right_width,
          last_filter_json = excluded.last_filter_json,
          always_on_top = excluded.always_on_top,
          updated_at = excluded.updated_at
        "#,
        params![
            library.id,
            payload.expanded_keys_json,
            payload.selected_key,
            payload.scroll_top,
            payload.left_width,
            payload.right_width,
            payload.last_filter_json,
            if payload.always_on_top { 1 } else { 0 },
            current_timestamp_ms()
        ],
    )
    .map_err(|e| format!("Failed to save clip library ui state: {}", e))?;

    read_clip_library_ui_state(&conn, &library.id)?
        .ok_or_else(|| "Failed to read saved clip library ui state".to_string())
}

#[tauri::command]
pub fn get_clip_delete_impact(
    app: AppHandle,
    query: ClipDeleteImpactQuery,
) -> Result<ClipDeleteImpactRecord, String> {
    let conn = open_db(&app)?;

    let resolved_library_id = normalize_optional_text(query.library_id.clone())
        .or_else(|| {
            normalize_optional_text(query.chapter_id.clone()).and_then(|chapter_id| {
                read_chapter(&conn, &chapter_id)
                    .ok()
                    .map(|chapter| chapter.library_id)
            })
        })
        .or_else(|| {
            normalize_optional_text(query.folder_id.clone()).and_then(|folder_id| {
                read_folder(&conn, &folder_id)
                    .ok()
                    .map(|folder| folder.library_id)
            })
        })
        .or_else(|| {
            normalize_optional_text(query.item_id.clone())
                .and_then(|item_id| read_item(&conn, &item_id).ok().map(|item| item.library_id))
        })
        .ok_or_else(|| {
            "A clip library target is required when querying delete impact".to_string()
        })?;

    let snapshot = build_clip_library_snapshot(&conn, &resolved_library_id)?;

    let mut folder_ids = HashSet::new();
    let mut item_ids = HashSet::new();
    let mut delete_whole_library = false;

    if query.chapter_id.is_none() && query.folder_id.is_none() && query.item_id.is_none() {
        delete_whole_library = true;
        folder_ids = snapshot
            .folders
            .iter()
            .map(|folder| folder.id.clone())
            .collect::<HashSet<_>>();
        item_ids = snapshot
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<HashSet<_>>();
    } else if let Some(chapter_id) = normalize_optional_text(query.chapter_id) {
        folder_ids = snapshot
            .folders
            .iter()
            .filter(|folder| folder.chapter_id == chapter_id)
            .map(|folder| folder.id.clone())
            .collect::<HashSet<_>>();
        item_ids = collect_item_ids_for_folders(&snapshot, &folder_ids);
    } else if let Some(folder_id) = normalize_optional_text(query.folder_id) {
        folder_ids = collect_descendant_folder_ids(&snapshot, &folder_id);
        item_ids = collect_item_ids_for_folders(&snapshot, &folder_ids);
    } else if let Some(item_id) = normalize_optional_text(query.item_id) {
        item_ids.insert(item_id);
    }

    let target = BindingPatchTarget {
        library_id: if delete_whole_library {
            Some(resolved_library_id.clone())
        } else {
            None
        },
        folder_ids: folder_ids.clone(),
        item_ids: item_ids.clone(),
    };

    let mut project_count = 0i64;
    let mut node_count = 0i64;
    for record in load_project_binding_states(&conn)? {
        let bound_nodes = count_bound_nodes(&record, &target)?;
        let project_matches = bound_nodes > 0
            || record
                .clip_last_folder_id
                .as_ref()
                .is_some_and(|folder_id| folder_ids.contains(folder_id))
            || (delete_whole_library
                && record.clip_library_id.as_deref() == Some(resolved_library_id.as_str()));

        if project_matches {
            project_count += 1;
            node_count += bound_nodes;
        }
    }

    Ok(ClipDeleteImpactRecord {
        project_count,
        node_count,
        folder_count: folder_ids.len() as i64,
        item_count: item_ids.len() as i64,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_numbered_display_name, copy_optional_preview_to_dir, extract_description_text,
        extract_project_node_media, media_override_to_record, normalize_required_name, pad_code,
        sanitize_fs_component, sync_optional_preview_path_to_dir,
        AddNodeMediaToClipLibraryMediaOverride,
    };
    use serde_json::json;
    use std::path::PathBuf;
    use std::{env, fs};
    use uuid::Uuid;

    fn create_temp_test_dir(label: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("storyboard-copilot-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp test dir should be created");
        path
    }

    #[test]
    fn pad_code_expands_after_double_digits() {
        assert_eq!(pad_code(1), "01");
        assert_eq!(pad_code(10), "10");
        assert_eq!(pad_code(100), "100");
    }

    #[test]
    fn description_text_prefers_description_text_then_node_description() {
        let data = json!({
            "descriptionText": "primary",
            "nodeDescription": "secondary",
            "description": "fallback"
        });
        assert_eq!(
            extract_description_text(data.as_object().expect("object")),
            "primary"
        );

        let data = json!({
            "nodeDescription": "secondary",
            "description": "fallback"
        });
        assert_eq!(
            extract_description_text(data.as_object().expect("object")),
            "secondary"
        );
    }

    #[test]
    fn filesystem_components_are_sanitized() {
        assert_eq!(sanitize_fs_component("  a:b*c  ", "fallback"), "a b c");
        assert_eq!(normalize_required_name("", "fallback"), "fallback");
        assert_eq!(
            build_numbered_display_name("01-01-01", "Opening"),
            "01-01-01 Opening"
        );
    }

    #[test]
    fn extract_project_node_media_resolves_image_pool_media_refs() {
        let node = json!({
            "id": "video-1",
            "type": "videoNode",
            "data": {
                "videoUrl": "__img_ref__:0",
                "previewImageUrl": "__img_ref__:1",
                "displayName": "Test Video"
            }
        });
        let image_pool = vec![
            r"C:\Users\Tester\Videos\clip.mp4".to_string(),
            r"C:\Users\Tester\Videos\clip-preview.png".to_string(),
        ];

        let media = extract_project_node_media(&node, &image_pool)
            .expect("video node with pooled refs should resolve");

        assert_eq!(media.node_id, "video-1");
        assert_eq!(media.media_type, "video");
        assert_eq!(media.source_path, r"C:\Users\Tester\Videos\clip.mp4");
        assert_eq!(
            media.preview_path.as_deref(),
            Some(r"C:\Users\Tester\Videos\clip-preview.png")
        );
    }

    #[test]
    fn extract_project_node_media_supports_non_video_node_types_with_video_url() {
        let node = json!({
            "id": "result-video-1",
            "type": "jimengVideoResultNode",
            "data": {
                "videoUrl": r"C:\Users\Tester\Videos\generated.mp4",
                "previewImageUrl": r"C:\Users\Tester\Videos\generated-preview.png",
                "displayName": "Generated Video"
            }
        });

        let media = extract_project_node_media(&node, &[])
            .expect("result video node should also resolve as clip media");

        assert_eq!(media.node_id, "result-video-1");
        assert_eq!(media.media_type, "video");
        assert_eq!(media.source_path, r"C:\Users\Tester\Videos\generated.mp4");
    }

    #[test]
    fn media_override_to_record_accepts_frontend_snapshot() {
        let payload = AddNodeMediaToClipLibraryMediaOverride {
            media_type: "video".to_string(),
            source_path: r"C:\Users\Tester\Videos\override.mp4".to_string(),
            preview_path: Some(r"C:\Users\Tester\Videos\override-preview.png".to_string()),
            title: Some("Override Video".to_string()),
            description_text: Some("desc".to_string()),
            duration_ms: Some(3200),
            mime_type: None,
        };

        let media =
            media_override_to_record("node-1", &payload).expect("frontend override should resolve");

        assert_eq!(media.node_id, "node-1");
        assert_eq!(media.media_type, "video");
        assert_eq!(media.source_path, r"C:\Users\Tester\Videos\override.mp4");
        assert_eq!(media.duration_ms, Some(3200));
    }

    #[test]
    fn copy_optional_preview_to_dir_copies_preview_into_library_folder() {
        let source_dir = create_temp_test_dir("copy-preview-source");
        let target_dir = create_temp_test_dir("copy-preview-target");
        let source_path = source_dir.join("clip.mp4");
        let preview_path = source_dir.join("clip-preview.png");
        let preview_path_value = preview_path.to_string_lossy().to_string();
        fs::write(&source_path, b"video").expect("source file should exist");
        fs::write(&preview_path, b"preview").expect("preview file should exist");

        let copied_preview = copy_optional_preview_to_dir(
            Some(preview_path_value.as_str()),
            &source_path,
            &target_dir,
        )
        .expect("preview copy should succeed")
        .expect("preview path should be returned");
        let copied_preview_path = PathBuf::from(&copied_preview);

        assert!(copied_preview_path.exists());
        assert_eq!(copied_preview_path.parent(), Some(target_dir.as_path()));
        assert!(preview_path.exists());

        let _ = fs::remove_dir_all(&source_dir);
        let _ = fs::remove_dir_all(&target_dir);
    }

    #[test]
    fn sync_optional_preview_path_to_dir_moves_preview_into_target_folder() {
        let source_dir = create_temp_test_dir("sync-preview-source");
        let target_dir = create_temp_test_dir("sync-preview-target");
        let source_path = target_dir.join("clip.mp4");
        let preview_path = source_dir.join("clip-preview.png");
        let preview_path_value = preview_path.to_string_lossy().to_string();
        fs::write(&source_path, b"video").expect("source file should exist");
        fs::write(&preview_path, b"preview").expect("preview file should exist");

        let synced_preview = sync_optional_preview_path_to_dir(
            Some(preview_path_value.as_str()),
            &source_path,
            &target_dir,
        )
        .expect("preview sync should succeed")
        .expect("preview path should be returned");
        let synced_preview_path = PathBuf::from(&synced_preview);

        assert!(synced_preview_path.exists());
        assert_eq!(synced_preview_path.parent(), Some(target_dir.as_path()));
        assert!(!preview_path.exists());

        let _ = fs::remove_dir_all(&source_dir);
        let _ = fs::remove_dir_all(&target_dir);
    }
}
