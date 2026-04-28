use std::collections::HashSet;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tracing::info;

use super::project_state;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub custom_path: Option<String>,
    #[serde(default)]
    pub legacy_paths: Vec<String>,
}

const STORAGE_CONFIG_FILE: &str = "storage_config.json";
const AUTO_DATABASE_BACKUP_KIND: &str = "auto";
const MANUAL_DATABASE_BACKUP_KIND: &str = "manual";
const PRE_RESTORE_DATABASE_BACKUP_KIND: &str = "pre_restore";
const AUTO_DATABASE_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_AUTO_DATABASE_BACKUPS: usize = 7;
const MAX_MANUAL_DATABASE_BACKUPS: usize = 20;
const MAX_PRE_RESTORE_DATABASE_BACKUPS: usize = 5;
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

pub(crate) fn resolve_known_images_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    let current_images_dir = resolve_images_dir(app)?;
    let current_compare_key =
        storage_path_compare_key(&current_images_dir.to_string_lossy().replace('\\', "/"));
    seen.insert(current_compare_key);
    results.push(current_images_dir);

    let default_images_dir = get_default_storage_path(app)?.join("images");
    let default_compare_key =
        storage_path_compare_key(&default_images_dir.to_string_lossy().replace('\\', "/"));
    if seen.insert(default_compare_key) {
        results.push(default_images_dir);
    }

    let config = read_storage_config(app)?;
    for legacy_path in config.legacy_paths {
        let images_dir = PathBuf::from(legacy_path).join("images");
        let compare_key =
            storage_path_compare_key(&images_dir.to_string_lossy().replace('\\', "/"));
        if seen.insert(compare_key) {
            results.push(images_dir);
        }
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

pub(crate) fn relocate_storage_path_to_known_images_dirs(
    value: &str,
    images_dirs: &[PathBuf],
) -> Option<String> {
    let normalized_value = normalize_storage_path_string(value)?;
    let current_path = PathBuf::from(&normalized_value);
    if current_path.exists() {
        return None;
    }

    let parent_name = current_path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())?;
    if !parent_name.eq_ignore_ascii_case("images") {
        return None;
    }

    let file_name = current_path.file_name()?.to_str()?;
    let normalized_value_compare_key = storage_path_compare_key(&normalized_value);

    for images_dir in images_dirs {
        let candidate_path = images_dir.join(file_name);
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

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove file {}: {}",
            path.display(),
            error
        )),
    }
}

fn remove_db_sidecar_files(db_path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let sidecar_path = PathBuf::from(format!("{}{}", db_path.to_string_lossy(), suffix));
        remove_file_if_exists(&sidecar_path)?;
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

    remove_file_if_exists(target_db_path)?;
    remove_db_sidecar_files(target_db_path)?;

    let source_conn = open_sqlite_connection(source_db_path)?;
    source_conn
        .backup(
            DatabaseName::Main,
            target_db_path,
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|e| format!("Failed to back up database: {}", e))?;

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

fn resolve_backup_kind(file_name: &str) -> Option<&'static str> {
    let (prefix, _) = file_name.split_once("__")?;
    match prefix {
        AUTO_DATABASE_BACKUP_KIND => Some(AUTO_DATABASE_BACKUP_KIND),
        MANUAL_DATABASE_BACKUP_KIND => Some(MANUAL_DATABASE_BACKUP_KIND),
        PRE_RESTORE_DATABASE_BACKUP_KIND => Some(PRE_RESTORE_DATABASE_BACKUP_KIND),
        _ => None,
    }
}

