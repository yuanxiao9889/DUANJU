use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::time::sleep;
use tracing::warn;
use uuid::Uuid;

const IMAGE_TIMEOUT_MS: u64 = 12 * 60 * 1000;
const VIDEO_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const POLL_INTERVAL_MS: u64 = 2_500;
const DEFAULT_IMAGE_COUNT: usize = 1;
const MAX_IMAGE_COUNT: usize = 4;
const DREAMINA_INSTALL_SCRIPT_URL: &str = "https://jimeng.jianying.com/cli";
const DREAMINA_NETWORK_TIMEOUT_SECS: u64 = 8;
const DREAMINA_UPDATE_USER_AGENT: &str = "Storyboard-Copilot-Dreamina-Updater";
const DREAMINA_SETUP_PROGRESS_EVENT: &str = "dreamina://setup-progress";
const DREAMINA_LOGIN_WAIT_TIMEOUT_MS: u64 = 5 * 60 * 1000;
const DREAMINA_LOGIN_VERIFY_TIMEOUT_MS: u64 = 30 * 1000;
const DREAMINA_LOGIN_POLL_INTERVAL_MS: u64 = 1_000;
const DREAMINA_QR_READY_TIMEOUT_MS: u64 = 30 * 1000;
const DREAMINA_LOGIN_CALLBACK_PORT: u16 = 60713;
const DREAMINA_BUNDLED_DIR_NAME: &str = "dreamina-cli";
const DREAMINA_BUNDLED_BIN_NAME: &str = "dreamina.exe";
const DREAMINA_VERSION_RECORD_FILE_NAME: &str = "version.json";
const DREAMINA_LOGIN_LOG_FILE_NAME: &str = "dreamina-login.log";
const DREAMINA_LOGIN_QR_FILE_NAME: &str = "dreamina-login-qr.png";
const DREAMINA_RUNTIME_PROFILE_DIR_NAME: &str = "profile";
const DREAMINA_QR_READY_MARKER: &str = "[DREAMINA:QR_READY]";
const DREAMINA_LOGIN_SUCCESS_MARKER: &str = "[DREAMINA:LOGIN_SUCCESS]";
const DREAMINA_LOGIN_REUSED_MARKER: &str = "[DREAMINA:LOGIN_REUSED]";
const DREAMINA_LOGIN_EXIT_MARKER: &str = "[DREAMINA:LOGIN_EXIT]";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaReferenceAssetPayload {
    pub file_name: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateJimengDreaminaImagesPayload {
    pub prompt: String,
    pub aspect_ratio: Option<String>,
    pub resolution_type: Option<String>,
    pub model_version: Option<String>,
    pub reference_images: Option<Vec<DreaminaReferenceAssetPayload>>,
    pub image_count: Option<usize>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateJimengDreaminaVideosPayload {
    pub prompt: String,
    pub reference_mode: Option<String>,
    pub aspect_ratio: Option<String>,
    pub duration_seconds: Option<u32>,
    pub video_resolution: Option<String>,
    pub model_version: Option<String>,
    pub reference_images: Option<Vec<DreaminaReferenceAssetPayload>>,
    pub reference_videos: Option<Vec<DreaminaReferenceAssetPayload>>,
    pub reference_audios: Option<Vec<DreaminaReferenceAssetPayload>>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaGeneratedImageResult {
    pub index: usize,
    pub source_url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaGeneratedVideoResult {
    pub index: usize,
    pub source_url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingDreaminaSubmit {
    request_index: usize,
    submit_id: String,
    download_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct GitBashRuntime {
    source: DreaminaGitSource,
    bash_path: PathBuf,
    root: Option<PathBuf>,
    dreamina_bin_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct DreaminaProcessEnv {
    user_profile: PathBuf,
    app_data_dir: PathBuf,
    local_app_data_dir: PathBuf,
    temp_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct DreaminaWorkspaceLayout {
    user_profile: PathBuf,
    app_data_dir: PathBuf,
    local_app_data_dir: PathBuf,
    temp_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DreaminaCliStatusCode {
    Ready,
    GitBashMissing,
    CliMissing,
    LoginRequired,
    MembershipRequired,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaCliStatusResponse {
    pub ready: bool,
    pub code: DreaminaCliStatusCode,
    pub message: String,
    pub detail: Option<String>,
}

impl DreaminaCliStatusResponse {
    fn new(
        code: DreaminaCliStatusCode,
        message: impl Into<String>,
        detail: Option<String>,
    ) -> Self {
        Self {
            ready: matches!(code, DreaminaCliStatusCode::Ready),
            code,
            message: message.into(),
            detail,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaCliActionResponse {
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DreaminaCliBinarySource {
    Bundled,
    UserInstalled,
    SystemPath,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaCliUpdateInfoResponse {
    pub active_source: DreaminaCliBinarySource,
    pub current_version: Option<String>,
    pub bundled_version: Option<String>,
    pub latest_version: Option<String>,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
    pub has_update: bool,
    pub check_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DreaminaGitSource {
    Bundled,
    System,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DreaminaSetupProgressStage {
    Checking,
    PreparingGit,
    InstallingCli,
    OpeningLogin,
    WaitingForLogin,
    Verifying,
    Completed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaSetupProgressEvent {
    pub stage: DreaminaSetupProgressStage,
    pub progress: u8,
    pub git_source: Option<DreaminaGitSource>,
    pub detail: Option<String>,
    pub login_qr_data_url: Option<String>,
    pub login_page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaGuidedSetupResponse {
    pub status: DreaminaCliStatusResponse,
    pub git_source: Option<DreaminaGitSource>,
    pub login_terminal_opened: bool,
    pub login_wait_timed_out: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsPortOwnerRecord {
    process_id: Option<u32>,
    name: Option<String>,
    command_line: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaImageGenerationResponse {
    pub results: Vec<JimengDreaminaGeneratedImageResult>,
    pub submit_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaImageSubmitResponse {
    pub submit_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaVideoGenerationResponse {
    pub results: Vec<JimengDreaminaGeneratedVideoResult>,
    pub submit_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaVideoSubmitResponse {
    pub submit_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryJimengDreaminaImageResultsPayload {
    pub submit_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryJimengDreaminaVideoResultPayload {
    pub submit_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaImageQueryResponse {
    pub submit_ids: Vec<String>,
    pub pending_submit_ids: Vec<String>,
    pub failed_submit_ids: Vec<String>,
    pub results: Vec<JimengDreaminaGeneratedImageResult>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengDreaminaVideoQueryResponse {
    pub submit_id: String,
    pub pending: bool,
    pub status: String,
    pub results: Vec<JimengDreaminaGeneratedVideoResult>,
    pub warnings: Vec<String>,
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DreaminaCliManifest {
    installer_url: Option<String>,
    download_base: Option<String>,
    version_url: Option<String>,
    version: Option<String>,
    release_date: Option<String>,
    release_notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct DreaminaCliVersionRecord {
    version: Option<String>,
    release_date: Option<String>,
    release_notes: Option<String>,
}

#[derive(Debug, Clone)]
struct DreaminaCliResolvedBinary {
    source: DreaminaCliBinarySource,
    binary_path: Option<PathBuf>,
    current_version: Option<String>,
    bundled_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VideoCommand {
    Text2Video,
    Image2Video,
    Frames2Video,
    Multiframe2Video,
    Multimodal2Video,
}

impl VideoCommand {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text2Video => "text2video",
            Self::Image2Video => "image2video",
            Self::Frames2Video => "frames2video",
            Self::Multiframe2Video => "multiframe2video",
            Self::Multimodal2Video => "multimodal2video",
        }
    }
}

fn workspace_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "failed to resolve workspace root".to_string())
}

fn normalize_version(value: &str) -> String {
    value.trim().trim_start_matches(['v', 'V']).to_string()
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parse_parts = |value: &str| {
        normalize_version(value)
            .split('-')
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };

    let left_parts = parse_parts(left);
    let right_parts = parse_parts(right);
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_value = left_parts.get(index).copied().unwrap_or(0);
        let right_value = right_parts.get(index).copied().unwrap_or(0);
        match left_value.cmp(&right_value) {
            std::cmp::Ordering::Equal => continue,
            order => return order,
        }
    }

    std::cmp::Ordering::Equal
}

fn normalize_version_option(value: Option<&str>) -> Option<String> {
    value
        .map(normalize_version)
        .filter(|version| !version.is_empty())
}

fn append_detail_section(detail: &mut Option<String>, section: impl AsRef<str>) {
    let section = section.as_ref().trim();
    if section.is_empty() {
        return;
    }

    match detail {
        Some(existing) => {
            if existing.contains(section) {
                return;
            }
            if !existing.trim().is_empty() {
                existing.push_str("\n\n");
            }
            existing.push_str(section);
        }
        None => *detail = Some(section.to_string()),
    }
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|current| current == &candidate) {
        paths.push(candidate);
    }
}

fn bundled_resource_search_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        push_unique_path(&mut roots, resource_dir.clone());
        push_unique_path(&mut roots, resource_dir.join("resources"));
        if let Some(parent) = resource_dir.parent() {
            push_unique_path(&mut roots, parent.to_path_buf());
            push_unique_path(&mut roots, parent.join("resources"));
        }
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            push_unique_path(&mut roots, exe_dir.to_path_buf());
            push_unique_path(&mut roots, exe_dir.join("resources"));
            if let Some(parent) = exe_dir.parent() {
                push_unique_path(&mut roots, parent.to_path_buf());
                push_unique_path(&mut roots, parent.join("resources"));
            }
        }
    }

    if let Ok(workspace) = workspace_root() {
        push_unique_path(&mut roots, workspace.join("src-tauri").join("resources"));
        push_unique_path(
            &mut roots,
            workspace
                .join("src-tauri")
                .join("target")
                .join("debug")
                .join("resources"),
        );
        push_unique_path(
            &mut roots,
            workspace
                .join("src-tauri")
                .join("target")
                .join("release")
                .join("resources"),
        );
    }

    roots
}

fn runtime_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("dreamina-cli-runtime");
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create Dreamina runtime dir: {error}"))?;
    Ok(path)
}

fn dreamina_profile_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let path = runtime_root(app)?.join(DREAMINA_RUNTIME_PROFILE_DIR_NAME);
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create Dreamina profile dir: {error}"))?;
    Ok(path)
}

fn legacy_dreamina_workspace_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("workspace"))
}

fn migrate_legacy_dreamina_workspace(legacy_path: &Path, new_path: &Path) {
    if legacy_path == new_path || !legacy_path.is_dir() {
        return;
    }

    let entries = match fs::read_dir(legacy_path) {
        Ok(entries) => entries,
        Err(error) => {
            warn!(
                "failed to inspect Dreamina legacy workspace {}: {}",
                legacy_path.display(),
                error
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let source = entry.path();
        let target = new_path.join(entry.file_name());
        if target.exists() {
            continue;
        }

        if let Err(error) = fs::rename(&source, &target) {
            warn!(
                "failed to migrate Dreamina workspace item {} -> {}: {}",
                source.display(),
                target.display(),
                error
            );
        }
    }
}

fn dreamina_workspace<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let host_app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    let app_scope = host_app_data_dir
        .file_name()
        .ok_or_else(|| "failed to resolve Dreamina app-data scope".to_string())?;
    let path = dreamina_profile_root(app)?
        .join("AppData")
        .join("Roaming")
        .join(app_scope)
        .join("dreamina-cli-runtime")
        .join("workspace");
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create Dreamina workspace dir: {error}"))?;
    if let Ok(legacy_path) = legacy_dreamina_workspace_path(app) {
        migrate_legacy_dreamina_workspace(&legacy_path, &path);
    }
    Ok(path)
}

fn home_drive_from_windows_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.len() >= 2 && text.as_bytes()[1] == b':' {
        text[..2].to_string()
    } else {
        env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".to_string())
    }
}

fn home_path_from_windows_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if text.len() >= 2 && text.as_bytes()[1] == b':' {
        let suffix = text[2..].trim_start_matches(['\\', '/']);
        if suffix.is_empty() {
            "\\".to_string()
        } else {
            format!("\\{}", suffix.replace('/', "\\"))
        }
    } else {
        env::var("HOMEPATH").unwrap_or_else(|_| "\\".to_string())
    }
}

fn resolve_dreamina_workspace_layout(workspace: &Path) -> Option<DreaminaWorkspaceLayout> {
    let runtime_root = workspace.parent()?;
    let app_scope_dir = runtime_root.parent()?;
    let roaming_dir = app_scope_dir.parent()?;
    let app_data_root = roaming_dir.parent()?;
    let user_profile = app_data_root.parent()?;

    if workspace.file_name()?.to_str() == Some("workspace")
        && runtime_root.file_name()?.to_str() == Some("dreamina-cli-runtime")
        && roaming_dir.file_name()?.to_str() == Some("Roaming")
        && app_data_root.file_name()?.to_str() == Some("AppData")
    {
        return Some(DreaminaWorkspaceLayout {
            user_profile: user_profile.to_path_buf(),
            app_data_dir: roaming_dir.to_path_buf(),
            local_app_data_dir: app_data_root.join("Local"),
            temp_dir: app_data_root.join("Local").join("Temp"),
        });
    }

    let legacy_runtime_root = runtime_root;
    let legacy_user_profile = legacy_runtime_root.join(DREAMINA_RUNTIME_PROFILE_DIR_NAME);
    let legacy_app_data_dir = legacy_user_profile.join("AppData").join("Roaming");
    let legacy_local_app_data_dir = legacy_user_profile.join("AppData").join("Local");
    Some(DreaminaWorkspaceLayout {
        user_profile: legacy_user_profile,
        app_data_dir: legacy_app_data_dir,
        local_app_data_dir: legacy_local_app_data_dir.clone(),
        temp_dir: legacy_local_app_data_dir.join("Temp"),
    })
}

fn dreamina_process_env(workspace: &Path) -> Result<DreaminaProcessEnv, String> {
    let layout = resolve_dreamina_workspace_layout(workspace)
        .ok_or_else(|| "failed to resolve Dreamina workspace layout".to_string())?;
    let user_bin_dir = layout.user_profile.join("bin");
    for dir in [
        &layout.user_profile,
        &layout.app_data_dir,
        &layout.local_app_data_dir,
        &layout.temp_dir,
        &user_bin_dir,
    ] {
        fs::create_dir_all(dir)
            .map_err(|error| format!("failed to prepare Dreamina runtime dir: {error}"))?;
    }
    Ok(DreaminaProcessEnv {
        user_profile: layout.user_profile,
        app_data_dir: layout.app_data_dir,
        local_app_data_dir: layout.local_app_data_dir,
        temp_dir: layout.temp_dir,
    })
}

fn dreamina_installed_binary_path(command_env: &DreaminaProcessEnv) -> PathBuf {
    command_env
        .user_profile
        .join("bin")
        .join(DREAMINA_BUNDLED_BIN_NAME)
}

fn dreamina_installed_version_path(command_env: &DreaminaProcessEnv) -> PathBuf {
    command_env
        .user_profile
        .join(".dreamina_cli")
        .join(DREAMINA_VERSION_RECORD_FILE_NAME)
}

fn dreamina_manifest_path_from_bin_dir(bin_dir: &Path) -> PathBuf {
    bin_dir
        .parent()
        .unwrap_or(bin_dir)
        .join(".dreamina-cli-manifest.json")
}

fn read_dreamina_manifest(path: &Path) -> Option<DreaminaCliManifest> {
    let text = read_text_file_lossy(path)?;
    serde_json::from_str::<DreaminaCliManifest>(&text).ok()
}

fn read_dreamina_version_record(path: &Path) -> Option<DreaminaCliVersionRecord> {
    let text = read_text_file_lossy(path)?;
    serde_json::from_str::<DreaminaCliVersionRecord>(&text).ok()
}

fn bundled_dreamina_manifest(runtime: &GitBashRuntime) -> Option<DreaminaCliManifest> {
    let bin_dir = runtime.dreamina_bin_dir.as_ref()?;
    read_dreamina_manifest(&dreamina_manifest_path_from_bin_dir(bin_dir))
}

fn bundled_dreamina_version(runtime: &GitBashRuntime) -> Option<String> {
    normalize_version_option(bundled_dreamina_manifest(runtime)?.version.as_deref())
}

fn installed_dreamina_version(command_env: &DreaminaProcessEnv) -> Option<String> {
    normalize_version_option(
        read_dreamina_version_record(&dreamina_installed_version_path(command_env))?
            .version
            .as_deref(),
    )
}

fn resolve_active_dreamina_binary(
    runtime: &GitBashRuntime,
    command_env: &DreaminaProcessEnv,
) -> DreaminaCliResolvedBinary {
    let bundled_binary = bundled_dreamina_binary_path(runtime);
    let bundled_version = bundled_dreamina_version(runtime);
    let installed_binary = dreamina_installed_binary_path(command_env);
    let installed_exists = installed_binary.is_file();
    let installed_version = installed_dreamina_version(command_env);

    if installed_exists {
        let prefer_installed = bundled_binary.is_none()
            || bundled_version.is_none()
            || installed_version
                .as_deref()
                .map(|installed| {
                    bundled_version
                        .as_deref()
                        .map(|bundled| compare_versions(installed, bundled))
                        .unwrap_or(std::cmp::Ordering::Greater)
                        != std::cmp::Ordering::Less
                })
                .unwrap_or(false);

        if prefer_installed {
            return DreaminaCliResolvedBinary {
                source: DreaminaCliBinarySource::UserInstalled,
                binary_path: Some(installed_binary),
                current_version: installed_version,
                bundled_version,
            };
        }
    }

    if let Some(path) = bundled_binary {
        return DreaminaCliResolvedBinary {
            source: DreaminaCliBinarySource::Bundled,
            binary_path: Some(path),
            current_version: bundled_version.clone(),
            bundled_version,
        };
    }

    DreaminaCliResolvedBinary {
        source: DreaminaCliBinarySource::SystemPath,
        binary_path: None,
        current_version: installed_version,
        bundled_version,
    }
}

fn dreamina_version_url(manifest: Option<&DreaminaCliManifest>) -> Option<String> {
    if let Some(url) = manifest
        .and_then(|value| value.version_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(url.to_string());
    }

    manifest
        .and_then(|value| value.download_base.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|base| {
            format!(
                "{}/{}",
                base.trim_end_matches('/'),
                DREAMINA_VERSION_RECORD_FILE_NAME
            )
        })
}

fn dreamina_installer_url(manifest: Option<&DreaminaCliManifest>) -> &str {
    manifest
        .and_then(|value| value.installer_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DREAMINA_INSTALL_SCRIPT_URL)
}

fn build_dreamina_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(DREAMINA_NETWORK_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("failed to build Dreamina http client: {error}"))
}

fn parse_dreamina_script_variable(script: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    script.lines().find_map(|line| {
        let trimmed = line.trim();
        let value = trimmed.strip_prefix(&prefix)?;
        let value = value.trim().trim_matches('"').trim_matches('\'').trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

async fn fetch_dreamina_latest_version_record(
    manifest: Option<&DreaminaCliManifest>,
) -> Result<DreaminaCliVersionRecord, String> {
    let client = build_dreamina_http_client()?;
    let mut version_url = dreamina_version_url(manifest);

    if version_url.is_none() {
        let installer_script = client
            .get(dreamina_installer_url(manifest))
            .header(header::ACCEPT, "text/plain,*/*")
            .header(header::USER_AGENT, DREAMINA_UPDATE_USER_AGENT)
            .send()
            .await
            .map_err(|error| format!("failed to fetch Dreamina installer script: {error}"))?
            .text()
            .await
            .map_err(|error| format!("failed to read Dreamina installer script: {error}"))?;
        version_url = parse_dreamina_script_variable(&installer_script, "VERSION_URL");
    }

    let version_url =
        version_url.ok_or_else(|| "failed to resolve Dreamina version metadata url".to_string())?;

    let response = client
        .get(&version_url)
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, DREAMINA_UPDATE_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("failed to fetch Dreamina version metadata: {error}"))?;

    let response = response
        .error_for_status()
        .map_err(|error| format!("Dreamina version metadata request failed: {error}"))?;

    response
        .json::<DreaminaCliVersionRecord>()
        .await
        .map_err(|error| format!("failed to decode Dreamina version metadata: {error}"))
}

fn dreamina_release_notes_indicate_login_change(release_notes: &str) -> bool {
    let lowered = release_notes.to_ascii_lowercase();
    lowered.contains("login")
        || release_notes.contains("登录")
        || release_notes.contains("鐧诲綍")
}

fn format_dreamina_outdated_login_hint(
    current_version: &str,
    latest_record: &DreaminaCliVersionRecord,
) -> Option<String> {
    let latest_version = normalize_version_option(latest_record.version.as_deref())?;
    if compare_versions(&latest_version, current_version) != std::cmp::Ordering::Greater {
        return None;
    }

    let mut sentences = vec![format!(
        "Dreamina CLI v{latest_version} is available, but this computer is still using v{current_version}. Update the CLI before retrying login."
    )];
    let release_notes = latest_record
        .release_notes
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let release_date = latest_record
        .release_date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(notes) = release_notes {
        if dreamina_release_notes_indicate_login_change(notes) {
            if let Some(date) = release_date {
                sentences.push(format!(
                    "Official release notes on {date} mention a login-flow change."
                ));
            } else {
                sentences.push("Official release notes mention a login-flow change.".to_string());
            }
        } else if let Some(date) = release_date {
            sentences.push(format!("A newer official CLI was released on {date}."));
        }
    } else if let Some(date) = release_date {
        sentences.push(format!("A newer official CLI was released on {date}."));
    }

    Some(sentences.join(" "))
}

fn dreamina_outdated_login_hint(
    runtime: &GitBashRuntime,
    command_env: &DreaminaProcessEnv,
    latest_record: Option<&DreaminaCliVersionRecord>,
) -> Option<String> {
    let latest_record = latest_record?;
    let current_version = resolve_active_dreamina_binary(runtime, command_env)
        .current_version
        .filter(|value| !value.trim().is_empty())?;
    format_dreamina_outdated_login_hint(&current_version, latest_record)
}

fn git_root_from_bash_path(path: &Path) -> Option<PathBuf> {
    let file_name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    if file_name != "bash.exe" {
        return None;
    }

    let bin_dir = path.parent()?;
    let bin_name = bin_dir.file_name()?.to_string_lossy().to_ascii_lowercase();
    if bin_name != "bin" {
        return None;
    }

    let parent = bin_dir.parent()?;
    let parent_name = parent.file_name()?.to_string_lossy().to_ascii_lowercase();
    if parent_name == "usr" {
        return parent.parent().map(Path::to_path_buf);
    }

    Some(parent.to_path_buf())
}

fn bundled_dreamina_cli_bin_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    bundled_resource_search_roots(app)
        .into_iter()
        .map(|root| root.join(DREAMINA_BUNDLED_DIR_NAME).join("bin"))
        .find(|candidate| candidate.is_dir() && candidate.join(DREAMINA_BUNDLED_BIN_NAME).is_file())
}

fn bundled_git_runtime<R: Runtime>(app: &AppHandle<R>) -> Option<GitBashRuntime> {
    for root in bundled_resource_search_roots(app)
        .into_iter()
        .map(|root| root.join("portable-git"))
    {
        for relative in ["bin/bash.exe", "usr/bin/bash.exe"] {
            let bash_path = root.join(relative);
            if bash_path.is_file() {
                return Some(GitBashRuntime {
                    source: DreaminaGitSource::Bundled,
                    bash_path,
                    root: Some(root.clone()),
                    dreamina_bin_dir: None,
                });
            }
        }
    }

    None
}

fn system_git_runtime() -> Option<GitBashRuntime> {
    let mut candidates = Vec::new();
    if let Ok(program_files) = env::var("ProgramFiles") {
        candidates.push(PathBuf::from(&program_files).join("Git/bin/bash.exe"));
        candidates.push(PathBuf::from(&program_files).join("Git/usr/bin/bash.exe"));
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(&program_files_x86).join("Git/bin/bash.exe"));
        candidates.push(PathBuf::from(&program_files_x86).join("Git/usr/bin/bash.exe"));
    }
    candidates.push(PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"));

    for bash_path in candidates {
        if bash_path.is_file() {
            return Some(GitBashRuntime {
                source: DreaminaGitSource::System,
                root: git_root_from_bash_path(&bash_path),
                bash_path,
                dreamina_bin_dir: None,
            });
        }
    }

    None
}

fn resolve_git_bash_runtime<R: Runtime>(app: &AppHandle<R>) -> Result<GitBashRuntime, String> {
    let bundled_dreamina_bin_dir = bundled_dreamina_cli_bin_dir(app);
    bundled_git_runtime(app)
        .or_else(system_git_runtime)
        .map(|mut runtime| {
            runtime.dreamina_bin_dir = bundled_dreamina_bin_dir;
            runtime
        })
        .ok_or_else(|| {
            "Git Bash runtime was not found. Bundle a portable Git runtime under `src-tauri/resources/portable-git/` or install Git for Windows on this machine.".to_string()
        })
}

fn bash_style_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = normalized[..1].to_ascii_lowercase();
        let tail = normalized[2..].trim_start_matches('/');
        format!("/{drive}/{tail}")
    } else {
        normalized
    }
}

fn cli_path(path: &Path) -> String {
    normalize_cli_path(
        &path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy(),
    )
}

fn normalize_cli_path(value: &str) -> String {
    #[cfg(target_os = "windows")]
    let normalized = if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{stripped}")
    } else if let Some(stripped) = value.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        value.to_string()
    };

    #[cfg(not(target_os = "windows"))]
    let normalized = value.to_string();

    normalized.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::normalize_cli_path;

    #[test]
    fn normalize_cli_path_strips_windows_verbatim_drive_prefix() {
        assert_eq!(
            normalize_cli_path(r"\\?\C:\Users\Tester\image.png"),
            "C:/Users/Tester/image.png"
        );
    }

    #[test]
    fn normalize_cli_path_strips_windows_verbatim_unc_prefix() {
        assert_eq!(
            normalize_cli_path(r"\\?\UNC\server\share\image.png"),
            "//server/share/image.png"
        );
    }
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn push_path_prefix(parts: &mut Vec<String>, path: &Path) {
    if path.is_dir() {
        let next = bash_style_path(path);
        if !parts.iter().any(|current| current == &next) {
            parts.push(next);
        }
    }
}

fn push_windows_chrome_prefixes(parts: &mut Vec<String>) {
    let mut candidates = Vec::new();
    if let Ok(program_files) = env::var("ProgramFiles") {
        candidates.push(
            PathBuf::from(&program_files)
                .join("Google")
                .join("Chrome")
                .join("Application"),
        );
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(&program_files_x86)
                .join("Google")
                .join("Chrome")
                .join("Application"),
        );
    }
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(&local_app_data)
                .join("Google")
                .join("Chrome")
                .join("Application"),
        );
    }
    candidates.push(PathBuf::from(r"C:\Program Files\Google\Chrome\Application"));
    candidates.push(PathBuf::from(
        r"C:\Program Files (x86)\Google\Chrome\Application",
    ));

    for candidate in candidates {
        push_path_prefix(parts, &candidate);
    }
}

fn bundled_dreamina_binary_path(runtime: &GitBashRuntime) -> Option<PathBuf> {
    let path = runtime
        .dreamina_bin_dir
        .as_ref()
        .map(|bin_dir| bin_dir.join(DREAMINA_BUNDLED_BIN_NAME))?;
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn dreamina_command_target(runtime: &GitBashRuntime, command_env: &DreaminaProcessEnv) -> String {
    resolve_active_dreamina_binary(runtime, command_env)
        .binary_path
        .map(|path| bash_quote(&cli_path(&path)))
        .unwrap_or_else(|| "dreamina".to_string())
}

fn dreamina_path_prefix(runtime: &GitBashRuntime, command_env: &DreaminaProcessEnv) -> String {
    let mut parts = Vec::new();
    push_path_prefix(&mut parts, &command_env.user_profile.join("bin"));
    if let Some(bin_dir) = runtime.dreamina_bin_dir.as_ref() {
        push_path_prefix(&mut parts, bin_dir);
    }
    push_windows_chrome_prefixes(&mut parts);
    if let Some(root) = runtime.root.as_ref() {
        push_path_prefix(&mut parts, &root.join("bin"));
        push_path_prefix(&mut parts, &root.join("usr").join("bin"));
        push_path_prefix(&mut parts, &root.join("mingw64").join("bin"));
    }
    if let Ok(windir) = env::var("WINDIR") {
        push_path_prefix(&mut parts, &PathBuf::from(&windir).join("System32"));
        push_path_prefix(
            &mut parts,
            &PathBuf::from(&windir)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0"),
        );
        parts.push(bash_style_path(Path::new(&windir)));
    } else {
        parts.push("/c/Windows/System32".to_string());
        parts.push("/c/Windows/System32/WindowsPowerShell/v1.0".to_string());
        parts.push("/c/Windows".to_string());
    }
    parts.join(":")
}

fn contains_dreamina_membership_required(text: &str) -> bool {
    text.contains("即梦高级会员")
        || (text.contains("高级会员") && text.contains("Dreamina CLI"))
        || (text.to_ascii_lowercase().contains("premium member")
            && text.to_ascii_lowercase().contains("dreamina cli"))
}

fn dreamina_membership_required_message() -> String {
    "The current Dreamina account is not an eligible premium member yet, so Dreamina CLI cannot save the login session. Upgrade the account on the Dreamina web site, then retry the QR login."
        .to_string()
}

fn classify_dreamina_status_code(detail: &str) -> DreaminaCliStatusCode {
    let lowered = detail.trim().to_ascii_lowercase();
    if lowered.contains("git bash was not found")
        || lowered.contains("failed to launch git bash for dreamina")
    {
        DreaminaCliStatusCode::GitBashMissing
    } else if contains_dreamina_membership_required(detail) {
        DreaminaCliStatusCode::MembershipRequired
    } else if lowered.contains("dreamina cli was not found")
        || lowered.contains("command not found")
        || lowered.contains("is not recognized")
    {
        DreaminaCliStatusCode::CliMissing
    } else if lowered.contains("dreamina cli is not ready")
        || lowered.contains("dreamina login")
        || lowered.contains("credential")
        || lowered.contains("unauthorized")
        || lowered.contains("forbidden")
        || lowered.contains("user_credit")
        || lowered.contains("get_qrcode")
        || lowered.contains("empty response body")
        || lowered.contains("login qr code")
        || lowered.contains("callback server")
        || lowered.contains("listen tcp")
        || lowered.contains("port is already in use")
    {
        DreaminaCliStatusCode::LoginRequired
    } else {
        DreaminaCliStatusCode::Unknown
    }
}

fn dreamina_command_prefix(runtime: &GitBashRuntime, command_env: &DreaminaProcessEnv) -> String {
    let mut exports = vec![format!(
        "export PATH={}:$PATH",
        bash_quote(&dreamina_path_prefix(runtime, command_env))
    )];
    exports.push(format!(
        "export USERPROFILE={}",
        bash_quote(&command_env.user_profile.to_string_lossy())
    ));
    exports.push(format!(
        "export HOME={}",
        bash_quote(&bash_style_path(&command_env.user_profile))
    ));
    exports.push(format!(
        "export HOMEDRIVE={}",
        bash_quote(&home_drive_from_windows_path(&command_env.user_profile))
    ));
    exports.push(format!(
        "export HOMEPATH={}",
        bash_quote(&home_path_from_windows_path(&command_env.user_profile))
    ));
    exports.push(format!(
        "export APPDATA={}",
        bash_quote(&command_env.app_data_dir.to_string_lossy())
    ));
    exports.push(format!(
        "export LOCALAPPDATA={}",
        bash_quote(&command_env.local_app_data_dir.to_string_lossy())
    ));
    exports.push(format!(
        "export TEMP={}",
        bash_quote(&command_env.temp_dir.to_string_lossy())
    ));
    exports.push(format!(
        "export TMP={}",
        bash_quote(&command_env.temp_dir.to_string_lossy())
    ));

    exports.join("; ")
}

async fn run_git_bash_script(
    runtime: &GitBashRuntime,
    command_env: DreaminaProcessEnv,
    workspace: PathBuf,
    script: String,
) -> Result<(bool, String, String), String> {
    let bash = runtime.bash_path.clone();
    tokio::task::spawn_blocking(move || {
        let mut command = Command::new(bash);
        command
            .current_dir(workspace)
            .env("USERPROFILE", &command_env.user_profile)
            .env("HOME", &command_env.user_profile)
            .env(
                "HOMEDRIVE",
                home_drive_from_windows_path(&command_env.user_profile),
            )
            .env(
                "HOMEPATH",
                home_path_from_windows_path(&command_env.user_profile),
            )
            .env("APPDATA", &command_env.app_data_dir)
            .env("LOCALAPPDATA", &command_env.local_app_data_dir)
            .env("TEMP", &command_env.temp_dir)
            .env("TMP", &command_env.temp_dir)
            .arg("--noprofile")
            .arg("--norc")
            .arg("-lc")
            .arg(script);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        let output = command
            .output()
            .map_err(|error| format!("failed to launch Git Bash for Dreamina: {error}"))?;
        Ok((
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    })
    .await
    .map_err(|error| format!("failed to await Dreamina command: {error}"))?
}

fn install_dreamina_script(runtime: &GitBashRuntime, command_env: &DreaminaProcessEnv) -> String {
    let manifest = bundled_dreamina_manifest(runtime);
    format!(
        "{prefix}; installer_script=$(mktemp); curl -fsSL {url} -o \"$installer_script\"; bash \"$installer_script\"; status=$?; rm -f \"$installer_script\"; if [ \"$status\" -ne 0 ]; then exit \"$status\"; fi; {prefix}; command -v dreamina >/dev/null 2>&1",
        prefix = dreamina_command_prefix(runtime, command_env),
        url = bash_quote(dreamina_installer_url(manifest.as_ref())),
    )
}

fn update_dreamina_script(runtime: &GitBashRuntime, command_env: &DreaminaProcessEnv) -> String {
    let manifest = bundled_dreamina_manifest(runtime);
    format!(
        "{prefix}; installer_script=$(mktemp); curl -fsSL {url} -o \"$installer_script\"; bash \"$installer_script\"; status=$?; rm -f \"$installer_script\"; if [ \"$status\" -ne 0 ]; then exit \"$status\"; fi; test -f \"$HOME/bin/{binary}\" && test -f \"$HOME/.dreamina_cli/{version_file}\"",
        prefix = dreamina_command_prefix(runtime, command_env),
        url = bash_quote(dreamina_installer_url(manifest.as_ref())),
        binary = DREAMINA_BUNDLED_BIN_NAME,
        version_file = DREAMINA_VERSION_RECORD_FILE_NAME,
    )
}

fn dreamina_login_headless_script(
    runtime: &GitBashRuntime,
    command_env: &DreaminaProcessEnv,
) -> String {
    format!(
        "{prefix}; {dreamina} login --headless < /dev/null; status=$?; echo '{exit_marker} '$status; exit \"$status\"",
        prefix = dreamina_command_prefix(runtime, command_env),
        dreamina = dreamina_command_target(runtime, command_env),
        exit_marker = DREAMINA_LOGIN_EXIT_MARKER,
    )
}

fn dreamina_login_log_path(workspace: &Path) -> PathBuf {
    workspace.join(DREAMINA_LOGIN_LOG_FILE_NAME)
}

fn dreamina_login_qr_path(workspace: &Path) -> PathBuf {
    workspace.join(DREAMINA_LOGIN_QR_FILE_NAME)
}

fn dreamina_credential_path(workspace: &Path) -> Option<PathBuf> {
    let layout = resolve_dreamina_workspace_layout(workspace)?;
    Some(
        layout
            .user_profile
            .join(".dreamina_cli")
            .join("credential.json"),
    )
}

fn dreamina_cli_home_path(workspace: &Path) -> Option<PathBuf> {
    let layout = resolve_dreamina_workspace_layout(workspace)?;
    Some(layout.user_profile.join(".dreamina_cli"))
}

fn is_empty_dreamina_credential_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Bool(value) => !*value,
        Value::Number(_) => false,
        Value::String(value) => value.trim().is_empty(),
        Value::Array(values) => {
            values.is_empty() || values.iter().all(is_empty_dreamina_credential_value)
        }
        Value::Object(entries) => {
            entries.is_empty()
                || entries.iter().all(|(key, value)| {
                    key == "random_secret_key" || is_empty_dreamina_credential_value(value)
                })
        }
    }
}

fn dreamina_credential_session_detail(workspace: &Path) -> Option<String> {
    let credential_path = dreamina_credential_path(workspace)?;
    let bytes = match fs::read(&credential_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some(format!(
                "Dreamina credential.json is missing, so this computer still needs login. Expected path: {}",
                credential_path.display()
            ));
        }
        Err(_) => return None,
    };

    let text = String::from_utf8_lossy(&bytes).into_owned();
    if text.trim().is_empty() {
        return Some(format!(
            "Dreamina credential.json exists but is still empty, so this computer still needs login. Path: {}",
            credential_path.display()
        ));
    }

    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(entries)) => {
            let has_login_session = entries.iter().any(|(key, value)| {
                key != "random_secret_key" && !is_empty_dreamina_credential_value(value)
            });
            if has_login_session {
                None
            } else {
                Some(format!(
                    "Dreamina credential.json does not contain a usable login session yet. Path: {}",
                    credential_path.display()
                ))
            }
        }
        Ok(_) => None,
        Err(error) => Some(format!(
            "Dreamina credential.json is present but could not be parsed yet ({error}). Path: {}",
            credential_path.display()
        )),
    }
}

fn clear_dreamina_login_artifacts(workspace: &Path) {
    for path in [
        dreamina_login_log_path(workspace),
        dreamina_login_qr_path(workspace),
    ] {
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                warn!(
                    "failed to remove Dreamina login artifact {}: {}",
                    path.display(),
                    error
                );
            }
        }
    }
}

fn parse_dreamina_qr_ready_path(line: &str) -> Option<PathBuf> {
    if let Some((_, value)) = line.split_once(DREAMINA_QR_READY_MARKER) {
        let path = value.trim();
        if !path.is_empty() {
            return Some(PathBuf::from(path));
        }
    }

    line.strip_prefix("二维码 PNG 已保存到：")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn read_text_file_lossy(path: &Path) -> Option<String> {
    fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn dreamina_login_qr_file_path(workspace: &Path) -> Option<PathBuf> {
    let default_path = dreamina_login_qr_path(workspace);
    if default_path.is_file() {
        return Some(default_path);
    }

    let log_path = dreamina_login_log_path(workspace);
    let log_text = read_text_file_lossy(&log_path)?;
    log_text
        .lines()
        .rev()
        .find_map(parse_dreamina_qr_ready_path)
        .filter(|path| path.is_file())
}

fn extract_first_https_url(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Some(start) = line.find("https://") {
            let candidate = &line[start..];
            let end = candidate
                .find(char::is_whitespace)
                .unwrap_or(candidate.len());
            let url = candidate[..end]
                .trim()
                .trim_end_matches(['，', '。', ',', ';'])
                .to_string();
            if !url.is_empty() {
                return Some(url);
            }
        }
    }

    None
}

fn dreamina_login_page_url(workspace: &Path) -> Option<String> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    let mut fallback = None;

    for line in log_text.lines() {
        let Some(url) = extract_first_https_url(line) else {
            continue;
        };

        if url.contains("/passport/web/web_login") {
            return Some(url);
        }

        if fallback.is_none() {
            fallback = Some(url);
        }
    }

    fallback
}

fn parse_dreamina_login_field_value(log_text: &str, field: &str) -> Option<String> {
    let field = field.to_ascii_lowercase();
    log_text.lines().find_map(|line| {
        let trimmed = line.trim();
        let (key, value) = trimmed.split_once(':')?;
        if key.trim().to_ascii_lowercase() != field {
            return None;
        }
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn dreamina_login_device_code(workspace: &Path) -> Option<String> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    parse_dreamina_login_field_value(&log_text, "device_code")
}

fn dreamina_login_user_code(workspace: &Path) -> Option<String> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    parse_dreamina_login_field_value(&log_text, "user_code")
}

fn dreamina_login_poll_interval_ms(workspace: &Path) -> Option<u64> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    let value = parse_dreamina_login_field_value(&log_text, "poll_interval")?;
    let normalized = value.trim().trim_end_matches('s').trim();
    let seconds = normalized.parse::<u64>().ok()?;
    Some(seconds.saturating_mul(1000).max(500))
}

fn dreamina_device_flow_login_ready(workspace: &Path) -> bool {
    dreamina_login_page_url(workspace).is_some() && dreamina_login_device_code(workspace).is_some()
}

fn dreamina_login_success_logged(workspace: &Path) -> bool {
    read_text_file_lossy(&dreamina_login_log_path(workspace))
        .map(|text| {
            text.contains(DREAMINA_LOGIN_SUCCESS_MARKER)
                || text.contains(DREAMINA_LOGIN_REUSED_MARKER)
        })
        .unwrap_or(false)
}

fn dreamina_login_exit_code(workspace: &Path) -> Option<i32> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    log_text.lines().rev().find_map(|line| {
        let (_, value) = line.split_once(DREAMINA_LOGIN_EXIT_MARKER)?;
        value.trim().parse::<i32>().ok()
    })
}

fn dreamina_login_confirmed(workspace: &Path) -> bool {
    dreamina_login_success_logged(workspace)
}

fn tail_lines(text: &str, line_count: usize) -> String {
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let start = lines.len().saturating_sub(line_count);
    lines[start..].join("\n")
}

fn dreamina_login_log_tail(workspace: &Path, line_count: usize) -> Option<String> {
    let log_path = dreamina_login_log_path(workspace);
    let log_text = read_text_file_lossy(&log_path)?;
    let tail = tail_lines(&log_text, line_count);
    if tail.is_empty() {
        None
    } else {
        Some(tail)
    }
}

fn latest_dreamina_internal_log_path(workspace: &Path) -> Option<PathBuf> {
    let logs_root = dreamina_cli_home_path(workspace)?.join("logs");
    let date_dirs = fs::read_dir(logs_root).ok()?;
    let mut latest: Option<(SystemTime, PathBuf)> = None;

    for date_dir in date_dirs.flatten() {
        let day_path = date_dir.path();
        if !day_path.is_dir() {
            continue;
        }

        let log_files = match fs::read_dir(&day_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in log_files.flatten() {
            let path = entry.path();
            let is_log_file = path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("log"))
                .unwrap_or(false);
            if !path.is_file() || !is_log_file {
                continue;
            }

            let modified_at = fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let replace = latest
                .as_ref()
                .map(|(current, _)| modified_at >= *current)
                .unwrap_or(true);
            if replace {
                latest = Some((modified_at, path));
            }
        }
    }

    latest.map(|(_, path)| path)
}

fn dreamina_internal_log_tail(workspace: &Path, line_count: usize) -> Option<String> {
    let log_path = latest_dreamina_internal_log_path(workspace)?;
    let log_text = read_text_file_lossy(&log_path)?;
    let tail = tail_lines(&log_text, line_count);
    if tail.is_empty() {
        None
    } else {
        Some(format!("{}:\n{tail}", log_path.display()))
    }
}

fn dreamina_login_debug_hint(workspace: &Path) -> String {
    format!(
        "This app already retried the login with `dreamina login --headless`.\nLogin log: {}\nExpected QR file: {}",
        dreamina_login_log_path(workspace).display(),
        dreamina_login_qr_path(workspace).display()
    )
}

fn append_dreamina_login_debug_hint(workspace: &Path, detail: String) -> String {
    if detail.contains("dreamina login --headless") {
        detail
    } else {
        format!("{detail}\n\n{}", dreamina_login_debug_hint(workspace))
    }
}

fn dreamina_login_internal_failure_detail(workspace: &Path, line_count: usize) -> Option<String> {
    let internal_tail = dreamina_internal_log_tail(workspace, line_count)?;
    let lowered = internal_tail.to_ascii_lowercase();
    let headline = if lowered.contains("get_qrcode") || lowered.contains("empty response body") {
        "Dreamina could not fetch the official login QR code yet."
    } else if lowered.contains("callback server")
        || lowered.contains("listen tcp")
        || lowered.contains("bind:")
    {
        "Dreamina could not start the local login callback server because the port is still in use."
    } else if lowered.contains("require usable credential")
        || lowered.contains("parse auth token failed")
        || lowered.contains("credential.json")
        || lowered.contains("command=dreamina user_credit")
    {
        "Dreamina still needs a usable local login session."
    } else {
        "Dreamina is still preparing the login QR code."
    };
    Some(append_dreamina_login_debug_hint(
        workspace,
        format!("{headline}\nLatest Dreamina internal log:\n{internal_tail}"),
    ))
}

fn dreamina_login_membership_required_detail(workspace: &Path) -> Option<String> {
    let log_text = read_text_file_lossy(&dreamina_login_log_path(workspace))?;
    if contains_dreamina_membership_required(&log_text) {
        Some(dreamina_membership_required_message())
    } else {
        None
    }
}

fn detail_indicates_dreamina_callback_port_busy(detail: &str) -> bool {
    let lowered = detail.to_ascii_lowercase();
    lowered.contains("callback server")
        || lowered.contains("listen tcp")
        || lowered.contains("bind:")
        || lowered.contains("port is already in use")
}

fn dreamina_login_callback_port_busy(workspace: &Path) -> bool {
    dreamina_login_internal_failure_detail(workspace, 8)
        .map(|detail| detail_indicates_dreamina_callback_port_busy(&detail))
        .unwrap_or(false)
        || dreamina_login_log_tail(workspace, 8)
            .map(|detail| detail_indicates_dreamina_callback_port_busy(&detail))
            .unwrap_or(false)
}

fn dreamina_login_wait_detail(workspace: &Path) -> Option<String> {
    if let Some(detail) = dreamina_login_membership_required_detail(workspace) {
        return Some(detail);
    }

    if dreamina_login_success_logged(workspace) {
        return Some(
            "Dreamina confirmed the QR-code login. Verifying the local session with `dreamina user_credit`."
                .to_string(),
        );
    }

    if dreamina_login_qr_file_path(workspace).is_some() {
        return Some(
            "The QR code is ready. Scan it with Douyin and confirm the login on your phone."
                .to_string(),
        );
    }

    if dreamina_device_flow_login_ready(workspace) {
        let verification_url = dreamina_login_page_url(workspace).unwrap_or_default();
        let user_code = dreamina_login_user_code(workspace)
            .map(|value| format!("user_code: {value}"))
            .unwrap_or_else(|| "user_code: (not parsed)".to_string());
        return Some(append_dreamina_login_debug_hint(
            workspace,
            format!(
                "Dreamina switched to OAuth Device Flow. Open the verification page and complete authorization in the browser, then keep this dialog open while the app keeps checking login status.\nverification_uri: {verification_url}\n{user_code}"
            ),
        ));
    }

    if let Some(exit_code) = dreamina_login_exit_code(workspace) {
        let login_tail = dreamina_login_log_tail(workspace, 20)
            .unwrap_or_else(|| "Dreamina login log is still empty.".to_string());
        return Some(append_dreamina_login_debug_hint(
            workspace,
            format!(
                "Dreamina login exited before producing a QR code (exit code: {exit_code}). Latest login output:\n{login_tail}"
            ),
        ));
    }

    if let Some(login_tail) = dreamina_login_log_tail(workspace, 20) {
        let lowered = login_tail.to_ascii_lowercase();
        if lowered.contains("google-chrome") && lowered.contains("executable file not found") {
            let manual_url = dreamina_login_page_url(workspace)
                .map(|url| format!("Manual login page:\n{url}"))
                .unwrap_or_else(|| {
                    "Manual login page URL was not parsed from the current log yet.".to_string()
                });
            return Some(append_dreamina_login_debug_hint(
                workspace,
                format!(
                    "Dreamina CLI could not auto-open a browser inside the bundled runtime, so it is waiting for manual web authorization instead.\n{manual_url}\n\nLatest Dreamina login output:\n{login_tail}"
                ),
            ));
        }
    }

    if let Some(detail) = dreamina_login_log_tail(workspace, 12).and_then(|tail| {
        let lowered = tail.to_ascii_lowercase();
        if lowered.contains("get_qrcode")
            || lowered.contains("empty response body")
            || lowered.contains("callback server")
            || lowered.contains("listen tcp")
            || lowered.contains("bind:")
            || lowered.contains("error")
        {
            Some(append_dreamina_login_debug_hint(
                workspace,
                format!("Latest Dreamina login output:\n{tail}"),
            ))
        } else {
            None
        }
    }) {
        return Some(detail);
    }

    if let Some(detail) = dreamina_login_internal_failure_detail(workspace, 6) {
        return Some(detail);
    }

    if let Some(detail) = dreamina_credential_session_detail(workspace) {
        return Some(append_dreamina_login_debug_hint(workspace, detail));
    }

    dreamina_login_log_tail(workspace, 6).map(|tail| {
        append_dreamina_login_debug_hint(
            workspace,
            format!("Dreamina is still preparing the login QR code. Latest login output:\n{tail}"),
        )
    })
}

fn encode_file_as_data_url(path: &Path, mime_type: &str) -> Result<String, String> {
    let mut last_error: Option<std::io::Error> = None;
    for attempt in 0..5 {
        match fs::read(path) {
            Ok(bytes) => {
                return Ok(format!(
                    "data:{mime_type};base64,{}",
                    BASE64_STANDARD.encode(bytes)
                ));
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < 4 {
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
        }
    }

    let error = last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "unknown error".to_string());
    Err(format!("failed to read Dreamina login QR file: {error}"))
}

fn encode_login_url_as_qr_image_url(login_url: &str) -> String {
    format!(
        "https://api.qrserver.com/v1/create-qr-code/?size=720x720&margin=0&data={}",
        urlencoding::encode(login_url)
    )
}

fn dreamina_login_qr_data_url(workspace: &Path) -> Option<String> {
    if let Some(qr_path) = dreamina_login_qr_file_path(workspace) {
        return encode_file_as_data_url(&qr_path, "image/png").ok();
    }

    let verification_url = dreamina_login_page_url(workspace)?;
    Some(encode_login_url_as_qr_image_url(&verification_url))
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn truncate_command_line_for_detail(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let truncated = trimmed.chars().take(max_chars).collect::<String>();
    format!("{truncated}...")
}

fn format_dreamina_callback_port_owner_detail(owners: &[WindowsPortOwnerRecord]) -> String {
    let mut lines = vec![format!(
        "Dreamina uses local callback port {} for QR login, but it is still occupied after cleanup.",
        DREAMINA_LOGIN_CALLBACK_PORT
    )];

    for owner in owners {
        let pid = owner
            .process_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let name = owner
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        let mut line = format!("- PID {pid} | {name}");
        if let Some(command_line) = owner
            .command_line
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            line.push_str(" | ");
            line.push_str(&truncate_command_line_for_detail(command_line, 220));
        }
        lines.push(line);
    }

    lines.push(
        "Please close the process above or free port 60713, then retry QR login.".to_string(),
    );
    lines.join("\n")
}

async fn query_dreamina_callback_port_owners() -> Result<Vec<WindowsPortOwnerRecord>, String> {
    if !cfg!(target_os = "windows") {
        return Ok(Vec::new());
    }

    tokio::task::spawn_blocking(move || {
        let script = format!(
            "$connections = Get-NetTCPConnection -State Listen -LocalPort {port} -ErrorAction SilentlyContinue; \
if (-not $connections) {{ '[]'; exit 0 }}; \
$owners = foreach ($connection in $connections) {{ \
  $process = Get-CimInstance Win32_Process -Filter (\"ProcessId = \" + $connection.OwningProcess) -ErrorAction SilentlyContinue; \
  [PSCustomObject]@{{ \
    ProcessId = $connection.OwningProcess; \
    Name = if ($process) {{ $process.Name }} else {{ $null }}; \
    CommandLine = if ($process) {{ $process.CommandLine }} else {{ $null }} \
  }} \
}}; \
$owners | Sort-Object ProcessId -Unique | ConvertTo-Json -Compress",
            port = DREAMINA_LOGIN_CALLBACK_PORT
        );

        let mut command = Command::new("powershell");
        command
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(script);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        let output = command
            .output()
            .map_err(|error| format!("failed to inspect Dreamina callback port owner: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "failed to inspect Dreamina callback port owner".to_string()
            } else {
                format!("failed to inspect Dreamina callback port owner: {stderr}")
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() || stdout == "null" || stdout == "[]" {
            return Ok(Vec::new());
        }

        if stdout.starts_with('[') {
            serde_json::from_str::<Vec<WindowsPortOwnerRecord>>(&stdout)
                .map_err(|error| format!("failed to parse Dreamina callback port owners: {error}"))
        } else {
            serde_json::from_str::<WindowsPortOwnerRecord>(&stdout)
                .map(|record| vec![record])
                .map_err(|error| format!("failed to parse Dreamina callback port owner: {error}"))
        }
    })
    .await
    .map_err(|error| format!("failed to await Dreamina callback port owner inspection: {error}"))?
}

async fn terminate_conflicting_dreamina_processes(
    runtime: &GitBashRuntime,
    command_env: &DreaminaProcessEnv,
) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Ok(());
    }

    let mut binary_paths = Vec::new();
    if let Some(path) = bundled_dreamina_binary_path(runtime) {
        binary_paths.push(path);
    }
    let installed_binary = dreamina_installed_binary_path(command_env);
    if installed_binary.is_file() {
        binary_paths.push(installed_binary);
    }

    let binary_paths = binary_paths
        .into_iter()
        .map(|path| {
            path.canonicalize()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<_>>();
    let runtime_root = command_env
        .user_profile
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| command_env.user_profile.clone())
        .canonicalize()
        .unwrap_or_else(|_| {
            command_env
                .user_profile
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| command_env.user_profile.clone())
        })
        .to_string_lossy()
        .to_string();
    let temp_dir = command_env
        .temp_dir
        .canonicalize()
        .unwrap_or_else(|_| command_env.temp_dir.clone())
        .to_string_lossy()
        .to_string();

    tokio::task::spawn_blocking(move || {
        let powershell_paths = binary_paths
            .iter()
            .map(|path| powershell_quote(path))
            .collect::<Vec<_>>()
            .join(", ");
        let runtime_root = powershell_quote(&runtime_root);
        let temp_dir = powershell_quote(&temp_dir);
        let script = format!(
            "$paths = @({powershell_paths}); $runtimeRoot = {runtime_root}; $tempDir = {temp_dir}; $callbackPort = {callback_port}; if ($paths.Count -gt 0) {{ Get-Process dreamina -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -and ($paths -contains $_.Path) }} | Stop-Process -Force -ErrorAction SilentlyContinue; }}; Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {{ $cmd = $_.CommandLine; if (-not $cmd) {{ return $false }}; $isRuntimeChrome = $_.Name -eq 'chrome.exe' -and (($cmd -like \"*$tempDir*\") -or ($cmd -like \"*$runtimeRoot*\") -or (($cmd -like '*chromedp-runner*') -and ($cmd -like '*dreamina-cli-runtime*')) -or (($cmd -like '*chromedp-runner*') -and ($cmd -like '*dreamina-cli-runtime-userprofile-test*'))); $isLoginShell = (($_.Name -eq 'powershell.exe') -or ($_.Name -eq 'bash.exe') -or ($_.Name -eq 'sh.exe')) -and (($cmd -like '*dreamina login*') -and (($cmd -like '*dreamina-cli-runtime*') -or ($cmd -like '*com.storyboard.copilot*'))); $isRuntimeChrome -or $isLoginShell }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; }}; Get-NetTCPConnection -State Listen -LocalPort $callbackPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {{ $owner = Get-CimInstance Win32_Process -Filter (\"ProcessId = \" + $_) -ErrorAction SilentlyContinue; if ($owner) {{ $cmd = $owner.CommandLine; if (($owner.Name -in @('dreamina.exe','chrome.exe','powershell.exe','bash.exe','sh.exe')) -or ($cmd -and (($cmd -like '*dreamina*') -or ($cmd -like '*chromedp-runner*') -or ($cmd -like '*com.storyboard.copilot*')))) {{ Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue; }} }} }}; if (Test-Path -LiteralPath $tempDir) {{ Get-ChildItem -LiteralPath $tempDir -Force -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -like 'chromedp-runner*' -or $_.Name -like '*.tmp' }} | ForEach-Object {{ Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue; }}; }}"
            ,
            callback_port = DREAMINA_LOGIN_CALLBACK_PORT
        );
        let mut command = Command::new("powershell");
        command
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(script);
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .status()
            .map_err(|error| {
                format!("failed to clean up the previous Dreamina login session: {error}")
            })?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("failed to await Dreamina login cleanup: {error}"))?
}

fn extract_json_text(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    let start = trimmed.find('{').or_else(|| trimmed.find('['))?;
    let candidate = &trimmed[start..];
    let end = candidate.rfind('}').or_else(|| candidate.rfind(']'))?;
    Some(&candidate[..=end])
}

fn first_non_empty_dreamina_output<'a>(stdout: &'a str, stderr: &'a str) -> Option<&'a str> {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .or_else(|| stdout.lines().map(str::trim).find(|line| !line.is_empty()))
}

fn last_non_empty_dreamina_line(text: &str) -> Option<&str> {
    text.lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
}

fn tail_non_empty_dreamina_lines(text: &str, max_lines: usize) -> Vec<&str> {
    let mut lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if lines.len() > max_lines {
        lines = lines.split_off(lines.len() - max_lines);
    }
    lines
}

fn format_dreamina_script_failure(
    action_label: &str,
    stdout: &str,
    stderr: &str,
    fallback: &str,
) -> String {
    let primary = last_non_empty_dreamina_line(stderr)
        .or_else(|| last_non_empty_dreamina_line(stdout))
        .or_else(|| first_non_empty_dreamina_output(stdout, stderr))
        .unwrap_or(fallback);
    let normalized = normalize_dreamina_cli_error(primary);
    let stderr_tail = tail_non_empty_dreamina_lines(stderr, 4);
    let stdout_tail = tail_non_empty_dreamina_lines(stdout, 4);
    let mut sections = Vec::new();

    if !stderr_tail.is_empty() {
        sections.push(format!(
            "{action_label} stderr:\n{}",
            stderr_tail.join("\n")
        ));
    }
    if !stdout_tail.is_empty() {
        sections.push(format!(
            "{action_label} stdout:\n{}",
            stdout_tail.join("\n")
        ));
    }

    if sections.is_empty() {
        normalized
    } else {
        format!("{normalized}\n\n{}", sections.join("\n\n"))
    }
}

fn dreamina_cli_install_artifacts_ready(command_env: &DreaminaProcessEnv) -> bool {
    dreamina_installed_binary_path(command_env).is_file()
        && dreamina_installed_version_path(command_env).is_file()
}

fn is_generic_dreamina_failure(detail: &str) -> bool {
    let lowered = detail.trim().to_ascii_lowercase();
    lowered.is_empty() || lowered == "dreamina cli failed." || lowered == "error"
}

fn looks_like_dreamina_login_failure(detail: &str) -> bool {
    let lowered = detail.trim().to_ascii_lowercase();
    lowered.contains("dreamina login")
        || lowered.contains("login qr code")
        || lowered.contains("credential")
        || lowered.contains("unauthorized")
        || lowered.contains("forbidden")
        || lowered.contains("user_credit")
        || lowered.contains("get_qrcode")
        || lowered.contains("empty response body")
        || lowered.contains("callback server")
        || lowered.contains("listen tcp")
}

fn compose_dreamina_login_failure_detail(workspace: &Path, primary_detail: &str) -> String {
    let mut sections = Vec::new();
    if let Some(detail) = dreamina_credential_session_detail(workspace) {
        sections.push(detail);
    }
    if let Some(detail) = dreamina_login_internal_failure_detail(workspace, 8) {
        sections.push(detail);
    } else if let Some(detail) = dreamina_login_log_tail(workspace, 8) {
        sections.push(format!("Latest Dreamina login output:\n{detail}"));
    }

    if sections.is_empty() {
        append_dreamina_login_debug_hint(workspace, primary_detail.to_string())
    } else {
        append_dreamina_login_debug_hint(
            workspace,
            format!("{}\n\n{}", primary_detail.trim(), sections.join("\n\n")),
        )
    }
}

fn normalize_dreamina_cli_error(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.contains("AigcComplianceConfirmationRequired") {
        return "This Dreamina model requires a one-time authorization on the Dreamina web site before retrying.".to_string();
    }
    if contains_dreamina_membership_required(trimmed) {
        return dreamina_membership_required_message();
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.contains("get_qrcode")
        || lowered.contains("empty response body")
        || lowered.contains("login qr code")
    {
        return format!(
            "Dreamina could not fetch the official login QR code. Retry the QR login after a short wait. Original error: {trimmed}"
        );
    }
    if lowered.contains("callback server")
        || lowered.contains("listen tcp")
        || lowered.contains("port is already in use")
        || lowered.contains("bind:")
    {
        return format!(
            "Dreamina could not start the local login callback server because the port is already in use. Retry the QR login after old Dreamina or Chrome login processes are closed. Original error: {trimmed}"
        );
    }
    if lowered.contains("command not found") || lowered.contains("is not recognized") {
        return "Dreamina CLI was not found. Install it first with `curl -fsSL https://jimeng.jianying.com/cli | bash`, then run `dreamina login` and verify with `dreamina user_credit`.".to_string();
    }
    if lowered.contains("credential")
        || lowered.contains("unauthorized")
        || lowered.contains("forbidden")
        || lowered.contains("login")
        || lowered.contains("config.toml")
        || lowered.contains("user_credit")
    {
        return format!(
            "Dreamina CLI is not ready. Run `dreamina login` first. For headless auth, run `dreamina login --headless`, then poll with `dreamina login checklogin --device_code=<device_code> --poll=30`. After login, verify with `dreamina user_credit`. You can also check `~/.dreamina_cli/config.toml` and `~/.dreamina_cli/credential.json`. Original error: {trimmed}"
        );
    }
    trimmed.to_string()
}

async fn run_dreamina_json(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
    args: Vec<String>,
) -> Result<Value, String> {
    let command_env = dreamina_process_env(&workspace)?;
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(dreamina_command_target(runtime, &command_env));
    parts.extend(args.iter().map(|arg| bash_quote(arg)));
    let script = format!(
        "{}; {}",
        dreamina_command_prefix(runtime, &command_env),
        parts.join(" ")
    );
    let (success, stdout, stderr) =
        run_git_bash_script(runtime, command_env, workspace.clone(), script).await?;
    if !success {
        let line =
            first_non_empty_dreamina_output(&stdout, &stderr).unwrap_or("Dreamina CLI failed.");
        let command_name = args.first().map(String::as_str).unwrap_or_default();
        let detail = if command_name.eq_ignore_ascii_case("user_credit")
            || is_generic_dreamina_failure(line)
            || looks_like_dreamina_login_failure(line)
        {
            compose_dreamina_login_failure_detail(&workspace, line)
        } else {
            line.to_string()
        };
        return Err(normalize_dreamina_cli_error(&detail));
    }
    let combined = format!("{stdout}\n{stderr}");
    let json_text = extract_json_text(&stdout)
        .or_else(|| extract_json_text(&combined))
        .ok_or_else(|| {
            format!("Dreamina CLI did not return parseable JSON. stdout={stdout} stderr={stderr}")
        })?;
    serde_json::from_str::<Value>(json_text)
        .map_err(|error| format!("failed to parse Dreamina JSON: {error}"))
}

async fn run_dreamina_action(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
    args: Vec<String>,
    success_message: &str,
) -> Result<DreaminaCliActionResponse, String> {
    let command_env = dreamina_process_env(&workspace)?;
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(dreamina_command_target(runtime, &command_env));
    parts.extend(args.iter().map(|arg| bash_quote(arg)));
    let script = format!(
        "{}; {}",
        dreamina_command_prefix(runtime, &command_env),
        parts.join(" ")
    );
    let (success, stdout, stderr) =
        run_git_bash_script(runtime, command_env, workspace.clone(), script).await?;
    if !success {
        let line =
            first_non_empty_dreamina_output(&stdout, &stderr).unwrap_or("Dreamina CLI failed.");
        let command_name = args.first().map(String::as_str).unwrap_or_default();
        let detail = if command_name.eq_ignore_ascii_case("user_credit")
            || is_generic_dreamina_failure(line)
            || looks_like_dreamina_login_failure(line)
        {
            compose_dreamina_login_failure_detail(&workspace, line)
        } else {
            line.to_string()
        };
        return Err(normalize_dreamina_cli_error(&detail));
    }

    let detail = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(DreaminaCliActionResponse {
        message: success_message.to_string(),
        detail: if detail.is_empty() {
            None
        } else {
            Some(detail)
        },
    })
}

async fn run_dreamina_login_checklogin_once(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
    device_code: &str,
    poll_seconds: u64,
) -> Result<(), String> {
    let command_env = dreamina_process_env(&workspace)?;
    let script = format!(
        "{prefix}; {dreamina} login checklogin --device_code={device_code} --poll={poll_seconds}",
        prefix = dreamina_command_prefix(runtime, &command_env),
        dreamina = dreamina_command_target(runtime, &command_env),
        device_code = bash_quote(device_code),
        poll_seconds = poll_seconds
    );
    let (success, stdout, stderr) =
        run_git_bash_script(runtime, command_env, workspace, script).await?;

    if success {
        Ok(())
    } else {
        Err(format_dreamina_script_failure(
            "Dreamina login checklogin",
            &stdout,
            &stderr,
            "Dreamina login checklogin failed.",
        ))
    }
}

fn sanitize_file_name(raw_name: &str, fallback_stem: &str, fallback_extension: &str) -> String {
    let mut sanitized = raw_name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string();
    if sanitized.is_empty() {
        sanitized = format!("{fallback_stem}.{fallback_extension}");
    }
    if Path::new(&sanitized).extension().is_none() {
        sanitized.push('.');
        sanitized.push_str(fallback_extension);
    }
    sanitized
}

fn runtime_submit_download_dir(
    app: &AppHandle,
    kind: &str,
    submit_id: &str,
) -> Result<PathBuf, String> {
    let path = runtime_root(app)?
        .join("query")
        .join(kind)
        .join(submit_id.trim());
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create Dreamina query dir: {error}"))?;
    Ok(path)
}

fn data_url_extension(data_url: &str) -> &'static str {
    let mime = data_url
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/avif" => "avif",
        "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/x-pn-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/webm" => "webm",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/aac" => "aac",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/ogg" => "ogv",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/x-matroska" => "mkv",
        _ => "png",
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, payload)| payload)
        .ok_or_else(|| "invalid data URL payload".to_string())?;
    BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| format!("failed to decode data URL payload: {error}"))
}

fn write_assets(
    request_dir: &Path,
    bucket: &str,
    assets: &[DreaminaReferenceAssetPayload],
    fallback_prefix: &str,
) -> Result<Vec<PathBuf>, String> {
    if assets.is_empty() {
        return Ok(Vec::new());
    }
    let target_dir = request_dir.join("inputs").join(bucket);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("failed to create Dreamina input dir: {error}"))?;
    let mut result = Vec::with_capacity(assets.len());
    for (index, asset) in assets.iter().enumerate() {
        let extension = data_url_extension(&asset.data_url);
        let path = target_dir.join(sanitize_file_name(
            asset.file_name.trim(),
            &format!("{fallback_prefix}-{}", index + 1),
            extension,
        ));
        fs::write(&path, decode_data_url(&asset.data_url)?)
            .map_err(|error| format!("failed to write Dreamina input asset: {error}"))?;
        result.push(path.canonicalize().unwrap_or(path));
    }
    Ok(result)
}

fn normalize_choice(value: Option<&str>, allowed: &[&str]) -> Option<String> {
    let normalized = value?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    allowed
        .iter()
        .find(|candidate| candidate.to_ascii_lowercase() == normalized)
        .map(|candidate| (*candidate).to_string())
}

fn clamp_u32(value: u32, min: u32, max: u32) -> u32 {
    value.max(min).min(max)
}

fn push_arg(args: &mut Vec<String>, flag: &str, value: impl Into<String>) {
    args.push(flag.to_string());
    args.push(value.into());
}

fn image_args(
    payload: &GenerateJimengDreaminaImagesPayload,
    reference_images: &[PathBuf],
) -> Vec<String> {
    let mut args = vec![if reference_images.is_empty() {
        "text2image"
    } else {
        "image2image"
    }
    .to_string()];
    for image in reference_images {
        push_arg(&mut args, "--images", cli_path(image));
    }
    push_arg(&mut args, "--prompt", payload.prompt.trim().to_string());
    if let Some(ratio) = normalize_choice(
        payload.aspect_ratio.as_deref(),
        &["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
    ) {
        push_arg(&mut args, "--ratio", ratio);
    }
    let resolution = match payload
        .resolution_type
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
    {
        Some(value) if value == "1k" && !reference_images.is_empty() => Some("2k".to_string()),
        Some(value) if value == "1k" || value == "2k" || value == "4k" => Some(value),
        _ => None,
    };
    if let Some(resolution) = resolution {
        push_arg(&mut args, "--resolution_type", resolution);
    }
    let image_model_allowed = if reference_images.is_empty() {
        &["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "5.0", "lab"][..]
    } else {
        &["4.0", "4.1", "4.5", "4.6", "5.0", "lab"][..]
    };
    if let Some(model) = normalize_choice(payload.model_version.as_deref(), image_model_allowed) {
        push_arg(&mut args, "--model_version", model);
    }
    push_arg(&mut args, "--poll", "0");
    args
}

fn select_video_command(
    image_count: usize,
    video_count: usize,
    audio_count: usize,
    reference_mode: Option<&str>,
) -> Result<VideoCommand, String> {
    if video_count > 0 {
        if video_count > 3 {
            return Err(
                "Dreamina multimodal2video currently supports at most 3 reference videos."
                    .to_string(),
            );
        }
        return Ok(VideoCommand::Multimodal2Video);
    }

    if image_count == 0 {
        if audio_count > 0 {
            return Err("Dreamina video currently requires at least one reference image or video when audio references are connected.".to_string());
        }
        return Ok(VideoCommand::Text2Video);
    }
    if audio_count > 0 {
        return Ok(VideoCommand::Multimodal2Video);
    }
    if image_count == 1 {
        return Ok(VideoCommand::Image2Video);
    }
    match reference_mode
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "firstlastframe" => Ok(VideoCommand::Frames2Video),
        "allaround" | "subject" => Ok(VideoCommand::Multimodal2Video),
        _ => Ok(VideoCommand::Multiframe2Video),
    }
}

fn multiframe_durations(total_duration: Option<u32>, transition_count: usize) -> Vec<String> {
    if transition_count == 0 {
        return Vec::new();
    }
    let fallback_total = (transition_count as f64 * 3.0).max(2.0);
    let total = total_duration
        .map(|value| value as f64)
        .unwrap_or(fallback_total);
    let per = (total / transition_count as f64).clamp(0.5, 8.0);
    let rounded = (per * 10.0).round() / 10.0;
    let formatted = if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.1}")
    };
    vec![formatted; transition_count]
}

fn video_args(
    payload: &GenerateJimengDreaminaVideosPayload,
    command: VideoCommand,
    reference_images: &[PathBuf],
    reference_videos: &[PathBuf],
    reference_audios: &[PathBuf],
) -> Vec<String> {
    let mut args = vec![command.as_str().to_string()];
    let prompt = payload.prompt.trim().to_string();
    let ratio = normalize_choice(
        payload.aspect_ratio.as_deref(),
        &["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"],
    );
    let text_model = normalize_choice(
        payload.model_version.as_deref(),
        &[
            "seedance2.0",
            "seedance2.0fast",
            "seedance2.0_vip",
            "seedance2.0fast_vip",
        ],
    );
    let frames_model = normalize_choice(
        payload.model_version.as_deref(),
        &[
            "3.0",
            "3.5pro",
            "seedance2.0",
            "seedance2.0fast",
            "seedance2.0_vip",
            "seedance2.0fast_vip",
        ],
    );
    let image_model = normalize_choice(
        payload.model_version.as_deref(),
        &[
            "3.0",
            "3.0fast",
            "3.0pro",
            "3.5pro",
            "seedance2.0",
            "seedance2.0fast",
            "seedance2.0_vip",
            "seedance2.0fast_vip",
        ],
    );
    let resolution = normalize_choice(payload.video_resolution.as_deref(), &["720p", "1080p"]);
    match command {
        VideoCommand::Text2Video => {
            push_arg(&mut args, "--prompt", prompt);
            if let Some(duration) = payload
                .duration_seconds
                .map(|value| clamp_u32(value, 4, 15))
            {
                push_arg(&mut args, "--duration", duration.to_string());
            }
            if let Some(ratio) = ratio {
                push_arg(&mut args, "--ratio", ratio);
            }
            if matches!(resolution.as_deref(), Some("720p")) {
                push_arg(&mut args, "--video_resolution", "720p");
            }
            if let Some(model) = text_model {
                push_arg(&mut args, "--model_version", model);
            }
        }
        VideoCommand::Image2Video => {
            if let Some(first) = reference_images.first() {
                push_arg(&mut args, "--image", cli_path(first));
            }
            push_arg(&mut args, "--prompt", prompt);
            if let Some(model) = image_model.clone() {
                push_arg(&mut args, "--model_version", model.clone());
                let duration = match model.as_str() {
                    "3.0" | "3.0fast" | "3.0pro" => payload
                        .duration_seconds
                        .map(|value| clamp_u32(value, 3, 10)),
                    "3.5pro" => payload
                        .duration_seconds
                        .map(|value| clamp_u32(value, 4, 12)),
                    _ => payload
                        .duration_seconds
                        .map(|value| clamp_u32(value, 4, 15)),
                };
                if let Some(duration) = duration {
                    push_arg(&mut args, "--duration", duration.to_string());
                }
                let allow_1080 = matches!(model.as_str(), "3.0" | "3.0fast" | "3.0pro" | "3.5pro");
                let normalized = match (resolution.as_deref(), allow_1080) {
                    (Some("1080p"), true) => Some("1080p"),
                    (Some("720p"), _) => Some("720p"),
                    _ => None,
                };
                if let Some(video_resolution) = normalized {
                    push_arg(&mut args, "--video_resolution", video_resolution);
                }
            }
        }
        VideoCommand::Frames2Video => {
            if let Some(first) = reference_images.first() {
                push_arg(&mut args, "--first", cli_path(first));
            }
            if let Some(last) = reference_images.last() {
                push_arg(&mut args, "--last", cli_path(last));
            }
            push_arg(&mut args, "--prompt", prompt);
            if let Some(model) = frames_model.clone() {
                push_arg(&mut args, "--model_version", model.clone());
            }
            let range_model = frames_model.as_deref().unwrap_or("seedance2.0fast");
            let duration = match range_model {
                "3.0" => payload
                    .duration_seconds
                    .map(|value| clamp_u32(value, 3, 10)),
                "3.5pro" => payload
                    .duration_seconds
                    .map(|value| clamp_u32(value, 4, 12)),
                _ => payload
                    .duration_seconds
                    .map(|value| clamp_u32(value, 4, 15)),
            };
            if let Some(duration) = duration {
                push_arg(&mut args, "--duration", duration.to_string());
            }
            let allow_1080 = matches!(range_model, "3.0" | "3.5pro");
            let normalized = match (resolution.as_deref(), allow_1080) {
                (Some("1080p"), true) => Some("1080p"),
                (Some("720p"), _) => Some("720p"),
                _ => None,
            };
            if let Some(video_resolution) = normalized {
                push_arg(&mut args, "--video_resolution", video_resolution);
            }
        }
        VideoCommand::Multiframe2Video => {
            for image in reference_images {
                push_arg(&mut args, "--images", cli_path(image));
            }
            if reference_images.len() <= 2 {
                push_arg(&mut args, "--prompt", prompt);
                if let Some(duration) = payload.duration_seconds {
                    let value = (duration as f64).clamp(2.0, 8.0);
                    let formatted = if value.fract() == 0.0 {
                        format!("{}", value as i64)
                    } else {
                        format!("{value:.1}")
                    };
                    push_arg(&mut args, "--duration", formatted);
                }
            } else {
                let count = reference_images.len().saturating_sub(1);
                for _ in 0..count {
                    push_arg(&mut args, "--transition-prompt", prompt.clone());
                }
                for duration in multiframe_durations(payload.duration_seconds, count) {
                    push_arg(&mut args, "--transition-duration", duration);
                }
            }
        }
        VideoCommand::Multimodal2Video => {
            for image in reference_images {
                push_arg(&mut args, "--image", cli_path(image));
            }
            for video in reference_videos {
                push_arg(&mut args, "--video", cli_path(video));
            }
            for audio in reference_audios {
                push_arg(&mut args, "--audio", cli_path(audio));
            }
            if !prompt.is_empty() {
                push_arg(&mut args, "--prompt", prompt);
            }
            if let Some(duration) = payload
                .duration_seconds
                .map(|value| clamp_u32(value, 4, 15))
            {
                push_arg(&mut args, "--duration", duration.to_string());
            }
            if let Some(ratio) = ratio {
                push_arg(&mut args, "--ratio", ratio);
            }
            if matches!(resolution.as_deref(), Some("720p")) {
                push_arg(&mut args, "--video_resolution", "720p");
            }
            if let Some(model) = text_model {
                push_arg(&mut args, "--model_version", model);
            }
        }
    }
    push_arg(&mut args, "--poll", "0");
    args
}

fn parse_submit_id(value: &Value) -> Result<String, String> {
    if let Some(reason) = value.get("fail_reason").and_then(Value::as_str) {
        if !reason.trim().is_empty() {
            return Err(reason.trim().to_string());
        }
    }
    let submit_id = value
        .get("submit_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if submit_id.is_empty() {
        return Err(format!(
            "Dreamina generation response did not include submit_id: {value}"
        ));
    }
    if value
        .get("gen_status")
        .and_then(Value::as_str)
        .map(|status| status.eq_ignore_ascii_case("fail"))
        .unwrap_or(false)
    {
        return Err(format!("Dreamina generation task failed: {value}"));
    }
    Ok(submit_id.to_string())
}

async fn submit_dreamina(
    app: &AppHandle,
    workspace: PathBuf,
    args: Vec<String>,
) -> Result<String, String> {
    let runtime = resolve_git_bash_runtime(app)?;
    parse_submit_id(&run_dreamina_json(workspace, &runtime, args).await?)
}

async fn submit_jimeng_dreamina_image_requests(
    app: &AppHandle,
    payload: &GenerateJimengDreaminaImagesPayload,
) -> Result<(PathBuf, Vec<PendingDreaminaSubmit>, Vec<String>), String> {
    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required for Dreamina image generation.".to_string());
    }

    let workspace = dreamina_workspace(app)?;
    let request_dir = runtime_root(app)?
        .join("image")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&request_dir)
        .map_err(|error| format!("failed to create Dreamina image request dir: {error}"))?;
    let reference_images = payload.reference_images.clone().unwrap_or_default();
    let reference_paths = write_assets(&request_dir, "images", &reference_images, "jimeng-image")?;
    let count = payload
        .image_count
        .unwrap_or(DEFAULT_IMAGE_COUNT)
        .clamp(1, MAX_IMAGE_COUNT);
    let args = image_args(payload, &reference_paths);

    let mut pending = Vec::with_capacity(count);
    let mut submit_ids = Vec::with_capacity(count);
    for index in 0..count {
        let submit_id = submit_dreamina(app, workspace.clone(), args.clone()).await?;
        let download_dir = request_dir.join("downloads").join(&submit_id);
        fs::create_dir_all(&download_dir)
            .map_err(|error| format!("failed to create Dreamina image download dir: {error}"))?;
        submit_ids.push(submit_id.clone());
        pending.push(PendingDreaminaSubmit {
            request_index: index,
            submit_id,
            download_dir,
        });
    }

    Ok((workspace, pending, submit_ids))
}

async fn submit_jimeng_dreamina_video_request(
    app: &AppHandle,
    payload: &GenerateJimengDreaminaVideosPayload,
) -> Result<(PathBuf, PendingDreaminaSubmit), String> {
    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required for Dreamina video generation.".to_string());
    }

    let workspace = dreamina_workspace(app)?;
    let request_dir = runtime_root(app)?
        .join("video")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&request_dir)
        .map_err(|error| format!("failed to create Dreamina video request dir: {error}"))?;
    let reference_images = payload.reference_images.clone().unwrap_or_default();
    let reference_videos = payload.reference_videos.clone().unwrap_or_default();
    let reference_audios = payload.reference_audios.clone().unwrap_or_default();
    let image_paths = write_assets(
        &request_dir,
        "images",
        &reference_images,
        "jimeng-video-image",
    )?;
    let video_paths = write_assets(
        &request_dir,
        "videos",
        &reference_videos,
        "jimeng-video-reference",
    )?;
    let audio_paths = write_assets(
        &request_dir,
        "audios",
        &reference_audios,
        "jimeng-video-audio",
    )?;
    let command = select_video_command(
        image_paths.len(),
        video_paths.len(),
        audio_paths.len(),
        payload.reference_mode.as_deref(),
    )?;
    let submit_id = submit_dreamina(
        app,
        workspace.clone(),
        video_args(payload, command, &image_paths, &video_paths, &audio_paths),
    )
    .await?;
    let download_dir = request_dir.join("downloads").join(&submit_id);
    fs::create_dir_all(&download_dir)
        .map_err(|error| format!("failed to create Dreamina video download dir: {error}"))?;

    Ok((
        workspace,
        PendingDreaminaSubmit {
            request_index: 0,
            submit_id,
            download_dir,
        },
    ))
}

