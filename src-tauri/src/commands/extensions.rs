use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;

const EXTENSION_MANIFEST_FILE: &str = "storyboard-extension.json";
const EXTENSION_RUNTIME_CACHE_DIR: &str = "runtime/cache/requests";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFeatureSet {
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub settings_sections: Vec<String>,
    #[serde(default)]
    pub entry_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRuntimeEntry {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub script: Option<String>,
    #[serde(default)]
    pub python: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionModelAsset {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStartupStep {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPackageManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub runtime: String,
    #[serde(default)]
    pub features: ExtensionFeatureSet,
    #[serde(default)]
    pub startup_steps: Vec<ExtensionStartupStep>,
    #[serde(default)]
    pub entry: Option<ExtensionRuntimeEntry>,
    #[serde(default)]
    pub models: Vec<ExtensionModelAsset>,
}

fn resolve_extension_folder(folder_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = folder_path.trim();
    if trimmed_path.is_empty() {
        return Err("Extension folder path is empty.".to_string());
    }

    let folder = PathBuf::from(trimmed_path);
    if !folder.exists() {
        return Err(format!("Extension folder does not exist: {}", trimmed_path));
    }

    if !folder.is_dir() {
        return Err(format!("Extension path is not a folder: {}", trimmed_path));
    }

    Ok(folder)
}

fn read_manifest_from_folder(folder: &Path) -> Result<ExtensionPackageManifest, String> {
    let manifest_path = folder.join(EXTENSION_MANIFEST_FILE);
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Failed to read extension manifest at {}: {}",
            manifest_path.display(),
            error
        )
    })?;

    let manifest: ExtensionPackageManifest =
        serde_json::from_str(&manifest_text).map_err(|error| {
            format!(
                "Failed to parse extension manifest at {}: {}",
                manifest_path.display(),
                error
            )
        })?;

    if manifest.id.trim().is_empty() {
        return Err("Extension manifest is missing a valid id.".to_string());
    }

    if manifest.name.trim().is_empty() {
        return Err("Extension manifest is missing a valid name.".to_string());
    }

    Ok(manifest)
}

fn ensure_relative_existing_path(
    folder: &Path,
    raw_path: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(format!("Extension manifest is missing {}.", label));
    }

    let relative_path = PathBuf::from(trimmed);
    if relative_path.is_absolute() {
        return Err(format!(
            "Extension {} must be a relative path inside the extension folder.",
            label
        ));
    }

    let resolved = folder.join(relative_path);
    if !resolved.exists() {
        return Err(format!(
            "Extension {} does not exist: {}",
            label,
            resolved.display()
        ));
    }

    Ok(resolved)
}

fn resolve_runtime_entry_paths(
    folder: &Path,
    manifest: &ExtensionPackageManifest,
) -> Result<(PathBuf, PathBuf), String> {
    let entry = manifest
        .entry
        .as_ref()
        .ok_or_else(|| "Extension manifest is missing runtime entry metadata.".to_string())?;

    if entry.kind.trim() != "python" {
        return Err(format!(
            "Unsupported extension runtime entry kind: {}",
            entry.kind
        ));
    }

    let python_path = ensure_relative_existing_path(
        folder,
        entry.python.as_deref().unwrap_or(""),
        "python runtime path",
    )?;
    let script_path = ensure_relative_existing_path(
        folder,
        entry.script.as_deref().unwrap_or(""),
        "entry script path",
    )?;

    Ok((python_path, script_path))
}

fn build_command_payload(command: &str, payload: Option<Value>) -> Result<Value, String> {
    let trimmed_command = command.trim();
    if trimmed_command.is_empty() {
        return Err("Extension command is empty.".to_string());
    }

    let mut payload_map = match payload {
        Some(Value::Object(map)) => map,
        Some(_) => {
            return Err("Extension payload must be a JSON object.".to_string());
        }
        None => Map::new(),
    };

    payload_map.insert(
        "command".to_string(),
        Value::String(trimmed_command.to_string()),
    );

    Ok(Value::Object(payload_map))
}

fn write_request_file(folder: &Path, payload: &Value) -> Result<PathBuf, String> {
    let request_dir = folder.join(EXTENSION_RUNTIME_CACHE_DIR);
    fs::create_dir_all(&request_dir).map_err(|error| {
        format!(
            "Failed to create extension request cache directory {}: {}",
            request_dir.display(),
            error
        )
    })?;

    let request_path = request_dir.join(format!("request-{}.json", Uuid::new_v4()));
    let request_bytes = serde_json::to_vec_pretty(payload)
        .map_err(|error| format!("Failed to serialize extension request: {}", error))?;

    fs::write(&request_path, request_bytes).map_err(|error| {
        format!(
            "Failed to write extension request file {}: {}",
            request_path.display(),
            error
        )
    })?;

    Ok(request_path)
}

