use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tracing::{info, warn};
use uuid::Uuid;

use super::project_state;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub custom_path: Option<String>,
    #[serde(default)]
    pub legacy_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaPersistContext {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

const STORAGE_CONFIG_FILE: &str = "storage_config.json";
const STORAGE_SESSION_FILE: &str = "storage-session.json";
const STORAGE_MEDIA_URI_PREFIX: &str = "sb://storage/";
const STORAGE_SESSION_STALE_MS: i64 = 2 * 60 * 1000;
const AUTO_DATABASE_BACKUP_KIND: &str = "auto";
const MANUAL_DATABASE_BACKUP_KIND: &str = "manual";
const PRE_RESTORE_DATABASE_BACKUP_KIND: &str = "pre_restore";
pub(crate) const PRE_PERSIST_DATABASE_BACKUP_KIND: &str = "pre_persist";
const AUTO_DATABASE_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const AUTO_DATABASE_BACKUP_RETENTION_COUNT: usize = 7;
const PRE_RESTORE_DATABASE_BACKUP_RETENTION_COUNT: usize = 2;
const PRE_PERSIST_DATABASE_BACKUP_RETENTION_COUNT: usize = 8;
const AUTOMATIC_DATABASE_BACKUP_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DATABASE_BACKUP_SIDECAR_CLEANUP_GRACE_MS: i64 = 5 * 60 * 1000;
static CURRENT_STORAGE_SESSION_ID: OnceLock<String> = OnceLock::new();
const LEGACY_STORAGE_DIR_NAMES: &[&str] = &[
    "Storyboard-Copilot",
    "storyboard-copilot",
    "Storyboard Copilot",
    "StoryboardCopilot",
    "分镜助手",
    "短剧助手",
    "OOpii无限画布",
    "OOpii鏃犻檺鐢诲竷",
];

#[derive(Debug, Clone)]
struct LegacyStorageCandidate {
    path: PathBuf,
    score: u8,
    modified_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSessionStatus {
    pub current_path: String,
    pub machine_id: String,
    pub session_id: String,
    pub process_id: u32,
    pub active: bool,
    pub stale: bool,
    #[serde(default)]
    pub owner_machine_id: Option<String>,
    #[serde(default)]
    pub owner_session_id: Option<String>,
    #[serde(default)]
    pub owner_process_id: Option<u32>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageSessionRecord {
    pub machine_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub process_id: Option<u32>,
    pub started_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAdoptionResult {
    pub previous_path: String,
    pub adopted_path: String,
    pub safety_backup: Option<DatabaseBackupRecord>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageMediaMigrationStats {
    pub project_payloads_rewritten: u64,
    pub asset_items_rewritten: u64,
    pub generation_history_items_rewritten: u64,
    pub jimeng_queue_jobs_rewritten: u64,
    pub clip_items_rewritten: u64,
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join(STORAGE_CONFIG_FILE))
}

fn read_storage_config(app: &AppHandle) -> Result<StorageConfig, String> {
    let config_path = get_config_path(app)?;
    read_storage_config_from_path(&config_path)
}

fn read_storage_config_from_path(config_path: &Path) -> Result<StorageConfig, String> {
    if !config_path.exists() {
        return Ok(StorageConfig::default());
    }

    let mut file =
        fs::File::open(config_path).map_err(|e| format!("Failed to open storage config: {}", e))?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read storage config: {}", e))?;

    let config = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse storage config: {}", e))?;
    Ok(normalize_storage_config(config))
}

fn write_storage_config(app: &AppHandle, config: &StorageConfig) -> Result<(), String> {
    let config_path = get_config_path(app)?;

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize storage config: {}", e))?;

    let mut file = fs::File::create(&config_path)
        .map_err(|e| format!("Failed to create storage config: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write storage config: {}", e))?;

    Ok(())
}

fn normalize_storage_config(config: StorageConfig) -> StorageConfig {
    let custom_path = config
        .custom_path
        .as_deref()
        .and_then(normalize_storage_path_string);
    let custom_compare_key = custom_path.as_deref().map(storage_path_compare_key);

    let mut seen = HashSet::new();
    let mut legacy_paths = Vec::new();

    for raw_path in config.legacy_paths {
        let Some(normalized_path) = normalize_storage_path_string(&raw_path) else {
            continue;
        };
        let compare_key = storage_path_compare_key(&normalized_path);
        if custom_compare_key.as_ref() == Some(&compare_key) {
            continue;
        }
        if seen.insert(compare_key) {
            legacy_paths.push(normalized_path);
        }
    }

    StorageConfig {
        custom_path,
        legacy_paths,
    }
}

pub fn get_default_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve default storage path: {}", e))
}

pub fn resolve_storage_base_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config = read_storage_config(app)?;

    if let Some(custom_path) = config.custom_path {
        if !custom_path.is_empty() {
            let path = PathBuf::from(&custom_path);
            fs::create_dir_all(&path)
                .map_err(|e| format!("Failed to create custom storage dir: {}", e))?;
            return Ok(path);
        }
    }

    get_default_storage_path(app)
}

pub(crate) fn resolve_known_storage_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    let push_path = |results: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf| {
        let compare_key = storage_path_compare_key(&path.to_string_lossy().replace('\\', "/"));
        if seen.insert(compare_key) {
            results.push(path);
        }
    };

    let current_path = resolve_storage_base_path(app)?;
    push_path(&mut results, &mut seen, current_path);

    let default_path = get_default_storage_path(app)?;
    push_path(&mut results, &mut seen, default_path);

    let config = read_storage_config(app)?;
    for legacy_path in config.legacy_paths {
        push_path(&mut results, &mut seen, PathBuf::from(legacy_path));
    }

    Ok(results)
}

pub fn recover_storage_from_legacy_default_if_needed(
    app: &AppHandle,
) -> Result<Option<PathBuf>, String> {
    let mut config = read_storage_config(app)?;
    if config.custom_path.is_some() {
        return Ok(None);
    }

    let default_path = get_default_storage_path(app)?;
    if evaluate_legacy_storage_candidate(&default_path).is_some() {
        return Ok(None);
    }

    let Some(best_candidate) = discover_legacy_storage_candidates(app, &default_path)?
        .into_iter()
        .next()
    else {
        return Ok(None);
    };

    let normalized_candidate =
        normalize_storage_path_string(&best_candidate.path.to_string_lossy()).ok_or_else(|| {
            format!(
                "Failed to normalize recovered storage path: {}",
                best_candidate.path.display()
            )
        })?;

    info!(
        "Recovered legacy storage root {} for empty default storage {}",
        best_candidate.path.display(),
        default_path.display()
    );

    config.custom_path = Some(normalized_candidate);
    let config = normalize_storage_config(config);
    write_storage_config(app, &config)?;

    Ok(config.custom_path.map(PathBuf::from))
}

fn allow_asset_scope_directory(app: &AppHandle, path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create storage scope directory: {}", e))?;

    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| {
            format!(
                "Failed to allow storage directory for asset protocol ({}): {}",
                path.display(),
                e
            )
        })?;

    Ok(())
}

pub fn ensure_storage_asset_scope(app: &AppHandle) -> Result<(), String> {
    let current_path = resolve_storage_base_path(app)?;
    allow_asset_scope_directory(app, &current_path)?;

    let default_path = get_default_storage_path(app)?;
    if default_path != current_path {
        allow_asset_scope_directory(app, &default_path)?;
    }

    let config = read_storage_config(app)?;
    for legacy_path in config.legacy_paths {
        let legacy_path = PathBuf::from(legacy_path);
        if legacy_path == current_path || legacy_path == default_path {
            continue;
        }
        allow_asset_scope_directory(app, &legacy_path)?;
    }

    Ok(())
}

pub fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    Ok(base_path.join("projects.db"))
}

pub fn resolve_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    let images_dir = base_path.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| format!("Failed to create images dir: {}", e))?;
    Ok(images_dir)
}

pub(crate) fn normalize_media_extension(raw_ext: &str) -> String {
    let ext = raw_ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if ext.is_empty() {
        return "bin".to_string();
    }

    if ext == "jpeg" {
        return "jpg".to_string();
    }

    ext
}

pub(crate) fn media_type_from_extension(raw_ext: &str) -> String {
    match normalize_media_extension(raw_ext).as_str() {
        "mp4" | "webm" | "ogv" | "mov" | "avi" | "mkv" => "video".to_string(),
        "mp3" | "wav" | "ogg" | "oga" | "m4a" | "aac" | "flac" => "audio".to_string(),
        "glb" | "gltf" | "fbx" => "model".to_string(),
        _ => "image".to_string(),
    }
}

fn normalize_media_type(value: Option<&str>, extension: &str) -> String {
    match value.map(str::trim).filter(|item| !item.is_empty()) {
        Some(value) if value.eq_ignore_ascii_case("video") => "video".to_string(),
        Some(value) if value.eq_ignore_ascii_case("audio") => "audio".to_string(),
        Some(value) if value.eq_ignore_ascii_case("model") => "model".to_string(),
        Some(value) if value.eq_ignore_ascii_case("image") => "image".to_string(),
        _ => media_type_from_extension(extension),
    }
}

fn normalize_media_role(value: Option<&str>) -> String {
    match value.map(str::trim).filter(|item| !item.is_empty()) {
        Some(value)
            if value.eq_ignore_ascii_case("preview") || value.eq_ignore_ascii_case("previews") =>
        {
            "previews".to_string()
        }
        Some(value) if value.eq_ignore_ascii_case("cache") => "cache".to_string(),
        _ => "originals".to_string(),
    }
}