async fn query_dreamina(
    app: &AppHandle,
    workspace: PathBuf,
    submit_id: &str,
    download_dir: &Path,
) -> Result<Option<Value>, String> {
    let runtime = resolve_git_bash_runtime(app)?;
    let args = vec![
        "query_result".to_string(),
        "--submit_id".to_string(),
        submit_id.to_string(),
        "--download_dir".to_string(),
        cli_path(download_dir),
    ];
    match run_dreamina_json(workspace, &runtime, args).await {
        Ok(value) => {
            let status = value
                .get("gen_status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if status.eq_ignore_ascii_case("success") {
                Ok(Some(value))
            } else if status.eq_ignore_ascii_case("fail") {
                Err(format!("Dreamina task {submit_id} failed: {value}"))
            } else {
                Ok(None)
            }
        }
        Err(error) if error.contains("not found") => Ok(None),
        Err(error) => Err(error),
    }
}

fn file_name_from_path(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

fn value_as_u32(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|number| u32::try_from(number).ok())
}

fn value_to_summary_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        _ => None,
    }
}

fn find_value_by_keys<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key) {
                    return Some(found);
                }
            }

            for nested in map.values() {
                if let Some(found) = find_value_by_keys(nested, keys) {
                    return Some(found);
                }
            }

            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_value_by_keys(item, keys)),
        _ => None,
    }
}

