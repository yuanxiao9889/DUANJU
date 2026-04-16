use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tracing::info;
use uuid::Uuid;

use super::storage;

const SCRIPT_PROJECT_PACKAGE_SCHEMA: &str = "storyboard-copilot/script-project-package";
const SCRIPT_PROJECT_PACKAGE_VERSION: u32 = 2;
const PACKAGE_ASSET_REF_PREFIX: &str = "__scpkg_asset__:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptProjectPackageAssetEntry {
    pub id: String,
    pub archive_path: String,
    pub original_file_name: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptProjectPackageManifest {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    pub app_version: Option<String>,
    pub project_type: String,
    pub project_id: Option<String>,
    pub project_name: String,
    pub title: String,
    pub asset_count: usize,
    pub node_count: usize,
    pub edge_count: usize,
    pub assets: Vec<ScriptProjectPackageAssetEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptProjectPackageAssetBlob {
    pub id: String,
    pub file_name: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptProjectPackageFile {
    pub manifest: ScriptProjectPackageManifest,
    pub project: Value,
    pub asset_blobs: Vec<ScriptProjectPackageAssetBlob>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportScriptProjectPackageAssetInput {
    pub id: String,
    pub source_path: String,
    pub match_values: Vec<String>,
    pub archive_file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportScriptProjectPackageInfoInput {
    pub project_id: Option<String>,
    pub project_name: String,
    pub title: String,
    pub project_type: String,
    pub exported_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportScriptProjectPackagePayload {
    pub target_path: String,
    pub info: ExportScriptProjectPackageInfoInput,
    pub project: Value,
    pub assets: Vec<ExportScriptProjectPackageAssetInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptProjectPackagePreviewResult {
    pub package_path: String,
    pub source_name: String,
    pub manifest: ScriptProjectPackageManifest,
    pub project: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedScriptProjectPackageResult {
    pub package_path: String,
    pub manifest: ScriptProjectPackageManifest,
    pub project: Value,
}

fn sanitize_file_component(raw: &str) -> String {
    let mut sanitized = raw
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>();
    sanitized = sanitized.trim_matches('.').trim().to_string();
    if sanitized.is_empty() {
        "asset".to_string()
    } else {
        sanitized
    }
}

fn build_archive_file_name(input: &ExportScriptProjectPackageAssetInput) -> String {
    let candidate_name = input
        .archive_file_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(sanitize_file_component)
        .unwrap_or_else(|| {
            Path::new(&input.source_path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(sanitize_file_component)
                .unwrap_or_else(|| "asset.bin".to_string())
        });
    format!(
        "assets/{}/{}",
        sanitize_file_component(&input.id),
        candidate_name
    )
}

fn get_fallback_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_file_component)
        .unwrap_or_else(|| "asset.bin".to_string())
}

fn replace_string_values(value: &mut Value, replacements: &HashMap<String, String>) {
    match value {
        Value::String(current) => {
            if let Some(replacement) = replacements.get(current) {
                *current = replacement.clone();
            }
        }
        Value::Array(items) => {
            for item in items {
                replace_string_values(item, replacements);
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                replace_string_values(item, replacements);
            }
        }
        _ => {}
    }
}

fn resolve_project_array_len(project: &Value, key: &str) -> usize {
    project
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create output directory: {}", err))?;
    }
    Ok(())
}

fn read_package_file(path: &str) -> Result<ScriptProjectPackageFile, String> {
    let content = fs::read_to_string(path)
        .map_err(|err| format!("Failed to read project package file: {}", err))?;
    let package: ScriptProjectPackageFile = serde_json::from_str(&content)
        .map_err(|err| format!("Failed to parse project package file: {}", err))?;

    if package.manifest.schema != SCRIPT_PROJECT_PACKAGE_SCHEMA {
        return Err(format!(
            "Unsupported project package schema: {}",
            package.manifest.schema
        ));
    }

    if package.manifest.version != SCRIPT_PROJECT_PACKAGE_VERSION {
        return Err(format!(
            "Unsupported project package version: {}",
            package.manifest.version
        ));
    }

    Ok(package)
}

fn derive_source_name(package_path: &str) -> String {
    Path::new(package_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(package_path)
        .to_string()
}

fn build_import_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base_path = storage::resolve_storage_base_path(app)?;
    let import_root = base_path
        .join("script-project-packages")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&import_root)
        .map_err(|err| format!("Failed to create package import directory: {}", err))?;
    Ok(import_root)
}

#[tauri::command]
pub async fn export_script_project_package(
    payload: ExportScriptProjectPackagePayload,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let target_path = PathBuf::from(payload.target_path.trim());
    if payload.target_path.trim().is_empty() {
        return Err("Project package output path is required.".to_string());
    }

    ensure_parent_dir(&target_path)?;

    let mut packaged_project = payload.project.clone();
    let mut replacements = HashMap::new();
    let mut manifest_assets = Vec::new();
    let mut asset_blobs = Vec::new();

    for asset in &payload.assets {
        if asset.id.trim().is_empty() {
            return Err("Encountered an asset with an empty id while exporting package.".to_string());
        }

        let source_path = PathBuf::from(asset.source_path.trim());
        if asset.source_path.trim().is_empty() || !source_path.exists() {
            return Err(format!(
                "Failed to export package because a local asset is missing: {}",
                asset.source_path
            ));
        }

        let bytes = fs::read(&source_path).map_err(|err| {
            format!(
                "Failed to read packaged asset {}: {}",
                source_path.display(),
                err
            )
        })?;
        let original_file_name = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or_else(|| "asset.bin".to_string());

        for match_value in &asset.match_values {
            if !match_value.trim().is_empty() {
                replacements.insert(
                    match_value.clone(),
                    format!("{}{}", PACKAGE_ASSET_REF_PREFIX, asset.id),
                );
            }
        }

        manifest_assets.push(ScriptProjectPackageAssetEntry {
            id: asset.id.clone(),
            archive_path: build_archive_file_name(asset),
            original_file_name,
            byte_size: bytes.len() as u64,
        });
        asset_blobs.push(ScriptProjectPackageAssetBlob {
            id: asset.id.clone(),
            file_name: asset
                .archive_file_name
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| get_fallback_file_name(&source_path)),
            data_base64: STANDARD.encode(bytes),
        });
    }

    replace_string_values(&mut packaged_project, &replacements);

    let node_count = resolve_project_array_len(&packaged_project, "nodes");
    let edge_count = resolve_project_array_len(&packaged_project, "edges");
    let manifest = ScriptProjectPackageManifest {
        schema: SCRIPT_PROJECT_PACKAGE_SCHEMA.to_string(),
        version: SCRIPT_PROJECT_PACKAGE_VERSION,
        exported_at: payload.info.exported_at,
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        project_type: payload.info.project_type,
        project_id: payload.info.project_id,
        project_name: payload.info.project_name,
        title: payload.info.title,
        asset_count: manifest_assets.len(),
        node_count,
        edge_count,
        assets: manifest_assets,
    };
    let package_file = ScriptProjectPackageFile {
        manifest: manifest.clone(),
        project: packaged_project,
        asset_blobs,
    };
    let mut output = File::create(&target_path)
        .map_err(|err| format!("Failed to create project package file: {}", err))?;
    let serialized = serde_json::to_vec_pretty(&package_file)
        .map_err(|err| format!("Failed to serialize project package file: {}", err))?;
    output
        .write_all(&serialized)
        .map_err(|err| format!("Failed to write project package file: {}", err))?;

    info!(
        "export_script_project_package done: nodes={}, edges={}, assets={}, elapsed={}ms",
        node_count,
        edge_count,
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(())
}

#[tauri::command]
pub async fn preview_script_project_package(
    package_path: String,
) -> Result<ScriptProjectPackagePreviewResult, String> {
    if package_path.trim().is_empty() {
        return Err("Project package path is required.".to_string());
    }

    let package_file = read_package_file(package_path.trim())?;

    Ok(ScriptProjectPackagePreviewResult {
        package_path: package_path.trim().to_string(),
        source_name: derive_source_name(package_path.trim()),
        manifest: package_file.manifest,
        project: package_file.project,
    })
}

#[tauri::command]
pub async fn import_script_project_package(
    app: AppHandle,
    package_path: String,
) -> Result<ImportedScriptProjectPackageResult, String> {
    let started = std::time::Instant::now();
    if package_path.trim().is_empty() {
        return Err("Project package path is required.".to_string());
    }

    let package_file = read_package_file(package_path.trim())?;
    let manifest = package_file.manifest.clone();
    let mut project = package_file.project;
    let import_root = build_import_root(&app)?;
    let asset_root = import_root.join("assets");
    fs::create_dir_all(&asset_root)
        .map_err(|err| format!("Failed to create imported asset directory: {}", err))?;

    let mut replacements = HashMap::new();

    for asset in &package_file.asset_blobs {
        let matching_manifest_entry = manifest
            .assets
            .iter()
            .find(|entry| entry.id == asset.id)
            .ok_or_else(|| format!("Manifest entry missing for packaged asset {}", asset.id))?;
        let output_file_name = format!(
            "{}-{}",
            sanitize_file_component(&matching_manifest_entry.id),
            sanitize_file_component(&matching_manifest_entry.original_file_name)
        );
        let output_path = asset_root.join(output_file_name);
        let bytes = STANDARD
            .decode(&asset.data_base64)
            .map_err(|err| format!("Failed to decode packaged asset {}: {}", asset.id, err))?;
        fs::write(&output_path, &bytes)
            .map_err(|err| format!("Failed to write imported asset {}: {}", output_path.display(), err))?;

        replacements.insert(
            format!("{}{}", PACKAGE_ASSET_REF_PREFIX, matching_manifest_entry.id),
            output_path.to_string_lossy().to_string(),
        );
    }

    replace_string_values(&mut project, &replacements);

    info!(
        "import_script_project_package done: assets={}, elapsed={}ms",
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(ImportedScriptProjectPackageResult {
        package_path: package_path.trim().to_string(),
        manifest,
        project,
    })
}
