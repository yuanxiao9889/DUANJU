use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri::Manager;

use super::image::persist_image_source;
use super::storage::{self, MediaPersistContext};

const BUNDLED_FFMPEG_DIR_NAME: &str = "ffmpeg";
const FFMPEG_RUNTIME_DIR_NAME: &str = "ffmpeg-runtime";

fn dev_ffmpeg_search_roots() -> Vec<PathBuf> {
    let Ok(workspace) = workspace_root() else {
        return Vec::new();
    };

    vec![
        workspace
            .join("src-tauri")
            .join("resources")
            .join(BUNDLED_FFMPEG_DIR_NAME),
        workspace
            .join("src-tauri")
            .join("target")
            .join("debug")
            .join("resources")
            .join(BUNDLED_FFMPEG_DIR_NAME),
        workspace
            .join("src-tauri")
            .join("target")
            .join("release")
            .join("resources")
            .join(BUNDLED_FFMPEG_DIR_NAME),
        workspace.join("build").join("downloads").join("ffmpeg-bin"),
        workspace
            .join("build")
            .join("downloads")
            .join("ffmpeg-master-latest-win64-gpl")
            .join("ffmpeg-master-latest-win64-gpl")
            .join("bin"),
    ]
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioFromVideoPayload {
    pub source: String,
    pub output_file_stem: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractAudioFromVideoResult {
    pub audio_path: String,
    pub duration: f64,
    pub mime_type: String,
    pub output_file_name: String,
}

fn workspace_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "failed to resolve workspace root".to_string())
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|current| current == &candidate) {
        paths.push(candidate);
    }
}

fn bundled_resource_search_roots(app: &AppHandle) -> Vec<PathBuf> {
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

fn media_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join(FFMPEG_RUNTIME_DIR_NAME);
    fs::create_dir_all(&path)
        .map_err(|error| format!("failed to create ffmpeg runtime dir: {error}"))?;
    Ok(path)
}

fn resolve_local_media_source_path(source: &str) -> Option<PathBuf> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return None;
    }

    let decoded = trimmed.to_string();

    let lower = decoded.to_ascii_lowercase();
    if lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("asset://")
    {
        return None;
    }

    if lower.starts_with("file://") {
        let raw = decoded.trim_start_matches("file://");
        let path = urlencoding::decode(raw)
            .map(|value| value.into_owned())
            .unwrap_or_else(|_| raw.to_string());
        return Some(PathBuf::from(path.trim_start_matches('/')));
    }

    let is_windows_drive_path = decoded.len() >= 3
        && decoded.as_bytes()[1] == b':'
        && (decoded.as_bytes()[2] == b'\\' || decoded.as_bytes()[2] == b'/')
        && decoded.as_bytes()[0].is_ascii_alphabetic();
    let is_unc_path = decoded.starts_with("\\\\");
    let is_unix_absolute_path = decoded.starts_with('/');

    if is_windows_drive_path || is_unc_path || is_unix_absolute_path {
        return Some(PathBuf::from(decoded));
    }

    None
}

fn resolve_readable_local_video_path(app: &AppHandle, source: &str) -> Result<PathBuf, String> {
    let decoded_source = storage::decode_storage_media_ref(app, source);
    let local_path = resolve_local_media_source_path(&decoded_source).ok_or_else(|| {
        format!(
            "Local video source path is required, got non-local value: {}",
            source.trim()
        )
    })?;

    if verify_media_path(&local_path).is_ok() {
        return Ok(local_path);
    }

    let known_media_dirs = storage::resolve_known_media_dirs(app)?;
    if let Some(relocated_path) = storage::relocate_storage_path_to_known_media_dirs(
        &local_path.to_string_lossy(),
        &known_media_dirs,
    ) {
        let relocated = PathBuf::from(relocated_path);
        if verify_media_path(&relocated).is_ok() {
            return Ok(relocated);
        }
    }

    Err(format!(
        "Local video file is missing or empty: {}",
        local_path.display()
    ))
}