fn summarize_user_credit(value: &Value) -> Option<String> {
    let user = find_value_by_keys(
        value,
        &[
            "username",
            "user_name",
            "nickname",
            "display_name",
            "name",
            "uid",
            "user_id",
        ],
    )
    .and_then(value_to_summary_text);
    let credit = find_value_by_keys(
        value,
        &[
            "credit",
            "credits",
            "credit_balance",
            "balance",
            "user_credit",
            "remain_credit",
            "remaining_credit",
            "available_credit",
        ],
    )
    .and_then(value_to_summary_text);

    match (user, credit) {
        (Some(user), Some(credit)) => Some(format!("Account {user} | Credits {credit}")),
        (Some(user), None) => Some(format!("Account {user}")),
        (None, Some(credit)) => Some(format!("Credits {credit}")),
        (None, None) => None,
    }
}

fn image_media(value: &Value) -> Vec<(String, Option<u32>, Option<u32>, Option<String>)> {
    value
        .get("result_json")
        .and_then(|result| result.get("images"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let path = item.get("path").and_then(Value::as_str)?.trim().to_string();
                    if path.is_empty() {
                        return None;
                    }
                    Some((
                        path.clone(),
                        item.get("width").and_then(value_as_u32),
                        item.get("height").and_then(value_as_u32),
                        file_name_from_path(&path),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn video_media(
    value: &Value,
) -> Vec<(
    String,
    Option<u32>,
    Option<u32>,
    Option<f64>,
    Option<String>,
)> {
    value
        .get("result_json")
        .and_then(|result| result.get("videos"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let path = item.get("path").and_then(Value::as_str)?.trim().to_string();
                    if path.is_empty() {
                        return None;
                    }
                    Some((
                        path.clone(),
                        item.get("width").and_then(value_as_u32),
                        item.get("height").and_then(value_as_u32),
                        item.get("duration").and_then(Value::as_f64),
                        file_name_from_path(&path),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn emit_dreamina_setup_progress(
    app: &AppHandle,
    stage: DreaminaSetupProgressStage,
    progress: u8,
    git_source: Option<DreaminaGitSource>,
    detail: Option<String>,
    login_qr_data_url: Option<String>,
    login_page_url: Option<String>,
) {
    let event = DreaminaSetupProgressEvent {
        stage,
        progress,
        git_source,
        detail,
        login_qr_data_url,
        login_page_url,
    };
    if let Err(error) = app.emit(DREAMINA_SETUP_PROGRESS_EVENT, &event) {
        warn!("failed to emit Dreamina setup progress: {error}");
    }
}

async fn resolve_dreamina_cli_status_with_runtime(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
) -> DreaminaCliStatusResponse {
    match run_dreamina_json(workspace.clone(), runtime, vec!["user_credit".to_string()]).await {
        Ok(value) => DreaminaCliStatusResponse::new(
            DreaminaCliStatusCode::Ready,
            "Dreamina CLI is ready.",
            summarize_user_credit(&value)
                .or_else(|| Some("`dreamina user_credit` check passed.".to_string())),
        ),
        Err(error) => {
            let mut code = classify_dreamina_status_code(&error);
            let mut detail = error;

            if let Some(session_detail) = dreamina_credential_session_detail(&workspace) {
                if matches!(code, DreaminaCliStatusCode::Unknown) {
                    code = DreaminaCliStatusCode::LoginRequired;
                }
                if !detail.contains(&session_detail) {
                    detail.push_str("\n\n");
                    detail.push_str(&session_detail);
                }
            }

            if matches!(code, DreaminaCliStatusCode::Unknown)
                || is_generic_dreamina_failure(&detail)
            {
                if let Some(internal_detail) = dreamina_login_internal_failure_detail(&workspace, 8)
                {
                    code = DreaminaCliStatusCode::LoginRequired;
                    if !detail.contains(&internal_detail) {
                        detail.push_str("\n\n");
                        detail.push_str(&internal_detail);
                    }
                }
            }

            DreaminaCliStatusResponse::new(code, "Dreamina CLI is not ready.", Some(detail))
        }
    }
}

async fn resolve_dreamina_cli_status(app: &AppHandle) -> DreaminaCliStatusResponse {
    let workspace = match dreamina_workspace(app) {
        Ok(workspace) => workspace,
        Err(error) => {
            return DreaminaCliStatusResponse::new(
                DreaminaCliStatusCode::Unknown,
                "Dreamina CLI is not ready.",
                Some(error),
            );
        }
    };

    let runtime = match resolve_git_bash_runtime(app) {
        Ok(runtime) => runtime,
        Err(error) => {
            return DreaminaCliStatusResponse::new(
                DreaminaCliStatusCode::GitBashMissing,
                "Dreamina CLI is not ready.",
                Some(error),
            );
        }
    };

    resolve_dreamina_cli_status_with_runtime(workspace, &runtime).await
}

async fn resolve_dreamina_cli_update_info(
    app: &AppHandle,
) -> Result<DreaminaCliUpdateInfoResponse, String> {
    let workspace = dreamina_workspace(app)?;
    let runtime = resolve_git_bash_runtime(app)?;
    let command_env = dreamina_process_env(&workspace)?;
    let active_binary = resolve_active_dreamina_binary(&runtime, &command_env);
    let manifest = bundled_dreamina_manifest(&runtime);

    let latest_record = fetch_dreamina_latest_version_record(manifest.as_ref()).await;
    let latest_version = latest_record
        .as_ref()
        .ok()
        .and_then(|record| normalize_version_option(record.version.as_deref()));
    let release_date = latest_record
        .as_ref()
        .ok()
        .and_then(|record| record.release_date.clone())
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|value| value.release_date.clone())
        });
    let release_notes = latest_record
        .as_ref()
        .ok()
        .and_then(|record| record.release_notes.clone())
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|value| value.release_notes.clone())
        });
    let has_update = match (
        active_binary.current_version.as_deref(),
        latest_version.as_deref(),
    ) {
        (Some(current), Some(latest)) => {
            compare_versions(latest, current) == std::cmp::Ordering::Greater
        }
        _ => false,
    };
    let check_error = latest_record.err();

    Ok(DreaminaCliUpdateInfoResponse {
        active_source: active_binary.source,
        current_version: active_binary.current_version,
        bundled_version: active_binary.bundled_version,
        latest_version,
        release_date,
        release_notes,
        has_update,
        check_error,
    })
}

async fn install_dreamina_cli_with_runtime(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
) -> Result<DreaminaCliActionResponse, String> {
    if let Some(bin_dir) = runtime.dreamina_bin_dir.as_ref() {
        let bundled_binary = bin_dir.join(DREAMINA_BUNDLED_BIN_NAME);
        if bundled_binary.is_file() {
            return Ok(DreaminaCliActionResponse {
                message: "Bundled Dreamina CLI is already available. Continue with login."
                    .to_string(),
                detail: Some(format!(
                    "Using bundled Dreamina CLI at {}",
                    bundled_binary.display()
                )),
            });
        }
    }

    let command_env = dreamina_process_env(&workspace)?;
    let had_install_artifacts = dreamina_cli_install_artifacts_ready(&command_env);
    let (success, stdout, stderr) = run_git_bash_script(
        runtime,
        command_env.clone(),
        workspace,
        install_dreamina_script(runtime, &command_env),
    )
    .await?;
    if !success {
        let install_artifacts_ready = dreamina_cli_install_artifacts_ready(&command_env);
        if !had_install_artifacts && install_artifacts_ready {
            let detail = format_dreamina_script_failure(
                "Dreamina install",
                &stdout,
                &stderr,
                "Dreamina CLI installation completed with a non-fatal warning.",
            );
            return Ok(DreaminaCliActionResponse {
                message:
                    "Dreamina CLI installation completed. Recheck the environment, then continue with login."
                        .to_string(),
                detail: Some(detail),
            });
        }
        return Err(format_dreamina_script_failure(
            "Dreamina install",
            &stdout,
            &stderr,
            "Dreamina CLI installation failed.",
        ));
    }

    Ok(DreaminaCliActionResponse {
        message:
            "Dreamina CLI installation completed. Recheck the environment, then continue with login."
                .to_string(),
        detail: None,
    })
}

async fn update_dreamina_cli_with_runtime(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
) -> Result<DreaminaCliActionResponse, String> {
    let command_env = dreamina_process_env(&workspace)?;
    terminate_conflicting_dreamina_processes(runtime, &command_env).await?;

    let before_version =
        installed_dreamina_version(&command_env).or_else(|| bundled_dreamina_version(runtime));
    let (success, stdout, stderr) = run_git_bash_script(
        runtime,
        command_env.clone(),
        workspace.clone(),
        update_dreamina_script(runtime, &command_env),
    )
    .await?;
    let after_version =
        installed_dreamina_version(&command_env).or_else(|| bundled_dreamina_version(runtime));
    if !success {
        let update_effective = match (before_version.as_deref(), after_version.as_deref()) {
            (Some(before), Some(after)) => {
                compare_versions(after, before) == std::cmp::Ordering::Greater
            }
            (None, Some(_)) => true,
            _ => false,
        };

        if !update_effective {
            return Err(format_dreamina_script_failure(
                "Dreamina update",
                &stdout,
                &stderr,
                "Dreamina CLI update failed.",
            ));
        }
    }

    let detail = match (before_version.as_deref(), after_version.as_deref()) {
        (Some(before), Some(after)) if before != after => {
            Some(format!("Dreamina CLI updated from v{before} to v{after}."))
        }
        (None, Some(after)) => Some(format!("Dreamina CLI is now available at v{after}.")),
        (Some(version), Some(_)) => Some(format!("Dreamina CLI is already on v{version}.")),
        _ => None,
    };

    let detail = if success {
        detail
    } else {
        let warning = format_dreamina_script_failure(
            "Dreamina update",
            &stdout,
            &stderr,
            "Dreamina CLI update completed with a non-fatal warning.",
        );
        Some(match detail {
            Some(detail) => format!("{detail}\n\n{warning}"),
            None => warning,
        })
    };

    Ok(DreaminaCliActionResponse {
        message: "Dreamina CLI update completed.".to_string(),
        detail,
    })
}

async fn open_dreamina_login_terminal_with_runtime(
    workspace: PathBuf,
    runtime: &GitBashRuntime,
) -> Result<DreaminaCliActionResponse, String> {
    let command_env = dreamina_process_env(&workspace)?;
    terminate_conflicting_dreamina_processes(runtime, &command_env).await?;
    let remaining_port_owners = query_dreamina_callback_port_owners().await?;
    let callback_port_notice = if remaining_port_owners.is_empty() {
        None
    } else {
        Some(format_dreamina_callback_port_owner_detail(
            &remaining_port_owners,
        ))
    };
    let script = dreamina_login_headless_script(runtime, &command_env);
    let bash_path = runtime.bash_path.clone();
    let log_path = dreamina_login_log_path(&workspace);
    let qr_path = dreamina_login_qr_path(&workspace);
    let spawned_log_path = log_path.clone();
    let spawned_qr_path = qr_path.clone();
    let spawned_command_env = command_env.clone();

    tokio::task::spawn_blocking(move || {
        let _ = fs::remove_file(&spawned_qr_path);
        let log_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&spawned_log_path)
            .map_err(|error| format!("failed to open Dreamina login log: {error}"))?;
        let stderr_file = log_file
            .try_clone()
            .map_err(|error| format!("failed to clone Dreamina login log handle: {error}"))?;

        let mut command = Command::new(bash_path);
        command
            .current_dir(&workspace)
            .env("USERPROFILE", &spawned_command_env.user_profile)
            .env("HOME", &spawned_command_env.user_profile)
            .env(
                "HOMEDRIVE",
                home_drive_from_windows_path(&spawned_command_env.user_profile),
            )
            .env(
                "HOMEPATH",
                home_path_from_windows_path(&spawned_command_env.user_profile),
            )
            .env("APPDATA", &spawned_command_env.app_data_dir)
            .env("LOCALAPPDATA", &spawned_command_env.local_app_data_dir)
            .env("TEMP", &spawned_command_env.temp_dir)
            .env("TMP", &spawned_command_env.temp_dir)
            .stdin(Stdio::null())
            .arg("--noprofile")
            .arg("--norc")
            .arg("-lc")
            .arg(script)
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(stderr_file));
        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("failed to open Dreamina login terminal: {error}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("failed to await Dreamina login terminal launch: {error}"))??;

    Ok(DreaminaCliActionResponse {
        message:
            "Dreamina headless login flow started. Complete the authorization step shown in the app, then the app will continue polling automatically."
                .to_string(),
        detail: Some(match callback_port_notice {
            Some(notice) => format!(
                "Dreamina login output is being written to {} and the QR image (if produced by this CLI version) will be saved to {}.\n\n{}",
                log_path.display(),
                qr_path.display(),
                notice
            ),
            None => format!(
                "Dreamina login output is being written to {} and the QR image (if produced by this CLI version) will be saved to {}.",
                log_path.display(),
                qr_path.display()
            ),
        }),
    })
}

async fn wait_for_dreamina_login(
    app: &AppHandle,
    workspace: &Path,
    runtime: &GitBashRuntime,
) -> (DreaminaCliStatusResponse, bool) {
    let started_at = Instant::now();
    let deadline = started_at + Duration::from_millis(DREAMINA_LOGIN_WAIT_TIMEOUT_MS);
    let mut qr_deadline = started_at + Duration::from_millis(DREAMINA_QR_READY_TIMEOUT_MS);
    let mut qr_seen = false;
    let mut verify_started_at: Option<Instant> = None;
    let mut auto_relaunch_count = 0u8;
    let mut last_device_checklogin_at: Option<Instant> = None;

    loop {
        let now = Instant::now();
        let login_page_url = dreamina_login_page_url(workspace);
        let login_device_code = dreamina_login_device_code(workspace);
        let device_poll_interval_ms = dreamina_login_poll_interval_ms(workspace)
            .unwrap_or(DREAMINA_LOGIN_POLL_INTERVAL_MS)
            .clamp(500, 10_000);
        let device_flow_ready = login_page_url.is_some() && login_device_code.is_some();
        let qr_file_ready = dreamina_login_qr_file_path(workspace).is_some();
        let login_qr_data_url = dreamina_login_qr_data_url(workspace);
        qr_seen |= qr_file_ready || login_qr_data_url.is_some();
        if verify_started_at.is_none() && dreamina_login_confirmed(workspace) {
            verify_started_at = Some(now);
        }

        if let Some(device_code) = login_device_code.as_deref() {
            let should_check = last_device_checklogin_at
                .map(|last| now.saturating_duration_since(last).as_millis() as u64 >= device_poll_interval_ms)
                .unwrap_or(true);
            if should_check {
                last_device_checklogin_at = Some(now);
                let _ = run_dreamina_login_checklogin_once(
                    workspace.to_path_buf(),
                    runtime,
                    device_code,
                    0,
                )
                .await;
            }
        }

        let status =
            resolve_dreamina_cli_status_with_runtime(workspace.to_path_buf(), runtime).await;
        if let Some(detail) = dreamina_login_membership_required_detail(workspace) {
            return (
                DreaminaCliStatusResponse::new(
                    DreaminaCliStatusCode::MembershipRequired,
                    "Dreamina premium membership is required for CLI login.",
                    Some(detail),
                ),
                false,
            );
        }
        if status.ready {
            return (status, false);
        }

        if !qr_seen
            && verify_started_at.is_none()
            && !device_flow_ready
            && auto_relaunch_count < 2
            && dreamina_login_callback_port_busy(workspace)
        {
            auto_relaunch_count += 1;
            emit_dreamina_setup_progress(
                app,
                DreaminaSetupProgressStage::OpeningLogin,
                74,
                Some(runtime.source),
                Some(format!(
                    "Dreamina's local callback port was still occupied. Retrying QR login ({}/2)...",
                    auto_relaunch_count
                )),
                None,
                login_page_url.clone(),
            );

            if let Err(error) =
                open_dreamina_login_terminal_with_runtime(workspace.to_path_buf(), runtime).await
            {
                let detail = format!(
                    "Dreamina could not restart the QR login flow after a callback-port conflict: {error}"
                );
                return (
                    DreaminaCliStatusResponse::new(
                        DreaminaCliStatusCode::LoginRequired,
                        "Dreamina login QR code did not appear.",
                        Some(detail),
                    ),
                    false,
                );
            }

            qr_deadline = Instant::now() + Duration::from_millis(DREAMINA_QR_READY_TIMEOUT_MS);
            qr_seen = false;
            sleep(Duration::from_millis(1200)).await;
            continue;
        }

        if let Some(verify_started_at) = verify_started_at {
            let verify_deadline =
                verify_started_at + Duration::from_millis(DREAMINA_LOGIN_VERIFY_TIMEOUT_MS);
            if now >= verify_deadline {
                let status = DreaminaCliStatusResponse {
                    detail: status.detail.clone().or_else(|| {
                        Some(
                            "Dreamina reported that the QR login already succeeded, but the local session still did not pass `dreamina user_credit`. Please retry once after a short wait."
                                .to_string(),
                        )
                    }),
                    ..status
                };
                return (status, true);
            }

            let verify_elapsed_ms = verify_started_at.elapsed().as_millis() as u64;
            let verify_progress = 95_u64
                + verify_elapsed_ms
                    .saturating_mul(4)
                    .checked_div(DREAMINA_LOGIN_VERIFY_TIMEOUT_MS)
                    .unwrap_or(0);
            emit_dreamina_setup_progress(
                app,
                DreaminaSetupProgressStage::Verifying,
                verify_progress.min(99) as u8,
                Some(runtime.source),
                dreamina_login_wait_detail(workspace),
                login_qr_data_url,
                login_page_url.clone(),
            );
            sleep(Duration::from_millis(DREAMINA_LOGIN_POLL_INTERVAL_MS)).await;
            continue;
        }

        if !qr_seen && !device_flow_ready && now >= qr_deadline {
            let detail = dreamina_login_wait_detail(workspace).or_else(|| {
                Some(
                    "Dreamina did not render a login QR code in time. Please retry to refresh the QR code."
                        .to_string(),
                )
            });
            return (
                DreaminaCliStatusResponse::new(
                    DreaminaCliStatusCode::LoginRequired,
                    "Dreamina login QR code did not appear.",
                    detail,
                ),
                false,
            );
        }

        if now >= deadline {
            let status = DreaminaCliStatusResponse {
                detail: status
                    .detail
                    .clone()
                    .or_else(|| dreamina_login_wait_detail(workspace)),
                ..status
            };
            return (status, true);
        }

        let elapsed_ms = started_at.elapsed().as_millis() as u64;
        let waiting_span = 16_u64;
        let progress = 78_u64
            + elapsed_ms
                .saturating_mul(waiting_span)
                .checked_div(DREAMINA_LOGIN_WAIT_TIMEOUT_MS)
                .unwrap_or(0);
        emit_dreamina_setup_progress(
            app,
            DreaminaSetupProgressStage::WaitingForLogin,
            progress.min(94) as u8,
            Some(runtime.source),
            dreamina_login_wait_detail(workspace),
            login_qr_data_url,
            login_page_url,
        );
        sleep(Duration::from_millis(DREAMINA_LOGIN_POLL_INTERVAL_MS)).await;
    }
}

#[tauri::command]
pub async fn run_dreamina_guided_setup(
    app: AppHandle,
) -> Result<DreaminaGuidedSetupResponse, String> {
    emit_dreamina_setup_progress(
        &app,
        DreaminaSetupProgressStage::Checking,
        8,
        None,
        None,
        None,
        None,
    );

    let workspace = dreamina_workspace(&app)?;
    let runtime = resolve_git_bash_runtime(&app)?;
    let command_env = dreamina_process_env(&workspace)?;
    let manifest = bundled_dreamina_manifest(&runtime);
    emit_dreamina_setup_progress(
        &app,
        DreaminaSetupProgressStage::PreparingGit,
        24,
        Some(runtime.source),
        None,
        None,
        None,
    );

    let mut status = resolve_dreamina_cli_status_with_runtime(workspace.clone(), &runtime).await;
    let mut login_terminal_opened = false;
    let mut login_wait_timed_out = false;
    let latest_dreamina_record = fetch_dreamina_latest_version_record(manifest.as_ref())
        .await
        .ok();
    let mut prelogin_update_error: Option<String> = None;

    if matches!(status.code, DreaminaCliStatusCode::CliMissing) {
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::InstallingCli,
            46,
            Some(runtime.source),
            None,
            None,
            None,
        );
        install_dreamina_cli_with_runtime(workspace.clone(), &runtime).await?;
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::Verifying,
            66,
            Some(runtime.source),
            None,
            None,
            None,
        );
        status = resolve_dreamina_cli_status_with_runtime(workspace.clone(), &runtime).await;
        if matches!(status.code, DreaminaCliStatusCode::CliMissing) {
            return Err(
                "Dreamina CLI installation finished, but the `dreamina` command is still missing."
                    .to_string(),
            );
        }
    }

    if matches!(
        status.code,
        DreaminaCliStatusCode::LoginRequired | DreaminaCliStatusCode::Unknown
    ) {
        if let Some(update_hint) = dreamina_outdated_login_hint(
            &runtime,
            &command_env,
            latest_dreamina_record.as_ref(),
        ) {
            emit_dreamina_setup_progress(
                &app,
                DreaminaSetupProgressStage::InstallingCli,
                56,
                Some(runtime.source),
                Some(format!(
                    "Updating Dreamina CLI before login. {update_hint}"
                )),
                None,
                None,
            );

            match update_dreamina_cli_with_runtime(workspace.clone(), &runtime).await {
                Ok(update_result) => {
                    emit_dreamina_setup_progress(
                        &app,
                        DreaminaSetupProgressStage::Verifying,
                        68,
                        Some(runtime.source),
                        update_result.detail.clone(),
                        None,
                        None,
                    );
                    status =
                        resolve_dreamina_cli_status_with_runtime(workspace.clone(), &runtime).await;
                }
                Err(error) => {
                    prelogin_update_error = Some(error);
                }
            }
        }
    }

    if matches!(status.code, DreaminaCliStatusCode::LoginRequired) {
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::OpeningLogin,
            72,
            Some(runtime.source),
            Some("Dreamina is preparing the official QR-code login flow.".to_string()),
            None,
            None,
        );
        open_dreamina_login_terminal_with_runtime(workspace.clone(), &runtime).await?;
        login_terminal_opened = true;
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::WaitingForLogin,
            78,
            Some(runtime.source),
            Some(
                "Scan the QR code below with Douyin, then confirm the login on your phone."
                    .to_string(),
            ),
            dreamina_login_qr_data_url(&workspace),
            dreamina_login_page_url(&workspace),
        );
        let (next_status, timed_out) = wait_for_dreamina_login(&app, &workspace, &runtime).await;
        status = next_status;
        login_wait_timed_out = timed_out;
    }

    if !status.ready {
        if let Some(error) = prelogin_update_error.take() {
            append_detail_section(
                &mut status.detail,
                format!("Automatic Dreamina CLI update failed before login:\n{error}"),
            );
        }
        if let Some(update_hint) = dreamina_outdated_login_hint(
            &runtime,
            &command_env,
            latest_dreamina_record.as_ref(),
        ) {
            append_detail_section(&mut status.detail, update_hint);
        }
    }

    if status.ready {
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::Verifying,
            96,
            Some(runtime.source),
            None,
            None,
            None,
        );
        emit_dreamina_setup_progress(
            &app,
            DreaminaSetupProgressStage::Completed,
            100,
            Some(runtime.source),
            None,
            None,
            None,
        );
    }

    Ok(DreaminaGuidedSetupResponse {
        status,
        git_source: Some(runtime.source),
        login_terminal_opened,
        login_wait_timed_out,
    })
}