fn sanitize_project_dir_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut sanitized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        }
    }

    let compact = sanitized.trim_matches('-').trim_matches('_').to_string();
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

pub(crate) fn resolve_project_media_root_in_base(
    base_path: &Path,
    project_id: &str,
) -> Option<PathBuf> {
    sanitize_project_dir_name(project_id)
        .map(|safe_project_id| base_path.join("projects").join(safe_project_id))
}

pub(crate) fn resolve_project_media_root(
    app: &AppHandle,
    project_id: &str,
) -> Result<Option<PathBuf>, String> {
    let base_path = resolve_storage_base_path(app)?;
    Ok(resolve_project_media_root_in_base(&base_path, project_id))
}

pub(crate) fn resolve_media_dir_in_base(
    base_path: &Path,
    context: Option<&MediaPersistContext>,
    extension: &str,
    default_role: &str,
) -> PathBuf {
    let context = context.cloned().unwrap_or_default();
    let media_type = normalize_media_type(context.media_type.as_deref(), extension);
    let role = normalize_media_role(context.role.as_deref().or(Some(default_role)));
    let scope_root = context
        .project_id
        .as_deref()
        .and_then(|project_id| resolve_project_media_root_in_base(base_path, project_id))
        .unwrap_or_else(|| base_path.join("shared"));

    match media_type.as_str() {
        "video" => scope_root.join("videos"),
        "audio" => scope_root.join("audio"),
        "model" => scope_root.join("models"),
        _ => scope_root.join("images").join(role),
    }
}

pub(crate) fn resolve_media_dir(
    app: &AppHandle,
    context: Option<&MediaPersistContext>,
    extension: &str,
    default_role: &str,
) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    let media_dir = resolve_media_dir_in_base(&base_path, context, extension, default_role);
    fs::create_dir_all(&media_dir).map_err(|e| format!("Failed to create media dir: {}", e))?;
    Ok(media_dir)
}

fn build_temp_media_output_path(output_path: &Path, attempt: u32) -> Result<PathBuf, String> {
    let parent = output_path.parent().ok_or_else(|| {
        format!(
            "Persist target has no parent directory: {}",
            output_path.display()
        )
    })?;
    let file_name = output_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "storyboard-media".to_string());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    Ok(parent.join(format!(
        ".{}.{}.{}.tmp",
        file_name,
        std::process::id(),
        stamp + u128::from(attempt)
    )))
}

fn verify_persisted_media_path(output_path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(output_path)
        .map_err(|e| format!("Failed to inspect persisted media: {}", e))?;

    if !metadata.is_file() {
        return Err(format!(
            "Persisted media is not a file: {}",
            output_path.display()
        ));
    }

    if metadata.len() == 0 {
        return Err(format!(
            "Persisted media is empty: {}",
            output_path.display()
        ));
    }

    Ok(())
}

fn write_media_bytes_atomically(output_path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Failed to persist media: bytes are empty".to_string());
    }

    let parent = output_path.parent().ok_or_else(|| {
        format!(
            "Persist target has no parent directory: {}",
            output_path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create media output dir: {}", e))?;

    if verify_persisted_media_path(output_path).is_ok() {
        return Ok(());
    }

    for attempt in 0..24_u32 {
        if verify_persisted_media_path(output_path).is_ok() {
            return Ok(());
        }

        let temp_path = build_temp_media_output_path(output_path, attempt)?;
        let temp_file_result = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path);

        let mut temp_file = match temp_file_result {
            Ok(file) => file,
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("Failed to create temp media file: {}", err)),
        };

        if let Err(err) = temp_file.write_all(bytes) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to write temp media file: {}", err));
        }

        if let Err(err) = temp_file.sync_all() {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to sync temp media file: {}", err));
        }

        drop(temp_file);

        match fs::rename(&temp_path, output_path) {
            Ok(()) => {
                verify_persisted_media_path(output_path)?;
                return Ok(());
            }
            Err(err) => {
                if verify_persisted_media_path(output_path).is_ok() {
                    let _ = fs::remove_file(&temp_path);
                    return Ok(());
                }

                let copy_result = if output_path.exists() {
                    fs::copy(&temp_path, output_path).map(|_| ())
                } else {
                    Err(err)
                };
                let _ = fs::remove_file(&temp_path);
                copy_result
                    .map_err(|copy_err| format!("Failed to finalize media file: {}", copy_err))?;
                verify_persisted_media_path(output_path)?;
                return Ok(());
            }
        }
    }

    Err(format!(
        "Failed to persist media after repeated attempts: {}",
        output_path.display()
    ))
}

pub(crate) fn persist_media_bytes_in_base(
    base_path: &Path,
    bytes: &[u8],
    extension: &str,
    context: Option<&MediaPersistContext>,
    default_role: &str,
) -> Result<String, String> {
    let normalized_extension = normalize_media_extension(extension);
    let media_dir =
        resolve_media_dir_in_base(base_path, context, &normalized_extension, default_role);
    let digest = md5::compute(bytes);
    let filename = format!("{:x}.{}", digest, normalized_extension);
    let output_path = media_dir.join(filename);

    write_media_bytes_atomically(&output_path, bytes)?;
    verify_persisted_media_path(&output_path)?;

    Ok(output_path.to_string_lossy().to_string())
}

pub(crate) fn persist_media_bytes(
    app: &AppHandle,
    bytes: &[u8],
    extension: &str,
    context: Option<&MediaPersistContext>,
    default_role: &str,
) -> Result<String, String> {
    let base_path = resolve_storage_base_path(app)?;
    persist_media_bytes_in_base(&base_path, bytes, extension, context, default_role)
}

fn push_unique_path(results: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    let compare_key = storage_path_compare_key(&path.to_string_lossy().replace('\\', "/"));
    if seen.insert(compare_key) {
        results.push(path);
    }
}

fn push_known_media_dirs_for_scope(
    results: &mut Vec<PathBuf>,
    seen: &mut HashSet<String>,
    scope_root: &Path,
) {
    for role in ["originals", "previews", "cache"] {
        push_unique_path(results, seen, scope_root.join("images").join(role));
    }
    push_unique_path(results, seen, scope_root.join("videos"));
    push_unique_path(results, seen, scope_root.join("audio"));
    push_unique_path(results, seen, scope_root.join("models"));
}

fn push_known_media_dirs_for_root(
    results: &mut Vec<PathBuf>,
    seen: &mut HashSet<String>,
    root: &Path,
) {
    push_unique_path(results, seen, root.join("images"));
    push_known_media_dirs_for_scope(results, seen, &root.join("shared"));

    let projects_root = root.join("projects");
    let Ok(entries) = fs::read_dir(&projects_root) else {
        return;
    };

    for entry in entries.flatten() {
        let project_root = entry.path();
        if project_root.is_dir() {
            push_known_media_dirs_for_scope(results, seen, &project_root);
        }
    }
}

pub(crate) fn resolve_known_media_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let roots = resolve_known_storage_roots(app)?;
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        push_known_media_dirs_for_root(&mut results, &mut seen, &root);
    }

    Ok(results)
}

pub(crate) fn normalize_storage_path_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/").trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }

    Some(normalized)
}

fn is_transient_or_remote_media_value(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("data:")
        || lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("blob:")
        || lower.starts_with("asset://")
        || lower.starts_with("tauri:")
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

fn normalize_local_media_path_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.starts_with(STORAGE_MEDIA_URI_PREFIX)
        || is_transient_or_remote_media_value(trimmed)
    {
        return None;
    }

    if trimmed.to_ascii_lowercase().starts_with("file://") {
        return normalize_storage_path_string(&decode_file_url_path(trimmed));
    }

    normalize_storage_path_string(trimmed)
}