fn list_database_backup_records(app: &AppHandle) -> Result<Vec<DatabaseBackupRecord>, String> {
    let backups_dir = resolve_db_backups_dir(app)?;
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

fn prune_database_backups_by_kind(
    records: &[DatabaseBackupRecord],
    kind: &str,
    keep: usize,
) -> Result<(), String> {
    for record in records
        .iter()
        .filter(|record| record.kind == kind)
        .skip(keep)
    {
        remove_file_if_exists(Path::new(&record.path))?;
    }

    Ok(())
}

fn prune_database_backups(app: &AppHandle) -> Result<(), String> {
    let records = list_database_backup_records(app)?;
    prune_database_backups_by_kind(
        &records,
        AUTO_DATABASE_BACKUP_KIND,
        MAX_AUTO_DATABASE_BACKUPS,
    )?;
    prune_database_backups_by_kind(
        &records,
        PRE_RESTORE_DATABASE_BACKUP_KIND,
        MAX_PRE_RESTORE_DATABASE_BACKUPS,
    )?;
    prune_database_backups_by_kind(
        &records,
        MANUAL_DATABASE_BACKUP_KIND,
        MAX_MANUAL_DATABASE_BACKUPS,
    )?;
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
        let _ = remove_file_if_exists(&backup_path);
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
    let images_size = get_dir_size(&images_dir)?;
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
    list_database_backup_records(&app)
}

#[tauri::command]
pub fn create_database_backup(app: AppHandle) -> Result<DatabaseBackupRecord, String> {
    create_database_backup_internal(&app, MANUAL_DATABASE_BACKUP_KIND)
}

#[tauri::command]
pub fn ensure_daily_database_backup(
    app: AppHandle,
) -> Result<Option<DatabaseBackupRecord>, String> {
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

fn delete_dir_recursive(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(path).map_err(|e| format!("Failed to delete directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn migrate_storage(
    app: AppHandle,
    new_path: String,
    delete_old: bool,
) -> Result<String, String> {
    let current_path = resolve_storage_base_path(&app)?;
    let target_path = PathBuf::from(&new_path);
    let normalized_target_path = normalize_storage_path_string(&target_path.to_string_lossy())
        .unwrap_or_else(|| target_path.to_string_lossy().to_string());

    if current_path == target_path {
        return Err("Target path is the same as current path".to_string());
    }

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

    let mut config = read_storage_config(&app)?;
    remember_legacy_storage_path(&mut config, &current_path);
    config.custom_path = Some(normalized_target_path.clone());
    let config = normalize_storage_config(config);
    write_storage_config(&app, &config)?;
    ensure_storage_asset_scope(&app)?;

    if delete_old {
        if db_path.exists() {
            fs::remove_file(&db_path)
                .map_err(|e| format!("Failed to delete old database: {}", e))?;
        }
        remove_db_sidecar_files(&db_path)?;
        if images_dir.exists() {
            delete_dir_recursive(&images_dir)?;
        }
        if debug_dir.exists() {
            delete_dir_recursive(&debug_dir)?;
        }
        if backups_dir.exists() {
            delete_dir_recursive(&backups_dir)?;
        }
    }

    Ok(normalized_target_path)
}

#[tauri::command]
pub fn reset_storage_to_default(app: AppHandle, delete_custom: bool) -> Result<String, String> {
    let current_path = resolve_storage_base_path(&app)?;
    let default_path = get_default_storage_path(&app)?;

    if current_path == default_path {
        return Ok(default_path.to_string_lossy().to_string());
    }

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

    let mut config = read_storage_config(&app)?;
    remember_legacy_storage_path(&mut config, &current_path);
    config.custom_path = None;
    let config = normalize_storage_config(config);
    write_storage_config(&app, &config)?;
    ensure_storage_asset_scope(&app)?;

    if delete_custom {
        if db_path.exists() {
            fs::remove_file(&db_path)
                .map_err(|e| format!("Failed to delete custom database: {}", e))?;
        }
        remove_db_sidecar_files(&db_path)?;
        if images_dir.exists() {
            delete_dir_recursive(&images_dir)?;
        }
        if debug_dir.exists() {
            delete_dir_recursive(&debug_dir)?;
        }
        if backups_dir.exists() {
            delete_dir_recursive(&backups_dir)?;
        }
    }

    Ok(default_path.to_string_lossy().to_string())
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
    use super::{rebase_storage_path_string, relocate_storage_path_to_known_images_dirs};
    use std::fs;
    use std::path::PathBuf;

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
}
