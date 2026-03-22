use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub custom_path: Option<String>,
}

const STORAGE_CONFIG_FILE: &str = "storage_config.json";

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

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse storage config: {}", e))
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
    fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images dir: {}", e))?;
    Ok(images_dir)
}

pub fn resolve_debug_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = resolve_storage_base_path(app)?;
    let debug_dir = base_path.join("debug");
    fs::create_dir_all(&debug_dir)
        .map_err(|e| format!("Failed to create debug dir: {}", e))?;
    Ok(debug_dir)
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
pub struct StorageInfo {
    pub current_path: String,
    pub default_path: String,
    pub is_custom: bool,
    pub db_size: u64,
    pub images_size: u64,
    pub total_size: u64,
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let default_path = get_default_storage_path(&app)?;
    let current_path = resolve_storage_base_path(&app)?;
    let is_custom = current_path != default_path;

    let db_path = current_path.join("projects.db");
    let db_size = if db_path.exists() {
        fs::metadata(&db_path)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    let images_dir = current_path.join("images");
    let images_size = get_dir_size(&images_dir)?;

    let total_size = db_size + images_size;

    Ok(StorageInfo {
        current_path: current_path.to_string_lossy().to_string(),
        default_path: default_path.to_string_lossy().to_string(),
        is_custom,
        db_size,
        images_size,
        total_size,
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

    fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read source dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

fn delete_dir_recursive(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(path)
        .map_err(|e| format!("Failed to delete directory: {}", e))?;

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
    fs::write(&test_file, "test")
        .map_err(|e| format!("Target path is not writable: {}", e))?;
    fs::remove_file(&test_file)
        .map_err(|e| format!("Failed to remove test file: {}", e))?;

    let db_path = current_path.join("projects.db");
    if db_path.exists() {
        let target_db = target_path.join("projects.db");
        fs::copy(&db_path, &target_db)
            .map_err(|e| format!("Failed to copy database: {}", e))?;
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

    let config = StorageConfig {
        custom_path: Some(new_path.clone()),
    };
    write_storage_config(&app, &config)?;

    if delete_old {
        if db_path.exists() {
            fs::remove_file(&db_path)
                .map_err(|e| format!("Failed to delete old database: {}", e))?;
        }
        if images_dir.exists() {
            delete_dir_recursive(&images_dir)?;
        }
        if debug_dir.exists() {
            delete_dir_recursive(&debug_dir)?;
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
        fs::copy(&db_path, &target_db)
            .map_err(|e| format!("Failed to copy database: {}", e))?;
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

    let config = StorageConfig::default();
    write_storage_config(&app, &config)?;

    if delete_custom {
        if db_path.exists() {
            fs::remove_file(&db_path)
                .map_err(|e| format!("Failed to delete custom database: {}", e))?;
        }
        if images_dir.exists() {
            delete_dir_recursive(&images_dir)?;
        }
        if debug_dir.exists() {
            delete_dir_recursive(&debug_dir)?;
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