fn encode_storage_uri_relative_path(relative_path: &str) -> String {
    relative_path
        .split('/')
        .map(urlencoding::encode)
        .map(|item| item.into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn decode_storage_uri_relative_path(relative_path: &str) -> Option<String> {
    if relative_path.trim().is_empty() {
        return None;
    }

    let mut segments = Vec::new();
    for raw_segment in relative_path.split('/') {
        if raw_segment.is_empty() {
            return None;
        }
        let segment = urlencoding::decode(raw_segment).ok()?.into_owned();
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('/')
            || segment.contains('\\')
            || segment.contains(':')
        {
            return None;
        }
        segments.push(segment);
    }

    Some(segments.join("/"))
}

fn storage_relative_path_from_absolute(value: &str, base_path: &Path) -> Option<String> {
    let normalized_value = normalize_local_media_path_value(value)?;
    let normalized_base = normalize_storage_path_string(&base_path.to_string_lossy())?;
    let compare_value = storage_path_compare_key(&normalized_value);
    let compare_base = storage_path_compare_key(&normalized_base);

    if compare_value == compare_base {
        return None;
    }

    let compare_prefix = format!("{}/", compare_base);
    if !compare_value.starts_with(&compare_prefix) {
        return None;
    }

    let relative_path = normalized_value[normalized_base.len() + 1..].to_string();
    if relative_path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }

    Some(relative_path)
}

pub(crate) fn encode_storage_media_ref_in_base(base_path: &Path, value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with(STORAGE_MEDIA_URI_PREFIX) {
        return value.to_string();
    }

    let Some(relative_path) = storage_relative_path_from_absolute(trimmed, base_path) else {
        return value.to_string();
    };

    format!(
        "{}{}",
        STORAGE_MEDIA_URI_PREFIX,
        encode_storage_uri_relative_path(&relative_path)
    )
}

pub(crate) fn decode_storage_media_ref_in_base(base_path: &Path, value: &str) -> String {
    let trimmed = value.trim();
    let Some(relative_path) = trimmed.strip_prefix(STORAGE_MEDIA_URI_PREFIX) else {
        return value.to_string();
    };
    let Some(decoded_relative_path) = decode_storage_uri_relative_path(relative_path) else {
        return value.to_string();
    };

    let mut path = base_path.to_path_buf();
    for segment in decoded_relative_path.split('/') {
        path.push(segment);
    }
    path.to_string_lossy().to_string()
}

pub fn encode_storage_media_ref(app: &AppHandle, value: &str) -> String {
    resolve_storage_base_path(app)
        .map(|base_path| encode_storage_media_ref_in_base(&base_path, value))
        .unwrap_or_else(|_| value.to_string())
}

pub fn decode_storage_media_ref(app: &AppHandle, value: &str) -> String {
    resolve_storage_base_path(app)
        .map(|base_path| decode_storage_media_ref_in_base(&base_path, value))
        .unwrap_or_else(|_| value.to_string())
}

pub(crate) fn is_media_reference_key(key: &str) -> bool {
    matches!(
        key,
        "imageUrl"
            | "previewImageUrl"
            | "thumbnailUrl"
            | "sourceImageUrl"
            | "maskImageUrl"
            | "videoUrl"
            | "audioUrl"
            | "sourceUrl"
            | "posterSourceUrl"
            | "referenceUrl"
            | "sourcePath"
            | "previewPath"
            | "source_path"
            | "preview_path"
            | "image_path"
            | "preview_image_path"
            | "waveform_path"
    )
}

pub(crate) fn rewrite_media_refs_in_json_value<F>(value: &mut Value, rewrite: &F) -> bool
where
    F: Fn(&str) -> String,
{
    match value {
        Value::Object(record) => {
            let mut changed = false;
            for (key, nested) in record {
                if is_media_reference_key(key) {
                    if let Some(current) = nested.as_str() {
                        let next = rewrite(current);
                        if next != current {
                            *nested = Value::String(next);
                            changed = true;
                        }
                    }
                }
                changed |= rewrite_media_refs_in_json_value(nested, rewrite);
            }
            changed
        }
        Value::Array(items) => items.iter_mut().fold(false, |changed, item| {
            rewrite_media_refs_in_json_value(item, rewrite) || changed
        }),
        _ => false,
    }
}

pub(crate) fn rewrite_media_refs_in_json_string<F>(
    json: &str,
    rewrite: &F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> String,
{
    let mut parsed = serde_json::from_str::<Value>(json)
        .map_err(|e| format!("Failed to parse media ref json payload: {}", e))?;
    if !rewrite_media_refs_in_json_value(&mut parsed, rewrite) {
        return Ok(None);
    }
    serde_json::to_string(&parsed)
        .map(Some)
        .map_err(|e| format!("Failed to serialize media ref json payload: {}", e))
}

fn storage_path_compare_key(value: &str) -> String {
    if cfg!(target_os = "windows") {
        value.to_ascii_lowercase()
    } else {
        value.to_string()
    }
}

fn storage_roots_equal(left: &Path, right: &Path) -> bool {
    storage_path_compare_key(&left.to_string_lossy().replace('\\', "/"))
        == storage_path_compare_key(&right.to_string_lossy().replace('\\', "/"))
}

fn storage_path_key(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/').to_string();
    storage_path_compare_key(&normalized)
}

fn storage_path_is_same_or_child(path: &Path, possible_parent: &Path) -> bool {
    let path_key = storage_path_key(path);
    let parent_key = storage_path_key(possible_parent);
    path_key == parent_key || path_key.starts_with(&format!("{parent_key}/"))
}

fn ensure_non_overlapping_storage_paths(
    current_path: &Path,
    target_path: &Path,
) -> Result<(), String> {
    if storage_path_is_same_or_child(target_path, current_path) {
        return Err(format!(
            "Target storage path cannot be the current storage path or inside it. Current: {} Target: {}",
            current_path.display(),
            target_path.display()
        ));
    }

    if storage_path_is_same_or_child(current_path, target_path) {
        return Err(format!(
            "Target storage path cannot contain the current storage path. Current: {} Target: {}",
            current_path.display(),
            target_path.display()
        ));
    }

    Ok(())
}

fn directory_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some()
}

fn collect_storage_root_variants(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    let push_path = |results: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf| {
        let compare_key = storage_path_compare_key(&path.to_string_lossy().replace('\\', "/"));
        if seen.insert(compare_key) {
            results.push(path);
        }
    };

    push_path(&mut results, &mut seen, root.to_path_buf());

    if let Ok(config) = read_storage_config_from_path(&root.join(STORAGE_CONFIG_FILE)) {
        if let Some(custom_path) = config.custom_path {
            push_path(&mut results, &mut seen, PathBuf::from(custom_path));
        }

        for legacy_path in config.legacy_paths {
            push_path(&mut results, &mut seen, PathBuf::from(legacy_path));
        }
    }

    results
}

fn evaluate_legacy_storage_candidate(path: &Path) -> Option<LegacyStorageCandidate> {
    if !path.exists() || !path.is_dir() {
        return None;
    }

    let db_path = path.join("projects.db");
    let db_metadata = fs::metadata(&db_path)
        .ok()
        .filter(|metadata| metadata.len() > 0);
    let config_metadata = fs::metadata(path.join(STORAGE_CONFIG_FILE)).ok();
    let images_dir = path.join("images");
    let images_has_entries = images_dir.is_dir() && directory_has_entries(&images_dir);
    let backups_dir = path.join("backups").join("db");
    let backups_has_entries = backups_dir.is_dir() && directory_has_entries(&backups_dir);

    let score = if db_metadata.is_some() {
        4
    } else if images_has_entries {
        3
    } else if backups_has_entries {
        2
    } else if config_metadata.is_some() {
        1
    } else {
        0
    };

    if score == 0 {
        return None;
    }

    let modified_at = db_metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .or_else(|| {
            config_metadata
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
        })
        .or_else(|| {
            fs::metadata(&images_dir)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
        })
        .or_else(|| {
            fs::metadata(&backups_dir)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
        })
        .map(system_time_to_timestamp_ms)
        .unwrap_or_default();

    Some(LegacyStorageCandidate {
        path: path.to_path_buf(),
        score,
        modified_at,
    })
}

fn discover_legacy_storage_candidates(
    app: &AppHandle,
    default_path: &Path,
) -> Result<Vec<LegacyStorageCandidate>, String> {
    let parent_dir = match default_path.parent() {
        Some(parent) => parent,
        None => return Ok(Vec::new()),
    };

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for dir_name in LEGACY_STORAGE_DIR_NAMES {
        let root = parent_dir.join(dir_name);
        for variant in collect_storage_root_variants(&root) {
            if storage_roots_equal(&variant, default_path) {
                continue;
            }

            let compare_key =
                storage_path_compare_key(&variant.to_string_lossy().replace('\\', "/"));
            if !seen.insert(compare_key) {
                continue;
            }

            if let Some(candidate) = evaluate_legacy_storage_candidate(&variant) {
                candidates.push(candidate);
            }
        }
    }

    let current_config_path = get_config_path(app)?;
    for variant in
        collect_storage_root_variants(current_config_path.parent().unwrap_or(default_path))
    {
        if storage_roots_equal(&variant, default_path) {
            continue;
        }

        let compare_key = storage_path_compare_key(&variant.to_string_lossy().replace('\\', "/"));
        if !seen.insert(compare_key) {
            continue;
        }

        if let Some(candidate) = evaluate_legacy_storage_candidate(&variant) {
            candidates.push(candidate);
        }
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.modified_at.cmp(&left.modified_at))
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(candidates)
}

fn remember_legacy_storage_path(config: &mut StorageConfig, path: &Path) {
    let Some(normalized_path) = normalize_storage_path_string(&path.to_string_lossy()) else {
        return;
    };
    let compare_key = storage_path_compare_key(&normalized_path);

    if config
        .custom_path
        .as_deref()
        .is_some_and(|current| storage_path_compare_key(current) == compare_key)
    {
        return;
    }

    if config
        .legacy_paths
        .iter()
        .any(|item| storage_path_compare_key(item) == compare_key)
    {
        return;
    }

    config.legacy_paths.push(normalized_path);
}

pub(crate) fn rebase_storage_path_string(
    value: &str,
    from_base: &Path,
    to_base: &Path,
) -> Option<String> {
    let normalized_value = normalize_storage_path_string(value)?;
    let normalized_from_base = normalize_storage_path_string(&from_base.to_string_lossy())?;
    let normalized_to_base = normalize_storage_path_string(&to_base.to_string_lossy())?;
    let compare_value = storage_path_compare_key(&normalized_value);
    let compare_from_base = storage_path_compare_key(&normalized_from_base);

    if compare_value == compare_from_base {
        return Some(normalized_to_base);
    }

    let compare_prefix = format!("{}/", compare_from_base);
    if !compare_value.starts_with(&compare_prefix) {
        return None;
    }

    let suffix = &normalized_value[normalized_from_base.len() + 1..];
    Some(format!("{}/{}", normalized_to_base, suffix))
}

pub(crate) fn relocate_storage_path_to_known_media_dirs(
    value: &str,
    media_dirs: &[PathBuf],
) -> Option<String> {
    let normalized_value = normalize_storage_path_string(value)?;
    let current_path = PathBuf::from(&normalized_value);
    if current_path.exists() {
        return None;
    }

    let file_name = current_path.file_name()?.to_str()?;
    let normalized_value_compare_key = storage_path_compare_key(&normalized_value);

    for media_dir in media_dirs {
        let candidate_path = media_dir.join(file_name);
        if !candidate_path.exists() {
            continue;
        }

        let normalized_candidate =
            normalize_storage_path_string(&candidate_path.to_string_lossy())?;
        if storage_path_compare_key(&normalized_candidate) == normalized_value_compare_key {
            continue;
        }

        return Some(normalized_candidate);
    }

    None
}

#[cfg(test)]
pub(crate) fn relocate_storage_path_to_known_images_dirs(
    value: &str,
    images_dirs: &[PathBuf],
) -> Option<String> {
    let normalized_value = normalize_storage_path_string(value)?;
    let current_path = PathBuf::from(&normalized_value);
    let parent_name = current_path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())?;
    if !matches!(
        parent_name.to_ascii_lowercase().as_str(),
        "images" | "originals" | "previews" | "cache"
    ) {
        return None;
    }

    relocate_storage_path_to_known_media_dirs(&normalized_value, images_dirs)
}