fn parse_extension_response(
    command: &str,
    status_ok: bool,
    stdout: &str,
    stderr: &str,
) -> Result<Value, String> {
    let response_text = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or("");

    if response_text.is_empty() {
        return Err(if stderr.trim().is_empty() {
            format!("Extension command '{}' returned no output.", command)
        } else {
            format!("Extension command '{}' failed: {}", command, stderr.trim())
        });
    }

    let response: Value = serde_json::from_str(response_text).map_err(|error| {
        format!(
            "Failed to parse extension JSON response for '{}': {}. stdout: {}{}",
            command,
            error,
            stdout.trim(),
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(", stderr: {}", stderr.trim())
            }
        )
    })?;

    let response_ok = response
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(status_ok);

    if !status_ok || !response_ok {
        let error_message = response
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                let trimmed_stderr = stderr.trim();
                if trimmed_stderr.is_empty() {
                    None
                } else {
                    Some(trimmed_stderr.to_string())
                }
            })
            .unwrap_or_else(|| format!("Extension command '{}' failed.", command));

        return Err(error_message);
    }

    Ok(response)
}

#[tauri::command]
pub fn read_extension_package(folder_path: String) -> Result<ExtensionPackageManifest, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    read_manifest_from_folder(&folder)
}

#[tauri::command]
pub async fn run_extension_command(
    folder_path: String,
    command: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    let manifest = read_manifest_from_folder(&folder)?;
    let trimmed_command = command.trim().to_string();
    let (python_path, script_path) = resolve_runtime_entry_paths(&folder, &manifest)?;
    let request_payload = build_command_payload(&trimmed_command, payload)?;
    let request_path = write_request_file(&folder, &request_payload)?;

    let output = Command::new(&python_path)
        .current_dir(&folder)
        .arg(&script_path)
        .arg("--request-file")
        .arg(&request_path)
        .output()
        .await
        .map_err(|error| {
            format!(
                "Failed to start extension runtime '{}' with {}: {}",
                manifest.id,
                python_path.display(),
                error
            )
        })?;

    if let Err(error) = fs::remove_file(&request_path) {
        eprintln!(
            "failed to remove temporary extension request file {}: {}",
            request_path.display(),
            error
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    parse_extension_response(&trimmed_command, output.status.success(), &stdout, &stderr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn resolve_complete_extension_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("extension-packages")
            .join("qwen3-tts-complete")
    }

    #[test]
    fn complete_extension_manifest_is_readable() {
        let extension_dir = resolve_complete_extension_path();
        assert!(
            extension_dir.exists(),
            "expected complete extension package at {}",
            extension_dir.display()
        );

        let manifest = read_extension_package(extension_dir.to_string_lossy().to_string())
            .expect("manifest should be readable");

        assert_eq!(manifest.id, "qwen3-tts-complete");
        assert_eq!(manifest.runtime, "python-bridge");
        assert!(manifest.entry.is_some(), "python entry should exist");
    }

    #[tokio::test]
    #[ignore = "requires the local offline Qwen extension runtime and models"]
    async fn complete_extension_health_command_succeeds() {
        let extension_dir = resolve_complete_extension_path();
        let response = run_extension_command(
            extension_dir.to_string_lossy().to_string(),
            "health".to_string(),
            None,
        )
        .await
        .expect("health command should succeed");

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            response.get("command").and_then(Value::as_str),
            Some("health")
        );
    }

    #[tokio::test]
    #[ignore = "requires the local offline Qwen extension runtime, models, and generation time"]
    async fn complete_extension_voice_design_generation_succeeds() {
        let extension_dir = resolve_complete_extension_path();
        let response = run_extension_command(
            extension_dir.to_string_lossy().to_string(),
            "generate_voice_design".to_string(),
            Some(json!({
                "text": "你好，这是一个从应用后端命令链路发起的扩展包可用性测试。",
                "language": "zh",
                "voicePrompt": "young female voice; natural delivery; clear articulation",
                "outputPrefix": "rust-command-smoke"
            })),
        )
        .await
        .expect("voice design command should succeed");

        let outputs = response
            .get("outputs")
            .and_then(Value::as_array)
            .expect("outputs should be an array");
        assert!(
            !outputs.is_empty(),
            "voice design generation should produce at least one output"
        );

        let output_path = outputs[0]
            .get("path")
            .and_then(Value::as_str)
            .expect("first output should include a path");
        assert!(
            PathBuf::from(output_path).exists(),
            "generated output file should exist: {}",
            output_path
        );
    }
}
