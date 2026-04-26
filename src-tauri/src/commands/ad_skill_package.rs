use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tracing::info;

const AD_DIRECTOR_SKILL_PACKAGE_SCHEMA: &str = "storyboard-copilot/ad-director-skill-package";
const AD_DIRECTOR_SKILL_PACKAGE_KIND: &str = "ad-director-skill";
const AD_DIRECTOR_SKILL_PACKAGE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorSkillProfileRecord {
    pub identity: String,
    pub style_keywords: Vec<String>,
    pub rhythm_preference: String,
    pub visual_preference: String,
    pub narrative_principles: Vec<String>,
    pub taboos: Vec<String>,
    pub brand_platform_preferences: Vec<String>,
    pub profile_summary: String,
    pub prompt_snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdDirectorSkillCategoryRecord {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdDirectorSkillTemplateRecord {
    pub id: String,
    pub name: String,
    pub category_id: Option<String>,
    pub profile: DirectorSkillProfileRecord,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdDirectorSkillPackageManifest {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    pub app_version: Option<String>,
    pub package_kind: String,
    pub category_count: usize,
    pub template_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdDirectorSkillPackageData {
    pub categories: Vec<AdDirectorSkillCategoryRecord>,
    pub templates: Vec<AdDirectorSkillTemplateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdDirectorSkillPackageFile {
    pub manifest: AdDirectorSkillPackageManifest,
    pub data: AdDirectorSkillPackageData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAdDirectorSkillPackagePayload {
    pub target_path: String,
    pub data: AdDirectorSkillPackageData,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAdDirectorSkillPackageResult {
    pub package_path: String,
    pub manifest: AdDirectorSkillPackageManifest,
    pub data: AdDirectorSkillPackageData,
}

fn ensure_parent_dir(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create output directory: {}", err))?;
    }
    Ok(())
}

fn build_exported_at() -> Result<String, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Failed to resolve current time: {}", err))?;
    Ok(duration.as_millis().to_string())
}

fn read_package_value(path: &str) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|err| format!("Failed to read ad director skill package file: {}", err))?;
    serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("Failed to parse ad director skill package file: {}", err))
}

fn parse_manifest(value: &Value) -> Result<AdDirectorSkillPackageManifest, String> {
    let manifest_value = value
        .get("manifest")
        .cloned()
        .ok_or_else(|| "Ad director skill package manifest is missing.".to_string())?;
    serde_json::from_value::<AdDirectorSkillPackageManifest>(manifest_value).map_err(|err| {
        format!(
            "Failed to decode ad director skill package manifest: {}",
            err
        )
    })
}

fn validate_manifest(manifest: &AdDirectorSkillPackageManifest) -> Result<(), String> {
    if manifest.schema != AD_DIRECTOR_SKILL_PACKAGE_SCHEMA {
        return Err("Invalid ad director skill package schema.".to_string());
    }

    if manifest.version != AD_DIRECTOR_SKILL_PACKAGE_VERSION {
        return Err("Unsupported ad director skill package version.".to_string());
    }

    if manifest.package_kind != AD_DIRECTOR_SKILL_PACKAGE_KIND {
        return Err("Invalid ad director skill package kind.".to_string());
    }

    Ok(())
}

fn read_ad_director_skill_package(path: &str) -> Result<AdDirectorSkillPackageFile, String> {
    let value = read_package_value(path)?;
    let manifest = parse_manifest(&value)?;
    validate_manifest(&manifest)?;
    serde_json::from_value::<AdDirectorSkillPackageFile>(value)
        .map_err(|err| format!("Failed to decode ad director skill package: {}", err))
}

#[tauri::command]
pub async fn export_ad_director_skill_package(
    payload: ExportAdDirectorSkillPackagePayload,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let target_path = PathBuf::from(payload.target_path.trim());
    if payload.target_path.trim().is_empty() {
        return Err("Ad director skill package output path is required.".to_string());
    }

    ensure_parent_dir(&target_path)?;

    let manifest = AdDirectorSkillPackageManifest {
        schema: AD_DIRECTOR_SKILL_PACKAGE_SCHEMA.to_string(),
        version: AD_DIRECTOR_SKILL_PACKAGE_VERSION,
        exported_at: build_exported_at()?,
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        package_kind: AD_DIRECTOR_SKILL_PACKAGE_KIND.to_string(),
        category_count: payload.data.categories.len(),
        template_count: payload.data.templates.len(),
    };
    let package_file = AdDirectorSkillPackageFile {
        manifest: manifest.clone(),
        data: payload.data,
    };
    let serialized = serde_json::to_vec_pretty(&package_file)
        .map_err(|err| format!("Failed to serialize ad director skill package: {}", err))?;
    fs::write(&target_path, serialized)
        .map_err(|err| format!("Failed to write ad director skill package file: {}", err))?;

    info!(
        "export_ad_director_skill_package done: categories={}, templates={}, elapsed={}ms",
        manifest.category_count,
        manifest.template_count,
        started.elapsed().as_millis()
    );

    Ok(())
}

#[tauri::command]
pub async fn import_ad_director_skill_package(
    package_path: String,
) -> Result<ImportedAdDirectorSkillPackageResult, String> {
    let started = std::time::Instant::now();
    let trimmed_package_path = package_path.trim();
    if trimmed_package_path.is_empty() {
        return Err("Ad director skill package path is required.".to_string());
    }

    let package_file = read_ad_director_skill_package(trimmed_package_path)?;

    info!(
        "import_ad_director_skill_package done: categories={}, templates={}, elapsed={}ms",
        package_file.manifest.category_count,
        package_file.manifest.template_count,
        started.elapsed().as_millis()
    );

    Ok(ImportedAdDirectorSkillPackageResult {
        package_path: trimmed_package_path.to_string(),
        manifest: package_file.manifest,
        data: package_file.data,
    })
}