fn verify_media_path(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Failed to inspect media file: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Media path is not a file: {}", path.display()));
    }
    if metadata.len() == 0 {
        return Err(format!("Media file is empty: {}", path.display()));
    }
    Ok(())
}

fn sanitize_file_stem(raw: &str, fallback: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }

    let mut sanitized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        let blocked = matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        if blocked || ch.is_control() {
            continue;
        }
        sanitized.push(ch);
    }

    let compact = sanitized.trim().trim_matches(['.', ' ']).to_string();
    if compact.is_empty() {
        fallback.to_string()
    } else {
        compact
    }
}

fn resolve_output_file_stem(source_path: &Path, provided_stem: Option<&str>) -> String {
    if let Some(value) = provided_stem {
        let sanitized = sanitize_file_stem(value, "");
        if !sanitized.is_empty() {
            return sanitized;
        }
    }

    let fallback = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("video-audio");
    sanitize_file_stem(&format!("{fallback}-audio"), "video-audio")
}

fn resolve_bundled_binary_path(app: &AppHandle, file_name: &str) -> Option<PathBuf> {
    for root in bundled_resource_search_roots(app) {
        let candidates = [
            root.join(file_name),
            root.join(BUNDLED_FFMPEG_DIR_NAME).join(file_name),
            root.join("resources").join(file_name),
            root.join("resources")
                .join(BUNDLED_FFMPEG_DIR_NAME)
                .join(file_name),
        ];
        for candidate in candidates {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_in_path(file_name: &str) -> Option<PathBuf> {
    let path_env = env::var_os("PATH")?;
    for entry in env::split_paths(&path_env) {
        let candidate = entry.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn collect_ffmpeg_search_candidates(app: &AppHandle, file_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    for root in bundled_resource_search_roots(app) {
        push_unique_path(&mut candidates, root.join(file_name));
        push_unique_path(
            &mut candidates,
            root.join(BUNDLED_FFMPEG_DIR_NAME).join(file_name),
        );
        push_unique_path(&mut candidates, root.join("resources").join(file_name));
        push_unique_path(
            &mut candidates,
            root.join("resources")
                .join(BUNDLED_FFMPEG_DIR_NAME)
                .join(file_name),
        );
    }

    for root in dev_ffmpeg_search_roots() {
        push_unique_path(&mut candidates, root.join(file_name));
    }

    if let Some(path_env) = env::var_os("PATH") {
        for entry in env::split_paths(&path_env) {
            push_unique_path(&mut candidates, entry.join(file_name));
        }
    }

    candidates
}

fn ensure_runtime_binary(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let runtime_dir = media_runtime_root(app)?;
    let runtime_path = runtime_dir.join(file_name);
    if runtime_path.is_file() {
        return Ok(runtime_path);
    }

    if let Some(bundled_path) = resolve_bundled_binary_path(app, file_name) {
        fs::copy(&bundled_path, &runtime_path)
            .map_err(|error| format!("failed to copy bundled {file_name}: {error}"))?;
        return Ok(runtime_path);
    }

    for root in dev_ffmpeg_search_roots() {
        let candidate = root.join(file_name);
        if candidate.is_file() {
            fs::copy(&candidate, &runtime_path).map_err(|error| {
                format!("failed to copy workspace ffmpeg binary {file_name}: {error}")
            })?;
            return Ok(runtime_path);
        }
    }

    find_in_path(file_name).ok_or_else(|| {
        let searched_paths = collect_ffmpeg_search_candidates(app, file_name)
            .into_iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>();
        let searched_paths_summary = if searched_paths.is_empty() {
            "No candidate paths were generated.".to_string()
        } else {
            format!("Searched: {}", searched_paths.join(" | "))
        };
        format!(
            "Bundled {file_name} was not found. Copy ffmpeg binaries into `src-tauri/resources/{}`, keep them under `build/downloads/ffmpeg-bin`, or install ffmpeg on PATH. {searched_paths_summary}",
            BUNDLED_FFMPEG_DIR_NAME,
        )
    })
}

fn run_ffprobe(ffprobe_path: &Path, source_path: &Path) -> Result<(bool, f64), String> {
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("a:0")
        .arg("-show_entries")
        .arg("stream=codec_type:format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=0")
        .arg(source_path)
        .output()
        .map_err(|error| format!("Failed to start ffprobe: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffprobe failed to inspect the video".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let has_audio = stdout.lines().any(|line| line.trim() == "codec_type=audio");
    let duration = stdout
        .lines()
        .find_map(|line| line.strip_prefix("duration="))
        .and_then(|value| value.trim().parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok((has_audio, duration.max(0.0)))
}

fn run_ffmpeg(ffmpeg_path: &Path, source_path: &Path, output_path: &Path) -> Result<(), String> {
    let output = Command::new(ffmpeg_path)
        .arg("-y")
        .arg("-i")
        .arg(source_path)
        .arg("-vn")
        .arg("-map")
        .arg("0:a:0")
        .arg("-c:a")
        .arg("libmp3lame")
        .arg("-q:a")
        .arg("2")
        .arg(output_path)
        .output()
        .map_err(|error| format!("Failed to start ffmpeg: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffmpeg failed to extract audio".to_string()
        } else {
            stderr
        });
    }

    verify_media_path(output_path)
}

#[tauri::command]
pub async fn extract_audio_from_video(
    app: AppHandle,
    payload: ExtractAudioFromVideoPayload,
    media_context: Option<MediaPersistContext>,
) -> Result<ExtractAudioFromVideoResult, String> {
    let normalized_source = payload.source.trim();
    if normalized_source.is_empty() {
        return Err("Video source is empty".to_string());
    }

    let persisted_video_path = persist_image_source(
        app.clone(),
        normalized_source.to_string(),
        Some(MediaPersistContext {
            project_id: media_context
                .as_ref()
                .and_then(|context| context.project_id.clone()),
            media_type: Some("video".to_string()),
            role: Some("original".to_string()),
        }),
    )
    .await?;
    let source_path = resolve_readable_local_video_path(&app, &persisted_video_path)?;

    let ffmpeg_path = ensure_runtime_binary(&app, "ffmpeg.exe")?;
    let ffprobe_path = ensure_runtime_binary(&app, "ffprobe.exe")?;
    let (has_audio, duration) = run_ffprobe(&ffprobe_path, &source_path)?;
    if !has_audio {
        return Err("The selected video does not contain an audio track.".to_string());
    }

    let temp_dir = env::temp_dir()
        .join("storyboard-copilot")
        .join("audio-extract");
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create temp extraction dir: {error}"))?;
    let output_file_name = format!(
        "{}.mp3",
        resolve_output_file_stem(&source_path, payload.output_file_stem.as_deref())
    );
    let temp_output_path = temp_dir.join(&output_file_name);
    if temp_output_path.exists() {
        let _ = fs::remove_file(&temp_output_path);
    }

    run_ffmpeg(&ffmpeg_path, &source_path, &temp_output_path)?;

    let persisted_audio_path = persist_image_source(
        app.clone(),
        temp_output_path.to_string_lossy().to_string(),
        Some(MediaPersistContext {
            project_id: media_context
                .as_ref()
                .and_then(|context| context.project_id.clone()),
            media_type: Some("audio".to_string()),
            role: media_context
                .as_ref()
                .and_then(|context| context.role.clone()),
        }),
    )
    .await?;

    let _ = fs::remove_file(&temp_output_path);

    Ok(ExtractAudioFromVideoResult {
        audio_path: persisted_audio_path,
        duration,
        mime_type: "audio/mpeg".to_string(),
        output_file_name,
    })
}