#[tauri::command]
pub async fn check_dreamina_cli_status(
    app: AppHandle,
) -> Result<DreaminaCliStatusResponse, String> {
    Ok(resolve_dreamina_cli_status(&app).await)
}

#[tauri::command]
pub async fn check_dreamina_cli_update(
    app: AppHandle,
) -> Result<DreaminaCliUpdateInfoResponse, String> {
    resolve_dreamina_cli_update_info(&app).await
}

#[tauri::command]
pub async fn install_dreamina_cli(app: AppHandle) -> Result<DreaminaCliActionResponse, String> {
    let workspace = dreamina_workspace(&app)?;
    let runtime = resolve_git_bash_runtime(&app)?;
    install_dreamina_cli_with_runtime(workspace, &runtime).await
}

#[tauri::command]
pub async fn update_dreamina_cli(app: AppHandle) -> Result<DreaminaCliActionResponse, String> {
    let workspace = dreamina_workspace(&app)?;
    let runtime = resolve_git_bash_runtime(&app)?;
    update_dreamina_cli_with_runtime(workspace, &runtime).await
}

#[tauri::command]
pub async fn open_dreamina_login_terminal(
    app: AppHandle,
) -> Result<DreaminaCliActionResponse, String> {
    if !cfg!(target_os = "windows") {
        return Err(
            "Dreamina login terminal launcher is only available on Windows builds right now."
                .to_string(),
        );
    }

    let workspace = dreamina_workspace(&app)?;
    let runtime = resolve_git_bash_runtime(&app)?;
    open_dreamina_login_terminal_with_runtime(workspace, &runtime).await
}

