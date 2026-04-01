use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::time::sleep;
use tracing::warn;
use uuid::Uuid;

const IMAGE_TIMEOUT_MS: u64 = 12 * 60 * 1000;
const VIDEO_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const POLL_INTERVAL_MS: u64 = 2_500;
const DEFAULT_IMAGE_COUNT: usize = 1;
const MAX_IMAGE_COUNT: usize = 4;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DreaminaCliStatusResponse {
    pub ready: bool,
    pub message: String,
    pub detail: Option<String>,
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
    pub results: Vec<JimengDreaminaGeneratedVideoResult>,
    pub warnings: Vec<String>,
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

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("dreamina-cli-runtime");
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create Dreamina runtime dir: {error}"))?;
    Ok(path)
}

fn git_bash_path() -> Result<PathBuf, String> {
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
    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Git Bash was not found.".to_string())
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
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn dreamina_path_prefix() -> String {
    let mut parts = Vec::new();
    if let Ok(user_profile) = env::var("USERPROFILE") {
        parts.push(format!("{}/bin", bash_style_path(Path::new(&user_profile))));
    }
    if let Ok(windir) = env::var("WINDIR") {
        parts.push(bash_style_path(Path::new(&windir)));
    } else {
        parts.push("/c/Windows".to_string());
    }
    parts.join(":")
}

fn extract_json_text(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    let start = trimmed.find('{').or_else(|| trimmed.find('['))?;
    let candidate = &trimmed[start..];
    let end = candidate.rfind('}').or_else(|| candidate.rfind(']'))?;
    Some(&candidate[..=end])
}

fn normalize_dreamina_cli_error(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.contains("AigcComplianceConfirmationRequired") {
        return "This Dreamina model requires a one-time authorization on the Dreamina web site before retrying.".to_string();
    }
    let lowered = trimmed.to_ascii_lowercase();
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
            "Dreamina CLI is not ready. Run `dreamina login` first. If the browser flow gets stuck, retry with `dreamina login --debug`. After login, verify with `dreamina user_credit`. You can also check `~/.dreamina_cli/config.toml` and `~/.dreamina_cli/credential.json`. Original error: {trimmed}"
        );
    }
    trimmed.to_string()
}

async fn run_dreamina_json(workspace: PathBuf, args: Vec<String>) -> Result<Value, String> {
    let bash = git_bash_path()?;
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push("dreamina".to_string());
    parts.extend(args.iter().map(|arg| bash_quote(arg)));
    let script = format!(
        "export PATH={}:$PATH; {}",
        bash_quote(&dreamina_path_prefix()),
        parts.join(" ")
    );

    tokio::task::spawn_blocking(move || {
        let output = Command::new(bash)
            .current_dir(workspace)
            .arg("-lc")
            .arg(script)
            .output()
            .map_err(|error| format!("failed to launch Git Bash for Dreamina: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            let line = stderr
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .or_else(|| stdout.lines().map(str::trim).find(|line| !line.is_empty()))
                .unwrap_or("Dreamina CLI failed.");
            return Err(normalize_dreamina_cli_error(line));
        }
        let combined = format!("{stdout}\n{stderr}");
        let json_text = extract_json_text(&stdout)
            .or_else(|| extract_json_text(&combined))
            .ok_or_else(|| {
                format!(
                    "Dreamina CLI did not return parseable JSON. stdout={stdout} stderr={stderr}"
                )
            })?;
        serde_json::from_str::<Value>(json_text)
            .map_err(|error| format!("failed to parse Dreamina JSON: {error}"))
    })
    .await
    .map_err(|error| format!("failed to await Dreamina command: {error}"))?
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
        &["seedance2.0", "seedance2.0fast"],
    );
    let frames_model = normalize_choice(
        payload.model_version.as_deref(),
        &["3.0", "3.5pro", "seedance2.0", "seedance2.0fast"],
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

async fn submit_dreamina(workspace: PathBuf, args: Vec<String>) -> Result<String, String> {
    parse_submit_id(&run_dreamina_json(workspace, args).await?)
}

async fn submit_jimeng_dreamina_image_requests(
    app: &AppHandle,
    payload: &GenerateJimengDreaminaImagesPayload,
) -> Result<(PathBuf, Vec<PendingDreaminaSubmit>, Vec<String>), String> {
    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required for Dreamina image generation.".to_string());
    }

    let workspace = workspace_root()?;
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
        let submit_id = submit_dreamina(workspace.clone(), args.clone()).await?;
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

    let workspace = workspace_root()?;
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
    workspace: PathBuf,
    submit_id: &str,
    download_dir: &Path,
) -> Result<Option<Value>, String> {
    let args = vec![
        "query_result".to_string(),
        "--submit_id".to_string(),
        submit_id.to_string(),
        "--download_dir".to_string(),
        cli_path(download_dir),
    ];
    match run_dreamina_json(workspace, args).await {
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
#[tauri::command]
pub async fn check_dreamina_cli_status() -> Result<DreaminaCliStatusResponse, String> {
    let workspace = workspace_root()?;
    match run_dreamina_json(workspace, vec!["user_credit".to_string()]).await {
        Ok(value) => Ok(DreaminaCliStatusResponse {
            ready: true,
            message: "Dreamina CLI is ready.".to_string(),
            detail: summarize_user_credit(&value)
                .or_else(|| Some("`dreamina user_credit` check passed.".to_string())),
        }),
        Err(error) => Ok(DreaminaCliStatusResponse {
            ready: false,
            message: "Dreamina CLI is not ready.".to_string(),
            detail: Some(error),
        }),
    }
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
            match query_dreamina(workspace.clone(), &submit.submit_id, &submit.download_dir).await {
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
        match query_dreamina(workspace.clone(), &submit_id, &download_dir).await? {
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
    let workspace = workspace_root()?;
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
        match query_dreamina(workspace.clone(), submit_id, &download_dir).await {
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
    let workspace = workspace_root()?;
    let submit_id = payload.submit_id.trim().to_string();
    if submit_id.is_empty() {
        return Err("Dreamina video submit_id is required.".to_string());
    }

    let download_dir = runtime_submit_download_dir(&app, "video", &submit_id)?;
    let value = query_dreamina(workspace, &submit_id, &download_dir).await?;
    let pending = value.is_none();
    let results = value
        .map(|resolved| {
            video_media(&resolved)
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
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(JimengDreaminaVideoQueryResponse {
        submit_id,
        pending,
        results,
        warnings: Vec::new(),
    })
}
