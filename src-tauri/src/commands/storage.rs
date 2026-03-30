use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub custom_path: Option<String>,
}

const STORAGE_CONFIG_FILE: &str = "storage_config.json";
const AUTO_DATABASE_BACKUP_KIND: &str = "auto";
const MANUAL_DATABASE_BACKUP_KIND: &str = "manual";
const PRE_RESTORE_DATABASE_BACKUP_KIND: &str = "pre_restore";
const AUTO_DATABASE_BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_AUTO_DATABASE_BACKUPS: usize = 7;
const MAX_MANUAL_DATABASE_BACKUPS: usize = 20;
const MAX_PRE_RESTORE_DATABASE_BACKUPS: usize = 5;

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

    if !config_path.exists() {
        return Ok(StorageConfig::default());
    }

    let mut file = fs::File::open(&config_path)
        .map_err(|e| format!("Failed to open storage config: {}", e))?;

    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read storage config: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse storage config: {}", e))
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

    let config = StorageConfig {
        custom_path: Some(new_path.clone()),
    };
    write_storage_config(&app, &config)?;

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

    Ok(new_path)
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

    let config = StorageConfig::default();
    write_storage_config(&app, &config)?;

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