pub fn resolve_debug_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    let debug_dir = base_path.join("debug");
    fs::create_dir_all(&debug_dir).map_err(|e| format!("Failed to create debug dir: {}", e))?;
    Ok(debug_dir)
}

pub fn resolve_db_backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    let backups_dir = base_path.join("backups").join("db");
    fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create database backups dir: {}", e))?;
    Ok(backups_dir)
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn resolve_machine_id_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok(app_data_dir.join("machine_id"))
}

fn read_or_create_machine_id(app: &AppHandle) -> Result<String, String> {
    let path = resolve_machine_id_path(app)?;
    if path.exists() {
        let value = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read machine id: {}", e))?
            .trim()
            .to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }

    let value = Uuid::new_v4().to_string();
    fs::write(&path, &value).map_err(|e| format!("Failed to write machine id: {}", e))?;
    Ok(value)
}

fn current_storage_session_id() -> String {
    CURRENT_STORAGE_SESSION_ID
        .get_or_init(|| Uuid::new_v4().to_string())
        .clone()
}

fn process_is_running(process_id: u32) -> bool {
    if process_id == 0 {
        return false;
    }
    if process_id == std::process::id() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("tasklist")
            .args([
                "/FI",
                &format!("PID eq {}", process_id),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output();
        let Ok(output) = output else {
            return true;
        };
        if !output.status.success() {
            return false;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains(&process_id.to_string()) && !stdout.trim_start().starts_with("INFO:")
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        std::process::Command::new("kill")
            .args(["-0", &process_id.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(true)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        true
    }
}

fn resolve_storage_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_storage_base_path(app)?.join(STORAGE_SESSION_FILE))
}

fn build_storage_session_temp_path(path: &Path, attempt: u32) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Storage session target has no valid file name: {}",
                path.display()
            )
        })?;

    let stamp = current_timestamp_ms();
    Ok(path.with_file_name(format!(
        "{file_name}.tmp-{}-{}-{attempt}",
        std::process::id(),
        stamp
    )))
}

fn build_invalid_storage_session_backup_path(path: &Path, attempt: u32) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Storage session target has no valid file name: {}",
                path.display()
            )
        })?;

    let stamp = current_timestamp_ms();
    Ok(path.with_file_name(format!(
        "{file_name}.corrupt-{}-{}-{attempt}.bak",
        std::process::id(),
        stamp
    )))
}

fn write_text_file_atomically(path: &Path, content: &str, label: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} target has no parent directory: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create {label} dir: {}", e))?;

    for attempt in 0..24_u32 {
        let temp_path = build_storage_session_temp_path(path, attempt)?;
        let temp_file_result = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path);

        let mut temp_file = match temp_file_result {
            Ok(file) => file,
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("Failed to create temp {label} file: {}", err)),
        };

        if let Err(err) = temp_file.write_all(content.as_bytes()) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to write temp {label} file: {}", err));
        }

        if let Err(err) = temp_file.sync_all() {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to sync temp {label} file: {}", err));
        }

        drop(temp_file);

        match fs::rename(&temp_path, path) {
            Ok(()) => return Ok(()),
            Err(err) => {
                let copy_result = if path.exists() {
                    fs::copy(&temp_path, path).map(|_| ())
                } else {
                    Err(err)
                };
                let _ = fs::remove_file(&temp_path);
                copy_result
                    .map_err(|copy_err| format!("Failed to finalize {label} file: {}", copy_err))?;
                return Ok(());
            }
        }
    }

    Err(format!(
        "Failed to allocate temp {label} file after multiple attempts"
    ))
}

fn quarantine_invalid_storage_session_file(path: &Path) -> Result<Option<PathBuf>, String> {
    for attempt in 0..24_u32 {
        let backup_path = build_invalid_storage_session_backup_path(path, attempt)?;
        match fs::rename(path, &backup_path) {
            Ok(()) => return Ok(Some(backup_path)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(format!(
                    "Failed to quarantine invalid storage session file {}: {}",
                    path.display(),
                    err
                ))
            }
        }
    }

    Err(format!(
        "Failed to allocate invalid storage session backup path for {}",
        path.display()
    ))
}

fn read_storage_session_record_at_path(
    base_path: &Path,
) -> Result<Option<StorageSessionRecord>, String> {
    let path = base_path.join(STORAGE_SESSION_FILE);
    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read storage session: {}", e))?;
    if content.trim().is_empty() {
        return Ok(None);
    }

    match serde_json::from_str::<StorageSessionRecord>(&content) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            match quarantine_invalid_storage_session_file(&path) {
                Ok(Some(backup_path)) => warn!(
                    "Ignored invalid storage session file {} (backed up to {}): {}",
                    path.display(),
                    backup_path.display(),
                    error
                ),
                Ok(None) => warn!(
                    "Ignored invalid storage session file {} because it disappeared during recovery: {}",
                    path.display(),
                    error
                ),
                Err(quarantine_error) => warn!(
                    "Ignored invalid storage session file {} but failed to back it up: {}. Parse error: {}",
                    path.display(),
                    quarantine_error,
                    error
                ),
            }
            Ok(None)
        }
    }
}

fn write_storage_session_record(
    app: &AppHandle,
    record: &StorageSessionRecord,
) -> Result<(), String> {
    let path = resolve_storage_session_path(app)?;
    let content = serde_json::to_string_pretty(record)
        .map_err(|e| format!("Failed to serialize storage session: {}", e))?;
    write_text_file_atomically(&path, &content, "storage session")
}

fn check_storage_session_for_path(
    app: &AppHandle,
    current_path: &Path,
) -> Result<StorageSessionStatus, String> {
    let machine_id = read_or_create_machine_id(app)?;
    let session_id = current_storage_session_id();
    let process_id = std::process::id();
    let now = current_timestamp_ms();
    let existing = read_storage_session_record_at_path(current_path)?;

    let (
        active,
        stale,
        owner_machine_id,
        owner_session_id,
        owner_process_id,
        started_at,
        updated_at,
    ) = match existing {
        Some(record) => {
            let same_machine = record.machine_id == machine_id;
            let same_session = record
                .session_id
                .as_deref()
                .is_some_and(|value| value == session_id)
                || (record.session_id.is_none() && same_machine);
            let time_stale = now.saturating_sub(record.updated_at) > STORAGE_SESSION_STALE_MS;
            let owner_process_alive = if same_machine && !same_session {
                record.process_id.is_some_and(process_is_running)
            } else {
                true
            };
            let stale = time_stale || !owner_process_alive;
            (
                !same_session && !stale,
                stale,
                Some(record.machine_id),
                record.session_id,
                record.process_id,
                Some(record.started_at),
                Some(record.updated_at),
            )
        }
        None => (false, false, None, None, None, None, None),
    };

    Ok(StorageSessionStatus {
        current_path: current_path.to_string_lossy().to_string(),
        machine_id,
        session_id,
        process_id,
        active,
        stale,
        owner_machine_id,
        owner_session_id,
        owner_process_id,
        started_at,
        updated_at,
    })
}

#[tauri::command]
pub fn check_storage_session(app: AppHandle) -> Result<StorageSessionStatus, String> {
    let current_path = resolve_storage_base_path(&app)?;
    check_storage_session_for_path(&app, &current_path)
}

pub(crate) fn ensure_storage_session_write_allowed(app: &AppHandle) -> Result<(), String> {
    let current_path = resolve_storage_base_path(app)?;
    let status = check_storage_session_for_path(app, &current_path)?;
    let machine_id = status.machine_id;
    let now = current_timestamp_ms();
    let started_at = if status.stale || status.active {
        now
    } else {
        status.started_at.unwrap_or(now)
    };

    write_storage_session_record(
        app,
        &StorageSessionRecord {
            machine_id,
            session_id: Some(current_storage_session_id()),
            process_id: Some(std::process::id()),
            started_at,
            updated_at: now,
        },
    )
}

#[tauri::command]
pub fn refresh_storage_session(app: AppHandle) -> Result<(), String> {
    ensure_storage_session_write_allowed(&app)
}

fn system_time_to_timestamp_ms(value: SystemTime) -> i64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn configure_sqlite_connection(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal_mode=WAL: {}", e))?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(|e| format!("Failed to set SQLite busy timeout: {}", e))?;
    Ok(())
}

fn open_sqlite_connection(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;
    configure_sqlite_connection(&conn)?;
    Ok(conn)
}

fn is_protected_storage_child_dir(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }

    let Some(dir_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if !matches!(
        dir_name.to_ascii_lowercase().as_str(),
        "images" | "projects" | "shared" | "backups" | "debug"
    ) {
        return false;
    }

    let Some(parent) = path.parent() else {
        return false;
    };
    if parent.join("projects.db").exists() || parent.join(STORAGE_CONFIG_FILE).exists() {
        return true;
    }

    let storage_child_count = ["images", "projects", "shared", "backups", "debug"]
        .iter()
        .filter(|name| parent.join(name).exists())
        .count();
    storage_child_count >= 2
}

