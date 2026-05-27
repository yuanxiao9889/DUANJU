use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

use super::media_audio::{ensure_runtime_binary, ffmpeg_binary_name};
use super::storage::{self, MediaPersistContext};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeDirectorStageRecordingPayload {
    pub webm_bytes: Vec<u8>,
    pub output_path: Option<String>,
    pub output_file_name: Option<String>,
    pub target_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscodeDirectorStageRecordingResult {
    pub video_url: String,
    pub output_path: Option<String>,
    pub output_file_name: String,
}

fn verify_video_path(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Failed to inspect video file: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Video path is not a file: {}", path.display()));
    }
    if metadata.len() == 0 {
        return Err(format!("Video file is empty: {}", path.display()));
    }
    Ok(())
}

fn sanitize_file_name(raw: &str, fallback: &str) -> String {
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
    } else if compact.to_ascii_lowercase().ends_with(".mp4") {
        compact
    } else {
        format!("{compact}.mp4")
    }
}

fn resolve_output_file_name(output_path: &Path, provided: Option<&str>) -> String {
    if let Some(name) = provided {
        return sanitize_file_name(name, "director-stage-recording.mp4");
    }
    output_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_file_name(value, "director-stage-recording.mp4"))
        .unwrap_or_else(|| "director-stage-recording.mp4".to_string())
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Recording bytes are empty".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create recording temp dir: {error}"))?;
    }
    fs::write(path, bytes).map_err(|error| format!("Failed to write recording temp file: {error}"))
}

fn run_ffmpeg_transcode(
    ffmpeg_path: &Path,
    source_path: &Path,
    output_path: &Path,
    target_duration_ms: Option<u64>,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg_path);
    command.arg("-y").arg("-i").arg(source_path);
    if let Some(duration_ms) = target_duration_ms.filter(|value| *value > 0) {
        command
            .arg("-t")
            .arg(format!("{:.3}", duration_ms as f64 / 1000.0));
    }
    let output = command
        .arg("-an")
        .arg("-r")
        .arg("30")
        .arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path)
        .output()
        .map_err(|error| format!("Failed to start ffmpeg: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ffmpeg failed to transcode the recording".to_string()
        } else {
            stderr
        });
    }

    verify_video_path(output_path)
}

fn copy_file_to_output(source_path: &Path, output_path: &Path) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create MP4 output dir: {error}"))?;
    }
    fs::copy(source_path, output_path)
        .map_err(|error| format!("Failed to save MP4 output: {error}"))?;
    verify_video_path(output_path)
}

#[tauri::command]
pub async fn transcode_director_stage_recording_to_mp4(
    app: AppHandle,
    payload: TranscodeDirectorStageRecordingPayload,
    media_context: Option<MediaPersistContext>,
) -> Result<TranscodeDirectorStageRecordingResult, String> {
    if payload.webm_bytes.is_empty() {
        return Err("Recording bytes are empty".to_string());
    }
    let output_path = payload
        .output_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    let temp_dir = std::env::temp_dir()
        .join("storyboard-copilot")
        .join("director-stage-recording");
    fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create director stage recording temp dir: {error}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_webm_path = temp_dir.join(format!("recording-{stamp}.webm"));
    let temp_mp4_path = temp_dir.join(format!("recording-{stamp}.mp4"));

    write_bytes(&temp_webm_path, &payload.webm_bytes)?;
    let ffmpeg_path = ensure_runtime_binary(&app, &ffmpeg_binary_name("ffmpeg"))?;
    let transcode_result = run_ffmpeg_transcode(
        &ffmpeg_path,
        &temp_webm_path,
        &temp_mp4_path,
        payload.target_duration_ms,
    );
    let _ = fs::remove_file(&temp_webm_path);
    transcode_result?;

    if let Some(output_path) = output_path.as_ref() {
        copy_file_to_output(&temp_mp4_path, output_path)?;
    }
    let mp4_bytes = fs::read(&temp_mp4_path)
        .map_err(|error| format!("Failed to read transcoded MP4: {error}"))?;
    let _ = fs::remove_file(&temp_mp4_path);

    let video_url =
        storage::persist_media_bytes(&app, &mp4_bytes, "mp4", media_context.as_ref(), "original")?;
    let fallback_output_path = PathBuf::from("director-stage-recording.mp4");
    let output_file_name = resolve_output_file_name(
        output_path
            .as_deref()
            .unwrap_or(fallback_output_path.as_path()),
        payload.output_file_name.as_deref(),
    );

    Ok(TranscodeDirectorStageRecordingResult {
        video_url,
        output_path: output_path.map(|path| path.to_string_lossy().to_string()),
        output_file_name,
    })
}