#[tauri::command]
pub async fn logout_dreamina_cli(app: AppHandle) -> Result<DreaminaCliActionResponse, String> {
    let workspace = dreamina_workspace(&app)?;
    let runtime = resolve_git_bash_runtime(&app)?;
    let command_env = dreamina_process_env(&workspace)?;
    terminate_conflicting_dreamina_processes(&runtime, &command_env).await?;

    let response = run_dreamina_action(
        workspace.clone(),
        &runtime,
        vec!["logout".to_string()],
        "Dreamina local login session was cleared.",
    )
    .await?;

    clear_dreamina_login_artifacts(&workspace);
    Ok(response)
}

#[tauri::command]
pub async fn generate_jimeng_dreamina_images(
    app: AppHandle,
    payload: GenerateJimengDreaminaImagesPayload,
) -> Result<JimengDreaminaImageGenerationResponse, String> {
    let (workspace, mut pending, submit_ids) =
        submit_jimeng_dreamina_image_requests(&app, &payload).await?;

    let deadline =
        Instant::now() + Duration::from_millis(payload.timeout_ms.unwrap_or(IMAGE_TIMEOUT_MS));
    let mut completed = Vec::new();
    let mut failures = Vec::new();

    while !pending.is_empty() && Instant::now() < deadline {
        let current_pending = std::mem::take(&mut pending);
        let mut next_pending = Vec::new();
        for submit in current_pending {
            match query_dreamina(
                &app,
                workspace.clone(),
                &submit.submit_id,
                &submit.download_dir,
            )
            .await
            {
                Ok(Some(value)) => {
                    for (media_index, media) in image_media(&value).into_iter().enumerate() {
                        completed.push((submit.request_index, media_index, media));
                    }
                }
                Ok(None) => next_pending.push(submit),
                Err(error) => {
                    warn!(
                        "Dreamina image submit {} failed: {}",
                        submit.submit_id, error
                    );
                    failures.push(format!("{}: {}", submit.submit_id, error));
                }
            }
        }
        if next_pending.is_empty() {
            break;
        }
        pending = next_pending;
        sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
    }

    if !pending.is_empty() {
        failures.extend(pending.into_iter().map(|submit| format!(
            "{}: timed out while waiting for Dreamina image result. You can retry later with `dreamina query_result --submit_id={}`.",
            submit.submit_id,
            submit.submit_id
        )));
    }

    completed.sort_by_key(|(submit_index, media_index, _)| (*submit_index, *media_index));
    let mut results = completed
        .into_iter()
        .enumerate()
        .map(|(index, (_, _, (source_url, width, height, file_name)))| {
            JimengDreaminaGeneratedImageResult {
                index,
                source_url,
                width,
                height,
                file_name,
            }
        })
        .collect::<Vec<_>>();
    if results.len() > MAX_IMAGE_COUNT {
        results.truncate(MAX_IMAGE_COUNT);
    }
    if results.is_empty() {
        let detail = failures.join(" | ");
        return Err(if detail.is_empty() {
            "Dreamina image generation did not return any downloadable results.".to_string()
        } else {
            format!("Dreamina image generation did not return any downloadable results. {detail}")
        });
    }
    Ok(JimengDreaminaImageGenerationResponse {
        results,
        submit_ids,
    })
}