pub(crate) fn move_path_to_system_trash(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if is_protected_storage_child_dir(path) {
        return Err(format!(
            "Refusing to move protected storage media directory to trash: {}",
            path.display()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::{
            SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
            FO_DELETE, SHFILEOPSTRUCTW,
        };

        let from = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let mut operation = SHFILEOPSTRUCTW {
            hwnd: Default::default(),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            pTo: PCWSTR::null(),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
            fAnyOperationsAborted: Default::default(),
            hNameMappings: Default::default(),
            lpszProgressTitle: PCWSTR::null(),
        };

        let result = unsafe { SHFileOperationW(&mut operation) };
        if result != 0 {
            return Err(format!(
                "Failed to move {} to Recycle Bin: Windows error {}",
                path.display(),
                result
            ));
        }
        if operation.fAnyOperationsAborted.as_bool() {
            return Err(format!(
                "Moving {} to Recycle Bin was cancelled",
                path.display()
            ));
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(format!(
                "tell application \"Finder\" to delete POSIX file \"{}\"",
                path.to_string_lossy()
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")
            ))
            .status()
            .map_err(|e| format!("Failed to invoke macOS Trash for {}: {}", path.display(), e))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("Failed to move {} to Trash", path.display()));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for command in ["gio", "kioclient5", "kioclient"] {
            let mut process = std::process::Command::new(command);
            match command {
                "gio" => {
                    process.arg("trash").arg(path);
                }
                _ => {
                    process.arg("move").arg(path).arg("trash:/");
                }
            }
            if process
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
            {
                return Ok(());
            }
        }
        return Err(format!("Failed to move {} to Trash", path.display()));
    }
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove {}: {}", path.display(), error)),
    }
}

fn remove_db_sidecar_files(db_path: &Path) -> Result<(), String> {
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar_path = PathBuf::from(format!("{}{}", db_path.to_string_lossy(), suffix));
        remove_file_if_exists(&sidecar_path)?;
    }

    Ok(())
}

fn is_database_backup_db_file(file_name: &str) -> bool {
    file_name.ends_with(".db")
}

fn is_database_backup_sidecar_file(file_name: &str) -> bool {
    file_name.ends_with(".db-journal")
        || file_name.ends_with(".db-wal")
        || file_name.ends_with(".db-shm")
}

fn cleanup_database_backup_sidecars(backups_dir: &Path) -> Result<(), String> {
    if !backups_dir.exists() {
        return Ok(());
    }

    let now = current_timestamp_ms();
    for entry in fs::read_dir(backups_dir)
        .map_err(|e| format!("Failed to read database backups dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read database backup entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_database_backup_sidecar_file(&file_name) {
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(system_time_to_timestamp_ms)
                .unwrap_or_default();
            if now.saturating_sub(modified_at) < DATABASE_BACKUP_SIDECAR_CLEANUP_GRACE_MS {
                continue;
            }
            remove_file_if_exists(&path)?;
        }
    }

    Ok(())
}

fn copy_database_safely(source_db_path: &Path, target_db_path: &Path) -> Result<(), String> {
    if !source_db_path.exists() {
        return Ok(());
    }

    if let Some(parent) = target_db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create backup destination dir: {}", e))?;
    }

    move_path_to_system_trash(target_db_path)?;
    remove_db_sidecar_files(target_db_path)?;

    let source_conn = open_sqlite_connection(source_db_path)?;
    source_conn
        .backup(
            DatabaseName::Main,
            target_db_path,
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|e| format!("Failed to back up database: {}", e))?;
    remove_db_sidecar_files(target_db_path)?;

    Ok(())
}

fn restore_database_from_backup(
    backup_db_path: &Path,
    target_db_path: &Path,
) -> Result<(), String> {
    if !backup_db_path.exists() {
        return Err(format!(
            "Backup file does not exist: {}",
            backup_db_path.display()
        ));
    }

    if let Some(parent) = target_db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create database dir before restore: {}", e))?;
    }

    remove_db_sidecar_files(target_db_path)?;

    let mut target_conn = open_sqlite_connection(target_db_path)?;
    target_conn
        .restore(
            DatabaseName::Main,
            backup_db_path,
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|e| format!("Failed to restore database: {}", e))?;
    configure_sqlite_connection(&target_conn)?;

    Ok(())
}

fn get_dir_size(path: &PathBuf) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total_size = 0;

    fn calculate_size(dir: &PathBuf, total: &mut u64) -> io::Result<()> {
        if !dir.is_dir() {
            return Ok(());
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                calculate_size(&path, total)?;
            } else {
                *total += entry.metadata()?.len();
            }
        }
        Ok(())
    }

    calculate_size(path, &mut total_size)
        .map_err(|e| format!("Failed to calculate directory size: {}", e))?;

    Ok(total_size)
}

fn count_immediate_child_files(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let mut count = 0_u64;
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        if entry
            .file_type()
            .map_err(|e| format!("Failed to inspect entry type: {}", e))?
            .is_file()
        {
            count += 1;
        }
    }

    Ok(count)
}

fn count_recursive_files(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    if path.is_file() {
        return Ok(1);
    }

    let mut count = 0_u64;
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            count += count_recursive_files(&path)?;
        } else if path.is_file() {
            count += 1;
        }
    }

    Ok(count)
}

fn count_media_files_for_storage_root(root: &Path) -> Result<u64, String> {
    let mut count = 0_u64;
    for child in ["images", "projects", "shared"] {
        count += count_recursive_files(&root.join(child))?;
    }
    Ok(count)
}

fn count_projects_in_db(db_path: &Path) -> Result<i64, String> {
    if !db_path.exists() {
        return Ok(0);
    }

    let conn = open_sqlite_connection(db_path)?;
    let has_projects_table: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| {
            format!(
                "Failed to inspect projects table in {}: {}",
                db_path.display(),
                e
            )
        })?;
    if has_projects_table == 0 {
        return Ok(0);
    }

    conn.query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .map_err(|e| format!("Failed to count projects in {}: {}", db_path.display(), e))
}

