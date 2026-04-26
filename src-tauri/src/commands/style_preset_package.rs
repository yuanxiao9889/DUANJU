use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tracing::info;

use super::image;

const STYLE_TEMPLATE_PACKAGE_SCHEMA: &str = "storyboard-copilot/style-template-package";
const MJ_STYLE_CODE_PACKAGE_SCHEMA: &str = "storyboard-copilot/mj-style-code-package";
const STYLE_TEMPLATE_PACKAGE_KIND: &str = "style-template";
const MJ_STYLE_CODE_PACKAGE_KIND: &str = "mj-style-code";
const STYLE_PRESET_PACKAGE_VERSION: u32 = 1;
const STYLE_PRESET_ASSET_REF_PREFIX: &str = "__scpreset_asset__:";
const STYLE_PRESET_ERROR_PREFIX: &str = "scpreset";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTemplateCategoryRecord {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTemplateRecord {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub image_url: Option<String>,
    pub category_id: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MjStyleCodePresetRecord {
    pub id: String,
    pub name: String,
    pub code: String,
    pub image_url: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylePresetPackageAssetEntry {
    pub id: String,
    pub original_file_name: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylePresetPackageManifest {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    pub app_version: Option<String>,
    pub package_kind: String,
    pub asset_count: usize,
    pub category_count: usize,
    pub template_count: usize,
    pub preset_count: usize,
    pub assets: Vec<StylePresetPackageAssetEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StylePresetPackageAssetBlob {
    pub id: String,
    pub file_name: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleTemplatePackageData {
    pub categories: Vec<StyleTemplateCategoryRecord>,
    pub templates: Vec<StyleTemplateRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MjStyleCodePackageData {
    pub presets: Vec<MjStyleCodePresetRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StyleTemplatePackageFile {
    pub manifest: StylePresetPackageManifest,
    pub data: StyleTemplatePackageData,
    pub asset_blobs: Vec<StylePresetPackageAssetBlob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MjStyleCodePackageFile {
    pub manifest: StylePresetPackageManifest,
    pub data: MjStyleCodePackageData,
    pub asset_blobs: Vec<StylePresetPackageAssetBlob>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStyleTemplatePackagePayload {
    pub target_path: String,
    pub data: StyleTemplatePackageData,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMjStyleCodePackagePayload {
    pub target_path: String,
    pub data: MjStyleCodePackageData,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedStyleTemplatePackageResult {
    pub package_path: String,
    pub manifest: StylePresetPackageManifest,
    pub data: StyleTemplatePackageData,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMjStyleCodePackageResult {
    pub package_path: String,
    pub manifest: StylePresetPackageManifest,
    pub data: MjStyleCodePackageData,
}

fn package_error(code: &str) -> String {
    format!("{STYLE_PRESET_ERROR_PREFIX}::{code}")
}

fn package_error_with_detail(code: &str, detail: &str) -> String {
    let sanitized_detail = detail.replace("\r", " ").replace('\n', " ");
    format!("{STYLE_PRESET_ERROR_PREFIX}::{code}::{sanitized_detail}")
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

fn get_file_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(sanitize_file_component)
        .unwrap_or_else(|| "asset.bin".to_string())
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
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
        .map_err(|err| format!("Failed to read style preset package file: {}", err))?;
    serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("Failed to parse style preset package file: {}", err))
}

fn parse_manifest(value: &Value) -> Result<StylePresetPackageManifest, String> {
    let manifest_value = value
        .get("manifest")
        .cloned()
        .ok_or_else(|| "Style preset package manifest is missing.".to_string())?;
    serde_json::from_value::<StylePresetPackageManifest>(manifest_value)
        .map_err(|err| format!("Failed to decode style preset package manifest: {}", err))
}

fn validate_manifest(
    manifest: &StylePresetPackageManifest,
    expected_schema: &str,
    expected_kind: &str,
) -> Result<(), String> {
    if manifest.schema != expected_schema {
        if manifest.schema == STYLE_TEMPLATE_PACKAGE_SCHEMA
            || manifest.schema == MJ_STYLE_CODE_PACKAGE_SCHEMA
        {
            return Err(package_error("package_kind_mismatch"));
        }
        return Err(package_error("invalid_schema"));
    }

    if manifest.version != STYLE_PRESET_PACKAGE_VERSION {
        return Err(package_error("invalid_version"));
    }

    if manifest.package_kind != expected_kind {
        return Err(package_error("package_kind_mismatch"));
    }

    Ok(())
}

fn read_style_template_package(path: &str) -> Result<StyleTemplatePackageFile, String> {
    let value = read_package_value(path)?;
    let manifest = parse_manifest(&value)?;
    validate_manifest(
        &manifest,
        STYLE_TEMPLATE_PACKAGE_SCHEMA,
        STYLE_TEMPLATE_PACKAGE_KIND,
    )?;
    serde_json::from_value::<StyleTemplatePackageFile>(value)
        .map_err(|err| format!("Failed to decode style template package: {}", err))
}

fn read_mj_style_code_package(path: &str) -> Result<MjStyleCodePackageFile, String> {
    let value = read_package_value(path)?;
    let manifest = parse_manifest(&value)?;
    validate_manifest(
        &manifest,
        MJ_STYLE_CODE_PACKAGE_SCHEMA,
        MJ_STYLE_CODE_PACKAGE_KIND,
    )?;
    serde_json::from_value::<MjStyleCodePackageFile>(value)
        .map_err(|err| format!("Failed to decode style code package: {}", err))
}

fn read_local_image_asset(
    source_path: &str,
    missing_code: &str,
    display_name: &str,
) -> Result<(Vec<u8>, PathBuf), String> {
    let trimmed_source = source_path.trim();
    let path = PathBuf::from(trimmed_source);
    if trimmed_source.is_empty() || !path.exists() {
        return Err(package_error_with_detail(missing_code, display_name));
    }

    let bytes =
        fs::read(&path).map_err(|_| package_error_with_detail(missing_code, display_name))?;
    Ok((bytes, path))
}

fn append_asset_blob(
    bytes: &[u8],
    path: &Path,
    digest_to_asset_id: &mut HashMap<String, String>,
    manifest_assets: &mut Vec<StylePresetPackageAssetEntry>,
    asset_blobs: &mut Vec<StylePresetPackageAssetBlob>,
) -> String {
    let digest = format!("{:x}", md5::compute(bytes));
    if let Some(existing_asset_id) = digest_to_asset_id.get(&digest) {
        return existing_asset_id.clone();
    }

    let asset_id = format!("asset-{}", digest_to_asset_id.len() + 1);
    let file_name = get_file_name_from_path(path);
    manifest_assets.push(StylePresetPackageAssetEntry {
        id: asset_id.clone(),
        original_file_name: file_name.clone(),
        byte_size: bytes.len() as u64,
    });
    asset_blobs.push(StylePresetPackageAssetBlob {
        id: asset_id.clone(),
        file_name,
        data_base64: STANDARD.encode(bytes),
    });
    digest_to_asset_id.insert(digest, asset_id.clone());
    asset_id
}

fn write_package_file<T: Serialize>(target_path: &Path, package_file: &T) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(package_file)
        .map_err(|err| format!("Failed to serialize style preset package file: {}", err))?;
    fs::write(target_path, serialized)
        .map_err(|err| format!("Failed to write style preset package file: {}", err))
}

fn extract_extension(file_name: &str) -> Option<String> {
    Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn resolve_imported_asset_path(
    image_url: Option<String>,
    asset_path_by_id: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    let Some(image_url) = image_url else {
        return Ok(None);
    };

    let trimmed_image_url = image_url.trim();
    if trimmed_image_url.is_empty() {
        return Ok(None);
    }

    let Some(asset_id) = trimmed_image_url.strip_prefix(STYLE_PRESET_ASSET_REF_PREFIX) else {
        return Err(package_error("invalid_asset_reference"));
    };

    let resolved_path = asset_path_by_id
        .get(asset_id)
        .cloned()
        .ok_or_else(|| package_error("invalid_asset_reference"))?;
    Ok(Some(resolved_path))
}

#[tauri::command]
pub async fn export_style_template_package(
    payload: ExportStyleTemplatePackagePayload,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let target_path = PathBuf::from(payload.target_path.trim());
    if payload.target_path.trim().is_empty() {
        return Err("Style template package output path is required.".to_string());
    }

    ensure_parent_dir(&target_path)?;

    let mut templates = payload.data.templates.clone();
    let mut digest_to_asset_id = HashMap::new();
    let mut manifest_assets = Vec::new();
    let mut asset_blobs = Vec::new();

    for template in &mut templates {
        let Some(image_url) = template.image_url.clone() else {
            continue;
        };

        let (bytes, path) =
            read_local_image_asset(&image_url, "missing_template_image", &template.name)?;
        let asset_id = append_asset_blob(
            &bytes,
            &path,
            &mut digest_to_asset_id,
            &mut manifest_assets,
            &mut asset_blobs,
        );
        template.image_url = Some(format!("{STYLE_PRESET_ASSET_REF_PREFIX}{asset_id}"));
    }

    let manifest = StylePresetPackageManifest {
        schema: STYLE_TEMPLATE_PACKAGE_SCHEMA.to_string(),
        version: STYLE_PRESET_PACKAGE_VERSION,
        exported_at: build_exported_at()?,
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        package_kind: STYLE_TEMPLATE_PACKAGE_KIND.to_string(),
        asset_count: manifest_assets.len(),
        category_count: payload.data.categories.len(),
        template_count: templates.len(),
        preset_count: 0,
        assets: manifest_assets,
    };
    let package_file = StyleTemplatePackageFile {
        manifest: manifest.clone(),
        data: StyleTemplatePackageData {
            categories: payload.data.categories,
            templates,
        },
        asset_blobs,
    };
    write_package_file(&target_path, &package_file)?;

    info!(
        "export_style_template_package done: categories={}, templates={}, assets={}, elapsed={}ms",
        manifest.category_count,
        manifest.template_count,
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(())
}

#[tauri::command]
pub async fn import_style_template_package(
    app: AppHandle,
    package_path: String,
) -> Result<ImportedStyleTemplatePackageResult, String> {
    let started = std::time::Instant::now();
    let trimmed_package_path = package_path.trim();
    if trimmed_package_path.is_empty() {
        return Err("Style template package path is required.".to_string());
    }

    let package_file = read_style_template_package(trimmed_package_path)?;
    let manifest = package_file.manifest.clone();
    let mut asset_path_by_id = HashMap::new();

    for asset_blob in &package_file.asset_blobs {
        let manifest_entry = manifest
            .assets
            .iter()
            .find(|entry| entry.id == asset_blob.id)
            .ok_or_else(|| package_error("invalid_asset_blob"))?;
        let bytes = STANDARD
            .decode(&asset_blob.data_base64)
            .map_err(|_| package_error("invalid_asset_blob"))?;
        let extension = extract_extension(&asset_blob.file_name)
            .or_else(|| extract_extension(&manifest_entry.original_file_name));
        let persisted_path = image::persist_image_binary(app.clone(), bytes, extension).await?;
        asset_path_by_id.insert(asset_blob.id.clone(), persisted_path);
    }

    let mut data = package_file.data;
    for template in &mut data.templates {
        template.image_url =
            resolve_imported_asset_path(template.image_url.clone(), &asset_path_by_id)?;
    }

    info!(
        "import_style_template_package done: categories={}, templates={}, assets={}, elapsed={}ms",
        manifest.category_count,
        manifest.template_count,
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(ImportedStyleTemplatePackageResult {
        package_path: trimmed_package_path.to_string(),
        manifest,
        data,
    })
}

#[tauri::command]
pub async fn export_mj_style_code_package(
    payload: ExportMjStyleCodePackagePayload,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let target_path = PathBuf::from(payload.target_path.trim());
    if payload.target_path.trim().is_empty() {
        return Err("Style code package output path is required.".to_string());
    }

    ensure_parent_dir(&target_path)?;

    let mut presets = payload.data.presets.clone();
    let mut digest_to_asset_id = HashMap::new();
    let mut manifest_assets = Vec::new();
    let mut asset_blobs = Vec::new();

    for preset in &mut presets {
        let Some(image_url) = preset.image_url.clone() else {
            continue;
        };

        let (bytes, path) =
            read_local_image_asset(&image_url, "missing_preset_image", &preset.name)?;
        let asset_id = append_asset_blob(
            &bytes,
            &path,
            &mut digest_to_asset_id,
            &mut manifest_assets,
            &mut asset_blobs,
        );
        preset.image_url = Some(format!("{STYLE_PRESET_ASSET_REF_PREFIX}{asset_id}"));
    }

    let manifest = StylePresetPackageManifest {
        schema: MJ_STYLE_CODE_PACKAGE_SCHEMA.to_string(),
        version: STYLE_PRESET_PACKAGE_VERSION,
        exported_at: build_exported_at()?,
        app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        package_kind: MJ_STYLE_CODE_PACKAGE_KIND.to_string(),
        asset_count: manifest_assets.len(),
        category_count: 0,
        template_count: 0,
        preset_count: presets.len(),
        assets: manifest_assets,
    };
    let package_file = MjStyleCodePackageFile {
        manifest: manifest.clone(),
        data: MjStyleCodePackageData { presets },
        asset_blobs,
    };
    write_package_file(&target_path, &package_file)?;

    info!(
        "export_mj_style_code_package done: presets={}, assets={}, elapsed={}ms",
        manifest.preset_count,
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(())
}

#[tauri::command]
pub async fn import_mj_style_code_package(
    app: AppHandle,
    package_path: String,
) -> Result<ImportedMjStyleCodePackageResult, String> {
    let started = std::time::Instant::now();
    let trimmed_package_path = package_path.trim();
    if trimmed_package_path.is_empty() {
        return Err("Style code package path is required.".to_string());
    }

    let package_file = read_mj_style_code_package(trimmed_package_path)?;
    let manifest = package_file.manifest.clone();
    let mut asset_path_by_id = HashMap::new();

    for asset_blob in &package_file.asset_blobs {
        let manifest_entry = manifest
            .assets
            .iter()
            .find(|entry| entry.id == asset_blob.id)
            .ok_or_else(|| package_error("invalid_asset_blob"))?;
        let bytes = STANDARD
            .decode(&asset_blob.data_base64)
            .map_err(|_| package_error("invalid_asset_blob"))?;
        let extension = extract_extension(&asset_blob.file_name)
            .or_else(|| extract_extension(&manifest_entry.original_file_name));
        let persisted_path = image::persist_image_binary(app.clone(), bytes, extension).await?;
        asset_path_by_id.insert(asset_blob.id.clone(), persisted_path);
    }

    let mut data = package_file.data;
    for preset in &mut data.presets {
        preset.image_url =
            resolve_imported_asset_path(preset.image_url.clone(), &asset_path_by_id)?;
    }

    info!(
        "import_mj_style_code_package done: presets={}, assets={}, elapsed={}ms",
        manifest.preset_count,
        manifest.asset_count,
        started.elapsed().as_millis()
    );

    Ok(ImportedMjStyleCodePackageResult {
        package_path: trimmed_package_path.to_string(),
        manifest,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        package_error, parse_manifest, resolve_imported_asset_path, validate_manifest,
        StylePresetPackageManifest, MJ_STYLE_CODE_PACKAGE_KIND, MJ_STYLE_CODE_PACKAGE_SCHEMA,
        STYLE_PRESET_ASSET_REF_PREFIX, STYLE_TEMPLATE_PACKAGE_KIND, STYLE_TEMPLATE_PACKAGE_SCHEMA,
    };
    use serde_json::json;
    use std::collections::HashMap;

    fn sample_manifest(schema: &str, package_kind: &str) -> StylePresetPackageManifest {
        StylePresetPackageManifest {
            schema: schema.to_string(),
            version: 1,
            exported_at: "123".to_string(),
            app_version: Some("2.0.4".to_string()),
            package_kind: package_kind.to_string(),
            asset_count: 0,
            category_count: 0,
            template_count: 0,
            preset_count: 0,
            assets: Vec::new(),
        }
    }

    #[test]
    fn validate_manifest_rejects_other_package_kind() {
        let manifest = sample_manifest(MJ_STYLE_CODE_PACKAGE_SCHEMA, MJ_STYLE_CODE_PACKAGE_KIND);
        let result = validate_manifest(
            &manifest,
            STYLE_TEMPLATE_PACKAGE_SCHEMA,
            STYLE_TEMPLATE_PACKAGE_KIND,
        );
        assert_eq!(result.unwrap_err(), package_error("package_kind_mismatch"));
    }

    #[test]
    fn parse_manifest_reads_manifest_object() {
        let value = json!({
            "manifest": sample_manifest(STYLE_TEMPLATE_PACKAGE_SCHEMA, STYLE_TEMPLATE_PACKAGE_KIND),
            "data": {
                "categories": [],
                "templates": []
            },
            "assetBlobs": []
        });
        let manifest = parse_manifest(&value).expect("manifest should parse");
        assert_eq!(manifest.schema, STYLE_TEMPLATE_PACKAGE_SCHEMA);
        assert_eq!(manifest.package_kind, STYLE_TEMPLATE_PACKAGE_KIND);
    }

    #[test]
    fn resolve_imported_asset_path_rewrites_asset_reference() {
        let mut asset_path_by_id = HashMap::new();
        asset_path_by_id.insert("asset-1".to_string(), "C:/images/a.png".to_string());

        let resolved = resolve_imported_asset_path(
            Some(format!("{STYLE_PRESET_ASSET_REF_PREFIX}asset-1")),
            &asset_path_by_id,
        )
        .expect("asset ref should resolve");

        assert_eq!(resolved.as_deref(), Some("C:/images/a.png"));
    }
}