#[tauri::command]
pub async fn generate_jimeng_dreamina_videos(
    app: AppHandle,
    payload: GenerateJimengDreaminaVideosPayload,
) -> Result<JimengDreaminaVideoGenerationResponse, String> {
    let (workspace, pending_submit) = submit_jimeng_dreamina_video_request(&app, &payload).await?;
    let submit_id = pending_submit.submit_id.clone();
    let download_dir = pending_submit.download_dir;

    let deadline =
        Instant::now() + Duration::from_millis(payload.timeout_ms.unwrap_or(VIDEO_TIMEOUT_MS));
    let final_value = loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out while waiting for Dreamina video result: {}. You can retry later with `dreamina query_result --submit_id={}`.",
                submit_id,
                submit_id
            ));
        }
        match query_dreamina(&app, workspace.clone(), &submit_id, &download_dir).await? {
            Some(value) => break value,
            None => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
        }
    };

    let results = video_media(&final_value)
        .into_iter()
        .enumerate()
        .map(
            |(index, (source_url, width, height, duration_seconds, file_name))| {
                JimengDreaminaGeneratedVideoResult {
                    index,
                    source_url,
                    width,
                    height,
                    duration_seconds,
                    file_name,
                }
            },
        )
        .collect::<Vec<_>>();
    if results.is_empty() {
        return Err(
            "Dreamina video generation did not return any downloadable results.".to_string(),
        );
    }
    Ok(JimengDreaminaVideoGenerationResponse { results, submit_id })
}