fn validate_storage_migration(
    source_path: &Path,
    target_path: &Path,
) -> Result<StorageMigrationValidation, String> {
    let source_db_path = source_path.join("projects.db");
    let target_db_path = target_path.join("projects.db");
    let source_backups_path = source_path.join("backups").join("db");
    let target_backups_path = target_path.join("backups").join("db");

    let source_project_count = count_projects_in_db(&source_db_path)?;
    let target_project_count = count_projects_in_db(&target_db_path)?;
    let source_image_count = count_media_files_for_storage_root(source_path)?;
    let target_image_count = count_media_files_for_storage_root(target_path)?;
    let source_backup_count = count_immediate_child_files(&source_backups_path)?;
    let target_backup_count = count_immediate_child_files(&target_backups_path)?;
    let source_db_size = fs::metadata(&source_db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let target_db_size = fs::metadata(&target_db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let mut warnings = Vec::new();

    if target_project_count < source_project_count {
        return Err(format!(
            "Migration validation failed: target project count {} is smaller than source {}",
            target_project_count, source_project_count
        ));
    }

    if target_db_size == 0 && source_db_size > 0 {
        return Err("Migration validation failed: target database is empty".to_string());
    }

    if target_image_count < source_image_count {
        warnings.push(format!(
            "Target images count {} is smaller than source {}",
            target_image_count, source_image_count
        ));
    }

    if target_backup_count < source_backup_count {
        warnings.push(format!(
            "Target backup count {} is smaller than source {}",
            target_backup_count, source_backup_count
        ));
    }

    Ok(StorageMigrationValidation {
        source_project_count,
        target_project_count,
        source_image_count,
        target_image_count,
        source_backup_count,
        target_backup_count,
        source_db_size,
        target_db_size,
        warnings,
    })
}

fn database_backup_retention_count(kind: &str) -> Option<usize> {
    match kind {
        AUTO_DATABASE_BACKUP_KIND => Some(AUTO_DATABASE_BACKUP_RETENTION_COUNT),
        PRE_RESTORE_DATABASE_BACKUP_KIND => Some(PRE_RESTORE_DATABASE_BACKUP_RETENTION_COUNT),
        PRE_PERSIST_DATABASE_BACKUP_KIND => Some(PRE_PERSIST_DATABASE_BACKUP_RETENTION_COUNT),
        _ => None,
    }
}

fn is_automatic_database_backup_kind(kind: &str) -> bool {
    matches!(
        kind,
        AUTO_DATABASE_BACKUP_KIND
            | PRE_RESTORE_DATABASE_BACKUP_KIND
            | PRE_PERSIST_DATABASE_BACKUP_KIND
    )
}

fn delete_database_backup_record(record: &DatabaseBackupRecord) -> Result<(), String> {
    let path = PathBuf::from(&record.path);
    remove_file_if_exists(&path)?;
    remove_db_sidecar_files(&path)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupRecord {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub created_at: i64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDatabaseBackupResult {
    pub restored_backup_id: String,
    pub safety_backup: Option<DatabaseBackupRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationValidation {
    pub source_project_count: i64,
    pub target_project_count: i64,
    pub source_image_count: u64,
    pub target_image_count: u64,
    pub source_backup_count: u64,
    pub target_backup_count: u64,
    pub source_db_size: u64,
    pub target_db_size: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationResult {
    pub current_path: String,
    pub target_path: String,
    pub validation: StorageMigrationValidation,
}

fn resolve_backup_kind(file_name: &str) -> Option<&'static str> {
    let (prefix, _) = file_name.split_once("__")?;
    match prefix {
        AUTO_DATABASE_BACKUP_KIND => Some(AUTO_DATABASE_BACKUP_KIND),
        MANUAL_DATABASE_BACKUP_KIND => Some(MANUAL_DATABASE_BACKUP_KIND),
        PRE_RESTORE_DATABASE_BACKUP_KIND => Some(PRE_RESTORE_DATABASE_BACKUP_KIND),
        PRE_PERSIST_DATABASE_BACKUP_KIND => Some(PRE_PERSIST_DATABASE_BACKUP_KIND),
        _ => None,
    }
}

fn list_database_backup_records(app: &AppHandle) -> Result<Vec<DatabaseBackupRecord>, String> {
    let backups_dir = resolve_db_backups_dir(app)?;
    cleanup_database_backup_sidecars(&backups_dir)?;
    let mut records = Vec::new();

    for entry in fs::read_dir(&backups_dir)
        .map_err(|e| format!("Failed to read database backups dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read database backup entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if !is_database_backup_db_file(&file_name) {
            continue;
        }

        let Some(kind) = resolve_backup_kind(&file_name) else {
            continue;
        };

        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read database backup metadata: {}", e))?;
        let created_at = metadata
            .modified()
            .map(system_time_to_timestamp_ms)
            .unwrap_or_else(|_| current_timestamp_ms());

        records.push(DatabaseBackupRecord {
            id: file_name,
            kind: kind.to_string(),
            path: path.to_string_lossy().to_string(),
            created_at,
            size: metadata.len(),
        });
    }

    records.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(records)
}

fn prune_database_backups(app: &AppHandle) -> Result<(), String> {
    let backups_dir = resolve_db_backups_dir(app)?;
    cleanup_database_backup_sidecars(&backups_dir)?;

    let records = list_database_backup_records(app)?;
    let mut delete_ids = HashSet::new();

    for kind in [
        AUTO_DATABASE_BACKUP_KIND,
        PRE_RESTORE_DATABASE_BACKUP_KIND,
        PRE_PERSIST_DATABASE_BACKUP_KIND,
    ] {
        let Some(retention_count) = database_backup_retention_count(kind) else {
            continue;
        };

        for record in records
            .iter()
            .filter(|record| record.kind == kind)
            .skip(retention_count)
        {
            delete_ids.insert(record.id.clone());
        }
    }

    let mut automatic_records = records
        .iter()
        .filter(|record| {
            is_automatic_database_backup_kind(&record.kind) && !delete_ids.contains(&record.id)
        })
        .collect::<Vec<_>>();
    let mut automatic_total_size = automatic_records
        .iter()
        .fold(0_u64, |total, record| total.saturating_add(record.size));

    automatic_records.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    for record in automatic_records {
        if automatic_total_size <= AUTOMATIC_DATABASE_BACKUP_MAX_BYTES {
            break;
        }
        if delete_ids.insert(record.id.clone()) {
            automatic_total_size = automatic_total_size.saturating_sub(record.size);
        }
    }

    for record in records {
        if delete_ids.contains(&record.id) {
            delete_database_backup_record(&record)?;
        }
    }

    Ok(())
}

fn create_database_backup_internal(
    app: &AppHandle,
    kind: &'static str,
) -> Result<DatabaseBackupRecord, String> {
    let source_db_path = resolve_db_path(app)?;
    if !source_db_path.exists() {
        return Err("Database file does not exist yet".to_string());
    }

    let source_size = fs::metadata(&source_db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if source_size == 0 {
        return Err("Database file is empty and cannot be backed up yet".to_string());
    }

    let backups_dir = resolve_db_backups_dir(app)?;
    let backup_id = format!("{}__{}.db", kind, current_timestamp_ms());
    let backup_path = backups_dir.join(&backup_id);

    if let Err(error) = copy_database_safely(&source_db_path, &backup_path) {
        let _ = move_path_to_system_trash(&backup_path);
        return Err(error);
    }

    let metadata = fs::metadata(&backup_path)
        .map_err(|e| format!("Failed to read created backup metadata: {}", e))?;
    let record = DatabaseBackupRecord {
        id: backup_id,
        kind: kind.to_string(),
        path: backup_path.to_string_lossy().to_string(),
        created_at: metadata
            .modified()
            .map(system_time_to_timestamp_ms)
            .unwrap_or_else(|_| current_timestamp_ms()),
        size: metadata.len(),
    };

    prune_database_backups(app)?;
    Ok(record)
}

fn resolve_database_backup_file(app: &AppHandle, backup_id: &str) -> Result<PathBuf, String> {
    let normalized_id = backup_id.trim();
    if normalized_id.is_empty() || Path::new(normalized_id).components().count() != 1 {
        return Err("Invalid backup id".to_string());
    }

    let backups_dir = resolve_db_backups_dir(app)?;
    let backup_path = backups_dir.join(normalized_id);
    if !backup_path.exists() {
        return Err(format!("Backup file not found: {}", normalized_id));
    }

    Ok(backup_path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub current_path: String,
    pub default_path: String,
    pub is_custom: bool,
    pub db_path: String,
    pub images_path: String,
    pub backups_path: String,
    pub db_size: u64,
    pub images_size: u64,
    pub backups_size: u64,
    pub total_size: u64,
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    ensure_storage_session_write_allowed(&app)?;
    prune_database_backups(&app)?;

    let default_path = get_default_storage_path(&app)?;
    let current_path = resolve_storage_base_path(&app)?;
    let is_custom = current_path != default_path;

    let db_path = current_path.join("projects.db");
    let db_size = if db_path.exists() {
        fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let images_dir = current_path.join("images");
    let projects_media_dir = current_path.join("projects");
    let shared_media_dir = current_path.join("shared");
    let images_size = get_dir_size(&images_dir)?
        + get_dir_size(&projects_media_dir)?
        + get_dir_size(&shared_media_dir)?;
    let backups_dir = current_path.join("backups").join("db");
    let backups_size = get_dir_size(&backups_dir)?;

    let total_size = db_size + images_size + backups_size;

    Ok(StorageInfo {
        current_path: current_path.to_string_lossy().to_string(),
        default_path: default_path.to_string_lossy().to_string(),
        is_custom,
        db_path: db_path.to_string_lossy().to_string(),
        images_path: images_dir.to_string_lossy().to_string(),
        backups_path: backups_dir.to_string_lossy().to_string(),
        db_size,
        images_size,
        backups_size,
        total_size,
    })
}

#[tauri::command]
pub fn list_database_backups(app: AppHandle) -> Result<Vec<DatabaseBackupRecord>, String> {
    ensure_storage_session_write_allowed(&app)?;
    prune_database_backups(&app)?;
    list_database_backup_records(&app)
}

#[tauri::command]
pub fn create_database_backup(app: AppHandle) -> Result<DatabaseBackupRecord, String> {
    ensure_storage_session_write_allowed(&app)?;
    create_database_backup_internal(&app, MANUAL_DATABASE_BACKUP_KIND)
}

pub(crate) fn create_pre_persist_database_backup(
    app: &AppHandle,
) -> Result<DatabaseBackupRecord, String> {
    ensure_storage_session_write_allowed(app)?;
    create_database_backup_internal(app, PRE_PERSIST_DATABASE_BACKUP_KIND)
}

#[tauri::command]
pub fn ensure_daily_database_backup(
    app: AppHandle,
) -> Result<Option<DatabaseBackupRecord>, String> {
    ensure_storage_session_write_allowed(&app)?;
    prune_database_backups(&app)?;

    let source_db_path = resolve_db_path(&app)?;
    if !source_db_path.exists() {
        return Ok(None);
    }

    let source_size = fs::metadata(&source_db_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if source_size == 0 {
        return Ok(None);
    }

    let records = list_database_backup_records(&app)?;
    let latest_auto_backup = records
        .iter()
        .filter(|record| record.kind == AUTO_DATABASE_BACKUP_KIND)
        .max_by_key(|record| record.created_at);

    if let Some(latest_auto_backup) = latest_auto_backup {
        let elapsed = current_timestamp_ms().saturating_sub(latest_auto_backup.created_at);
        if elapsed < AUTO_DATABASE_BACKUP_INTERVAL_MS {
            return Ok(None);
        }
    }

    create_database_backup_internal(&app, AUTO_DATABASE_BACKUP_KIND).map(Some)
}

#[tauri::command]
pub fn restore_database_backup(
    app: AppHandle,
    backup_id: String,
) -> Result<RestoreDatabaseBackupResult, String> {
    ensure_storage_session_write_allowed(&app)?;
    let backup_path = resolve_database_backup_file(&app, &backup_id)?;
    let target_db_path = resolve_db_path(&app)?;

    let safety_backup = if target_db_path.exists() {
        let size = fs::metadata(&target_db_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if size > 0 {
            Some(create_database_backup_internal(
                &app,
                PRE_RESTORE_DATABASE_BACKUP_KIND,
            )?)
        } else {
            None
        }
    } else {
        None
    };

    restore_database_from_backup(&backup_path, &target_db_path)?;
    prune_database_backups(&app)?;

    Ok(RestoreDatabaseBackupResult {
        restored_backup_id: backup_id,
        safety_backup,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    pub phase: String,
    pub current: u64,
    pub total: u64,
    pub message: String,
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }

    fs::create_dir_all(dst).map_err(|e| format!("Failed to create destination dir: {}", e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read source dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

fn append_preserved_storage_cleanup_warning(
    warnings: &mut Vec<String>,
    requested_cleanup: bool,
    source_path: &Path,
) {
    if !requested_cleanup {
        return;
    }

    warnings.push(format!(
        "Previous storage directory was preserved at {}. The app no longer automatically removes old images/projects/shared/backups directories.",
        source_path.display()
    ));
}

#[tauri::command]
pub fn migrate_storage(
    app: AppHandle,
    new_path: String,
    delete_old: bool,
) -> Result<StorageMigrationResult, String> {
    ensure_storage_session_write_allowed(&app)?;
    let current_path = resolve_storage_base_path(&app)?;
    let target_path = PathBuf::from(&new_path);
    let normalized_target_path = normalize_storage_path_string(&target_path.to_string_lossy())
        .unwrap_or_else(|| target_path.to_string_lossy().to_string());

    ensure_non_overlapping_storage_paths(&current_path, &target_path)?;

    fs::create_dir_all(&target_path)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    let test_file = target_path.join(".write_test");
    fs::write(&test_file, "test").map_err(|e| format!("Target path is not writable: {}", e))?;
    fs::remove_file(&test_file).map_err(|e| format!("Failed to remove test file: {}", e))?;

    let db_path = current_path.join("projects.db");
    if db_path.exists() {
        let target_db = target_path.join("projects.db");
        copy_database_safely(&db_path, &target_db)?;
    }

    let images_dir = current_path.join("images");
    if images_dir.exists() {
        let target_images = target_path.join("images");
        copy_dir_recursive(&images_dir, &target_images)?;
    }

    let projects_dir = current_path.join("projects");
    if projects_dir.exists() {
        let target_projects = target_path.join("projects");
        copy_dir_recursive(&projects_dir, &target_projects)?;
    }

    let shared_dir = current_path.join("shared");
    if shared_dir.exists() {
        let target_shared = target_path.join("shared");
        copy_dir_recursive(&shared_dir, &target_shared)?;
    }

    let debug_dir = current_path.join("debug");
    if debug_dir.exists() {
        let target_debug = target_path.join("debug");
        copy_dir_recursive(&debug_dir, &target_debug)?;
    }

    let backups_dir = current_path.join("backups");
    if backups_dir.exists() {
        let target_backups = target_path.join("backups");
        copy_dir_recursive(&backups_dir, &target_backups)?;
    }

    if db_path.exists() {
        let target_db = target_path.join("projects.db");
        let mut target_conn = open_sqlite_connection(&target_db)?;
        project_state::rewrite_storage_media_paths_in_connection(
            &mut target_conn,
            &current_path,
            &target_path,
        )?;
    }

    let mut validation = validate_storage_migration(&current_path, &target_path)?;
    append_preserved_storage_cleanup_warning(&mut validation.warnings, delete_old, &current_path);

    let mut config = read_storage_config(&app)?;
    remember_legacy_storage_path(&mut config, &current_path);
    config.custom_path = Some(normalized_target_path.clone());
    let config = normalize_storage_config(config);
    write_storage_config(&app, &config)?;
    ensure_storage_asset_scope(&app)?;
    if db_path.exists() {
        let target_db = target_path.join("projects.db");
        let mut target_conn = open_sqlite_connection(&target_db)?;
        project_state::normalize_storage_media_refs_in_connection(&app, &mut target_conn)?;
    }
    ensure_storage_session_write_allowed(&app)?;

    Ok(StorageMigrationResult {
        current_path: current_path.to_string_lossy().to_string(),
        target_path: normalized_target_path,
        validation,
    })
}

#[tauri::command]
pub fn reset_storage_to_default(
    app: AppHandle,
    delete_custom: bool,
) -> Result<StorageMigrationResult, String> {
    ensure_storage_session_write_allowed(&app)?;
    let current_path = resolve_storage_base_path(&app)?;
    let default_path = get_default_storage_path(&app)?;

    if current_path == default_path {
        let validation = validate_storage_migration(&default_path, &default_path)?;
        return Ok(StorageMigrationResult {
            current_path: current_path.to_string_lossy().to_string(),
            target_path: default_path.to_string_lossy().to_string(),
            validation,
        });
    }
    ensure_non_overlapping_storage_paths(&current_path, &default_path)?;

    fs::create_dir_all(&default_path)
        .map_err(|e| format!("Failed to create default directory: {}", e))?;

    let db_path = current_path.join("projects.db");
    if db_path.exists() {
        let target_db = default_path.join("projects.db");
        copy_database_safely(&db_path, &target_db)?;
    }

    let images_dir = current_path.join("images");
    if images_dir.exists() {
        let target_images = default_path.join("images");
        copy_dir_recursive(&images_dir, &target_images)?;
    }

    let projects_dir = current_path.join("projects");
    if projects_dir.exists() {
        let target_projects = default_path.join("projects");
        copy_dir_recursive(&projects_dir, &target_projects)?;
    }

    let shared_dir = current_path.join("shared");
    if shared_dir.exists() {
        let target_shared = default_path.join("shared");
        copy_dir_recursive(&shared_dir, &target_shared)?;
    }

    let debug_dir = current_path.join("debug");
    if debug_dir.exists() {
        let target_debug = default_path.join("debug");
        copy_dir_recursive(&debug_dir, &target_debug)?;
    }

    let backups_dir = current_path.join("backups");
    if backups_dir.exists() {
        let target_backups = default_path.join("backups");
        copy_dir_recursive(&backups_dir, &target_backups)?;
    }

    if db_path.exists() {
        let target_db = default_path.join("projects.db");
        let mut target_conn = open_sqlite_connection(&target_db)?;
        project_state::rewrite_storage_media_paths_in_connection(
            &mut target_conn,
            &current_path,
            &default_path,
        )?;
    }

    let mut validation = validate_storage_migration(&current_path, &default_path)?;
    append_preserved_storage_cleanup_warning(
        &mut validation.warnings,
        delete_custom,
        &current_path,
    );

    let mut config = read_storage_config(&app)?;
    remember_legacy_storage_path(&mut config, &current_path);
    config.custom_path = None;
    let config = normalize_storage_config(config);
    write_storage_config(&app, &config)?;
    ensure_storage_asset_scope(&app)?;
    if db_path.exists() {
        let target_db = default_path.join("projects.db");
        let mut target_conn = open_sqlite_connection(&target_db)?;
        project_state::normalize_storage_media_refs_in_connection(&app, &mut target_conn)?;
    }
    ensure_storage_session_write_allowed(&app)?;

    Ok(StorageMigrationResult {
        current_path: current_path.to_string_lossy().to_string(),
        target_path: default_path.to_string_lossy().to_string(),
        validation,
    })
}

pub fn normalize_storage_media_refs_in_connection(
    app: &AppHandle,
    conn: &mut Connection,
) -> Result<StorageMediaMigrationStats, String> {
    project_state::normalize_storage_media_refs_in_connection(app, conn)
}

pub fn rebuild_media_ref_indexes(app: &AppHandle, conn: &mut Connection) -> Result<(), String> {
    project_state::rebuild_media_ref_indexes(app, conn)
}

#[tauri::command]
pub fn adopt_existing_storage_path(
    app: AppHandle,
    new_path: String,
) -> Result<StorageAdoptionResult, String> {
    ensure_storage_session_write_allowed(&app)?;
    let previous_path = resolve_storage_base_path(&app)?;
    let target_path = PathBuf::from(&new_path);
    let normalized_target_path = normalize_storage_path_string(&target_path.to_string_lossy())
        .unwrap_or_else(|| target_path.to_string_lossy().to_string());
    let target_db_path = target_path.join("projects.db");

    if !target_path.is_dir() {
        return Err(format!(
            "The selected storage directory does not exist: {}",
            target_path.display()
        ));
    }
    if !target_db_path.is_file() {
        return Err(format!(
            "The selected storage directory does not contain projects.db: {}",
            target_db_path.display()
        ));
    }

    let safety_backup = if previous_path.join("projects.db").exists() {
        Some(create_database_backup_internal(
            &app,
            PRE_RESTORE_DATABASE_BACKUP_KIND,
        )?)
    } else {
        None
    };

    let mut config = read_storage_config(&app)?;
    remember_legacy_storage_path(&mut config, &previous_path);
    config.custom_path = Some(normalized_target_path.clone());
    let config = normalize_storage_config(config);
    write_storage_config(&app, &config)?;
    ensure_storage_asset_scope(&app)?;

    let mut target_conn = open_sqlite_connection(&target_db_path)?;
    project_state::normalize_storage_media_refs_in_connection(&app, &mut target_conn)?;
    ensure_storage_session_write_allowed(&app)?;

    Ok(StorageAdoptionResult {
        previous_path: previous_path.to_string_lossy().to_string(),
        adopted_path: normalized_target_path,
        safety_backup,
    })
}

#[tauri::command]
pub fn open_storage_folder(app: AppHandle) -> Result<(), String> {
    let storage_path = resolve_storage_base_path(&app)?;

    fs::create_dir_all(&storage_path)
        .map_err(|e| format!("Failed to create storage directory: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&storage_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&storage_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&storage_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        count_projects_in_db, decode_storage_media_ref_in_base, encode_storage_media_ref_in_base,
        persist_media_bytes_in_base, read_storage_session_record_at_path,
        rebase_storage_path_string, relocate_storage_path_to_known_images_dirs,
        resolve_media_dir_in_base, validate_storage_migration, write_text_file_atomically,
        MediaPersistContext, STORAGE_SESSION_FILE,
    };
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

    fn normalize_path_for_assertion(path: &std::path::Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn storage_media_ref_encodes_internal_paths_as_uri() {
        let root = std::env::temp_dir().join(format!(
            "storyboard-storage-uri-encode-{}",
            std::process::id()
        ));
        let source = root
            .join("projects")
            .join("project-1")
            .join("images")
            .join("frame 01.png");

        let encoded = encode_storage_media_ref_in_base(&root, &source.to_string_lossy());

        assert_eq!(
            encoded,
            "sb://storage/projects/project-1/images/frame%2001.png"
        );
    }

    #[test]
    fn storage_media_ref_decodes_uri_against_current_root() {
        let root = std::env::temp_dir().join(format!(
            "storyboard-storage-uri-decode-{}",
            std::process::id()
        ));

        let decoded = decode_storage_media_ref_in_base(
            &root,
            "sb://storage/projects/project-1/images/frame%2001.png",
        );

        assert_eq!(
            decoded,
            root.join("projects")
                .join("project-1")
                .join("images")
                .join("frame 01.png")
                .to_string_lossy()
                .to_string()
        );
    }

    #[test]
    fn storage_media_ref_keeps_external_and_remote_values_unchanged() {
        let root = std::env::temp_dir().join("storyboard-storage-uri-external");
        let external = std::env::temp_dir()
            .join("outside-library")
            .join("asset.png")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            encode_storage_media_ref_in_base(&root, "https://example.com/a.png"),
            "https://example.com/a.png"
        );
        assert_eq!(
            encode_storage_media_ref_in_base(&root, "data:image/png;base64,abc"),
            "data:image/png;base64,abc"
        );
        assert_eq!(encode_storage_media_ref_in_base(&root, &external), external);
    }

    #[test]
    fn storage_media_ref_rejects_unsafe_uri_segments() {
        let root = std::env::temp_dir().join("storyboard-storage-uri-unsafe");
        for value in [
            "sb://storage/",
            "sb://storage/../escape.png",
            "sb://storage/projects//escape.png",
            "sb://storage/C%3A/escape.png",
            "sb://storage/projects/%2E%2E/escape.png",
            "sb://storage/projects/%5Cescape.png",
        ] {
            assert_eq!(decode_storage_media_ref_in_base(&root, value), value);
        }
    }

    #[test]
    fn rebase_storage_path_string_moves_paths_between_storage_roots() {
        let from_base = PathBuf::from(r"C:\Users\Tester\AppData\Roaming\com.storyboard.copilot");
        let to_base = PathBuf::from(r"D:\StoryboardData");
        let source = r"C:\Users\Tester\AppData\Roaming\com.storyboard.copilot\images\abc123.png";

        let rebased =
            rebase_storage_path_string(source, &from_base, &to_base).expect("path should rebase");

        assert_eq!(rebased, "D:/StoryboardData/images/abc123.png");
    }

    #[test]
    fn resolve_media_dir_in_base_uses_project_and_media_type() {
        let root = PathBuf::from(r"D:\StoryboardData");
        let context = MediaPersistContext {
            project_id: Some("project-1".to_string()),
            media_type: Some("video".to_string()),
            role: None,
        };

        let path = resolve_media_dir_in_base(&root, Some(&context), "mp4", "original");

        assert_eq!(
            normalize_path_for_assertion(&path),
            "D:/StoryboardData/projects/project-1/videos"
        );
    }

    #[test]
    fn resolve_media_dir_in_base_uses_shared_image_roles_without_project() {
        let root = PathBuf::from(r"D:\StoryboardData");
        let context = MediaPersistContext {
            project_id: None,
            media_type: Some("image".to_string()),
            role: Some("preview".to_string()),
        };

        let path = resolve_media_dir_in_base(&root, Some(&context), "png", "original");

        assert_eq!(
            normalize_path_for_assertion(&path),
            "D:/StoryboardData/shared/images/previews"
        );
    }

    #[test]
    fn resolve_media_dir_in_base_uses_default_role_when_context_role_is_absent() {
        let root = PathBuf::from(r"D:\StoryboardData");
        let context = MediaPersistContext {
            project_id: Some("project-1".to_string()),
            media_type: Some("image".to_string()),
            role: None,
        };

        let path = resolve_media_dir_in_base(&root, Some(&context), "png", "preview");

        assert_eq!(
            normalize_path_for_assertion(&path),
            "D:/StoryboardData/projects/project-1/images/previews"
        );
    }

    #[test]
    fn persist_media_bytes_in_base_dedupes_by_content_in_directory() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-media-persist-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).expect("failed to create temp root");
        let context = MediaPersistContext {
            project_id: Some("project-1".to_string()),
            media_type: Some("audio".to_string()),
            role: None,
        };

        let first = persist_media_bytes_in_base(
            &temp_root,
            b"same-audio",
            "mp3",
            Some(&context),
            "original",
        )
        .expect("first persist should succeed");
        let second = persist_media_bytes_in_base(
            &temp_root,
            b"same-audio",
            "mp3",
            Some(&context),
            "original",
        )
        .expect("second persist should dedupe");

        assert_eq!(first, second);
        assert!(normalize_path_for_assertion(&PathBuf::from(first))
            .contains("/projects/project-1/audio/"));

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn relocate_storage_path_to_images_dir_recovers_missing_legacy_image_paths() {
        let temp_root =
            std::env::temp_dir().join(format!("storyboard-storage-test-{}", std::process::id()));
        let images_dir = temp_root.join("images");
        fs::create_dir_all(&images_dir).expect("failed to create images dir");
        let candidate_path = images_dir.join("missing.png");
        fs::write(&candidate_path, b"ok").expect("failed to seed image");

        let relocated = relocate_storage_path_to_known_images_dirs(
            r"C:\LegacyStorage\images\missing.png",
            &[images_dir],
        )
        .expect("legacy image path should relocate");

        assert_eq!(
            relocated,
            candidate_path.to_string_lossy().replace('\\', "/")
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn relocate_storage_path_to_known_images_dirs_checks_multiple_storage_roots() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-known-images-test-{}",
            std::process::id()
        ));
        let current_images_dir = temp_root.join("current").join("images");
        let legacy_images_dir = temp_root.join("legacy").join("images");
        fs::create_dir_all(&current_images_dir).expect("failed to create current images dir");
        fs::create_dir_all(&legacy_images_dir).expect("failed to create legacy images dir");

        let legacy_file = legacy_images_dir.join("recoverable.png");
        fs::write(&legacy_file, b"ok").expect("failed to seed legacy image");

        let relocated = relocate_storage_path_to_known_images_dirs(
            r"G:\AI画布\缓存\images\recoverable.png",
            &[current_images_dir, legacy_images_dir],
        )
        .expect("legacy image path should relocate from known dirs");

        assert_eq!(relocated, legacy_file.to_string_lossy().replace('\\', "/"));

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn count_projects_in_db_returns_zero_when_projects_table_is_missing() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-db-count-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).expect("failed to create temp root");
        let db_path = temp_root.join("projects.db");
        let _conn = Connection::open(&db_path).expect("failed to create sqlite db");

        let count = count_projects_in_db(&db_path).expect("count should succeed");
        assert_eq!(count, 0);

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn validate_storage_migration_rejects_project_count_shrink() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-validate-{}",
            std::process::id()
        ));
        let source_root = temp_root.join("source");
        let target_root = temp_root.join("target");
        fs::create_dir_all(&source_root).expect("failed to create source root");
        fs::create_dir_all(&target_root).expect("failed to create target root");

        let source_db = source_root.join("projects.db");
        let target_db = target_root.join("projects.db");
        let source_conn = Connection::open(&source_db).expect("failed to open source db");
        let target_conn = Connection::open(&target_db).expect("failed to open target db");
        source_conn
            .execute_batch(
                r#"
                CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                INSERT INTO projects (id, name) VALUES ('p1', 'One'), ('p2', 'Two');
                "#,
            )
            .expect("failed to seed source db");
        target_conn
            .execute_batch(
                r#"
                CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                INSERT INTO projects (id, name) VALUES ('p1', 'One');
                "#,
            )
            .expect("failed to seed target db");

        let result = validate_storage_migration(&source_root, &target_root);
        assert!(
            result.is_err(),
            "migration validation should fail when target loses projects"
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn read_storage_session_record_at_path_quarantines_invalid_json() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-session-invalid-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).expect("failed to create temp root");

        let session_path = temp_root.join(STORAGE_SESSION_FILE);
        fs::write(&session_path, "not-json").expect("failed to seed invalid storage session");

        let session = read_storage_session_record_at_path(&temp_root)
            .expect("invalid storage session should be ignored");
        assert!(
            session.is_none(),
            "invalid storage session should be ignored"
        );
        assert!(
            !session_path.exists(),
            "invalid storage session should be moved aside"
        );

        let backup_paths = fs::read_dir(&temp_root)
            .expect("failed to list temp root")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| {
                        value.starts_with("storage-session.json.corrupt-")
                            && value.ends_with(".bak")
                    })
            })
            .collect::<Vec<_>>();

        assert_eq!(
            backup_paths.len(),
            1,
            "expected one quarantined session backup"
        );
        assert_eq!(
            fs::read_to_string(&backup_paths[0]).expect("failed to read quarantined backup"),
            "not-json"
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn write_text_file_atomically_replaces_existing_content() {
        let temp_root = std::env::temp_dir().join(format!(
            "storyboard-storage-session-write-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).expect("failed to create temp root");

        let session_path = temp_root.join(STORAGE_SESSION_FILE);
        fs::write(&session_path, "stale").expect("failed to seed stale session file");

        write_text_file_atomically(&session_path, "{\"ok\":true}", "storage session")
            .expect("atomic write should succeed");

        assert_eq!(
            fs::read_to_string(&session_path).expect("failed to read storage session"),
            "{\"ok\":true}"
        );

        let _ = fs::remove_dir_all(temp_root);
    }
}