#[tauri::command]
pub async fn submit_jimeng_dreamina_images(
    app: AppHandle,
    payload: GenerateJimengDreaminaImagesPayload,
) -> Result<JimengDreaminaImageSubmitResponse, String> {
    let (_workspace, _pending, submit_ids) =
        submit_jimeng_dreamina_image_requests(&app, &payload).await?;

    Ok(JimengDreaminaImageSubmitResponse { submit_ids })
}

#[tauri::command]
pub async fn submit_jimeng_dreamina_videos(
    app: AppHandle,
    payload: GenerateJimengDreaminaVideosPayload,
) -> Result<JimengDreaminaVideoSubmitResponse, String> {
    let (_workspace, pending_submit) = submit_jimeng_dreamina_video_request(&app, &payload).await?;

    Ok(JimengDreaminaVideoSubmitResponse {
        submit_id: pending_submit.submit_id,
    })
}

#[tauri::command]
pub async fn query_jimeng_dreamina_image_results(
    app: AppHandle,
    payload: QueryJimengDreaminaImageResultsPayload,
) -> Result<JimengDreaminaImageQueryResponse, String> {
    let workspace = dreamina_workspace(&app)?;
    let submit_ids = payload
        .submit_ids
        .into_iter()
        .map(|submit_id| submit_id.trim().to_string())
        .filter(|submit_id| !submit_id.is_empty())
        .collect::<Vec<_>>();
    if submit_ids.is_empty() {
        return Err("At least one Dreamina image submit_id is required.".to_string());
    }

    let mut completed = Vec::new();
    let mut pending_submit_ids = Vec::new();
    let mut failed_submit_ids = Vec::new();
    let mut warnings = Vec::new();

    for (request_index, submit_id) in submit_ids.iter().enumerate() {
        let download_dir = runtime_submit_download_dir(&app, "image", submit_id)?;
        match query_dreamina(&app, workspace.clone(), submit_id, &download_dir).await {
            Ok(Some(value)) => {
                for (media_index, media) in image_media(&value).into_iter().enumerate() {
                    completed.push((request_index, media_index, media));
                }
            }
            Ok(None) => pending_submit_ids.push(submit_id.clone()),
            Err(error) => {
                warn!("Dreamina image re-query {} failed: {}", submit_id, error);
                failed_submit_ids.push(submit_id.clone());
                warnings.push(format!("{submit_id}: {error}"));
            }
        }
    }

    completed.sort_by_key(|(submit_index, media_index, _)| (*submit_index, *media_index));
    let results = completed
        .into_iter()
        .enumerate()
        .map(|(index, (_, _, (source_url, width, height, file_name)))| {
            JimengDreaminaGeneratedImageResult {
                index,
                source_url,
                width,
                height,
                file_name,
            }
        })
        .collect::<Vec<_>>();

    Ok(JimengDreaminaImageQueryResponse {
        submit_ids,
        pending_submit_ids,
        failed_submit_ids,
        results,
        warnings,
    })
}

#[tauri::command]
pub async fn query_jimeng_dreamina_video_result(
    app: AppHandle,
    payload: QueryJimengDreaminaVideoResultPayload,
) -> Result<JimengDreaminaVideoQueryResponse, String> {
    let workspace = dreamina_workspace(&app)?;
    let submit_id = payload.submit_id.trim().to_string();
    if submit_id.is_empty() {
        return Err("Dreamina video submit_id is required.".to_string());
    }

    let download_dir = runtime_submit_download_dir(&app, "video", &submit_id)?;
    match query_dreamina(&app, workspace, &submit_id, &download_dir).await {
        Ok(Some(resolved)) => {
            let results = video_media(&resolved)
                .into_iter()
                .enumerate()
                .map(
                    |(index, (source_url, width, height, duration_seconds, file_name))| {
                        JimengDreaminaGeneratedVideoResult {
                            index,
                            source_url,
                            width,
                            height,
                            duration_seconds,
                            file_name,
                        }
                    },
                )
                .collect::<Vec<_>>();

            Ok(JimengDreaminaVideoQueryResponse {
                submit_id,
                pending: false,
                status: "success".to_string(),
                results,
                warnings: Vec::new(),
                failure_message: None,
            })
        }
        Ok(None) => Ok(JimengDreaminaVideoQueryResponse {
            submit_id,
            pending: true,
            status: "pending".to_string(),
            results: Vec::new(),
            warnings: Vec::new(),
            failure_message: None,
        }),
        Err(error) if error.starts_with(&format!("Dreamina task {submit_id} failed:")) => {
            Ok(JimengDreaminaVideoQueryResponse {
                submit_id,
                pending: false,
                status: "failed".to_string(),
                results: Vec::new(),
                warnings: vec![error.clone()],
                failure_message: Some(error),
            })
        }
        Err(error) => Err(error),
    }
}
