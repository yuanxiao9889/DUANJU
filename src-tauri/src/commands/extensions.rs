use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;
use tracing::{info, warn};
use uuid::Uuid;

const EXTENSION_MANIFEST_FILE: &str = "storyboard-extension.json";
const EXTENSION_RUNTIME_CACHE_DIR: &str = "runtime/cache/requests";
const EXTENSION_SERVER_RESPONSE_PREFIX: &str = "__SC_EXTENSION_RESPONSE__:";
const EXTENSION_RUNTIME_BOOT_TIMEOUT_MS: u64 = 20_000;
const EXTENSION_RUNTIME_STOP_TIMEOUT_MS: u64 = 3_000;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRuntimeStatusResponse {
    pub extension_id: String,
    pub runtime: String,
    pub supports_persistent_runtime: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
}

#[derive(Debug)]
struct ManagedPythonRuntime {
    extension_id: String,
    pid: u32,
    started_at: i64,
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
}

impl ManagedPythonRuntime {
    fn status(&self, runtime: &str) -> ExtensionRuntimeStatusResponse {
        ExtensionRuntimeStatusResponse {
            extension_id: self.extension_id.clone(),
            runtime: runtime.to_string(),
            supports_persistent_runtime: true,
            running: true,
            pid: Some(self.pid),
            started_at: Some(self.started_at),
        }
    }

    async fn send_request(
        &mut self,
        mut payload: Value,
        timeout_duration: Option<Duration>,
    ) -> Result<Value, String> {
        let (request_id, command_name) = {
            let payload_map = payload
                .as_object_mut()
                .ok_or_else(|| "Extension runtime payload must be a JSON object.".to_string())?;
            let request_id = payload_map
                .entry("requestId".to_string())
                .or_insert_with(|| Value::String(Uuid::new_v4().to_string()))
                .as_str()
                .unwrap_or_default()
                .to_string();
            let command_name = payload_map
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();

            (request_id, command_name)
        };
        let payload_summary = summarize_runtime_payload(&payload);

        let request_text = serde_json::to_string(&payload)
            .map_err(|error| format!("Failed to serialize extension runtime request: {}", error))?;

        info!(
            "sending extension runtime '{}' command '{}': {}",
            self.extension_id, command_name, payload_summary
        );

        self.stdin
            .write_all(request_text.as_bytes())
            .await
            .map_err(|error| {
                format!(
                    "Failed to write extension runtime request for '{}': {}",
                    self.extension_id, error
                )
            })?;
        self.stdin.write_all(b"\n").await.map_err(|error| {
            format!(
                "Failed to finalize extension runtime request for '{}': {}",
                self.extension_id, error
            )
        })?;
        self.stdin.flush().await.map_err(|error| {
            format!(
                "Failed to flush extension runtime request for '{}': {}",
                self.extension_id, error
            )
        })?;

        let read_response = async {
            loop {
                let line = self.stdout.next_line().await.map_err(|error| {
                    format!(
                        "Failed to read extension runtime output for '{}': {}",
                        self.extension_id, error
                    )
                })?;

                let Some(line) = line else {
                    return Err(format!(
                        "Extension runtime '{}' exited unexpectedly.",
                        self.extension_id
                    ));
                };

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let Some(raw_response) = trimmed.strip_prefix(EXTENSION_SERVER_RESPONSE_PREFIX)
                else {
                    warn!(
                        "ignoring non-protocol stdout from extension runtime '{}': {}",
                        self.extension_id, trimmed
                    );
                    continue;
                };

                let response: Value = serde_json::from_str(raw_response).map_err(|error| {
                    format!(
                        "Failed to parse extension runtime response for '{}': {}",
                        self.extension_id, error
                    )
                })?;

                let response_request_id = response
                    .get("requestId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();

                if !request_id.is_empty() && response_request_id != request_id {
                    warn!(
                        "ignoring mismatched response from extension runtime '{}': expected {}, got {}",
                        self.extension_id,
                        request_id,
                        response_request_id
                    );
                    continue;
                }

                let response_ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);

                if !response_ok {
                    return Err(extract_response_error(
                        &response,
                        &format!(
                            "Extension runtime '{}' returned an error.",
                            self.extension_id
                        ),
                    ));
                }

                return Ok(response);
            }
        };

        match timeout_duration {
            Some(duration) => timeout(duration, read_response).await.map_err(|_| {
                format!(
                    "Timed out waiting for extension runtime '{}' to respond.",
                    self.extension_id
                )
            })?,
            None => read_response.await,
        }
    }
}

#[derive(Default)]
struct ExtensionRuntimeManager {
    runtimes: Mutex<HashMap<String, Arc<Mutex<ManagedPythonRuntime>>>>,
}

impl ExtensionRuntimeManager {
    async fn get_runtime(&self, extension_id: &str) -> Option<Arc<Mutex<ManagedPythonRuntime>>> {
        let runtime = {
            let runtimes = self.runtimes.lock().await;
            runtimes.get(extension_id).cloned()
        }?;

        let mut guard = runtime.lock().await;
        match guard.child.try_wait() {
            Ok(None) => {
                drop(guard);
                Some(runtime)
            }
            Ok(Some(status)) => {
                warn!(
                    "extension runtime '{}' already exited with status {}",
                    extension_id, status
                );
                drop(guard);
                self.remove_runtime(extension_id).await;
                None
            }
            Err(error) => {
                warn!(
                    "failed to inspect extension runtime '{}' status: {}",
                    extension_id, error
                );
                drop(guard);
                self.remove_runtime(extension_id).await;
                None
            }
        }
    }

    async fn remove_runtime(&self, extension_id: &str) -> Option<Arc<Mutex<ManagedPythonRuntime>>> {
        self.runtimes.lock().await.remove(extension_id)
    }

    async fn start_python_runtime(
        &self,
        folder: &Path,
        manifest: &ExtensionPackageManifest,
    ) -> Result<ExtensionRuntimeStatusResponse, String> {
        if let Some(runtime) = self.get_runtime(&manifest.id).await {
            let guard = runtime.lock().await;
            return Ok(guard.status(&manifest.runtime));
        }

        let runtime = spawn_python_runtime(folder, manifest).await?;
        let status = runtime.status(&manifest.runtime);
        self.runtimes
            .lock()
            .await
            .insert(manifest.id.clone(), Arc::new(Mutex::new(runtime)));

        Ok(status)
    }

    async fn run_python_command(
        &self,
        manifest: &ExtensionPackageManifest,
        payload: Value,
    ) -> Result<Value, String> {
        let runtime = self.get_runtime(&manifest.id).await.ok_or_else(|| {
            format!(
                "Extension runtime '{}' is not started. Start the extension first.",
                manifest.id
            )
        })?;

        let mut guard = runtime.lock().await;
        let result = guard.send_request(payload, None).await;
        let runtime_exited = match guard.child.try_wait() {
            Ok(Some(status)) => {
                warn!(
                    "extension runtime '{}' exited during command handling with status {}",
                    manifest.id, status
                );
                true
            }
            Ok(None) => false,
            Err(error) => {
                warn!(
                    "failed to inspect extension runtime '{}' after command: {}",
                    manifest.id, error
                );
                true
            }
        };
        drop(guard);

        if runtime_exited {
            self.remove_runtime(&manifest.id).await;
        }

        result
    }

    async fn stop_python_runtime(&self, extension_id: &str) -> Result<(), String> {
        let runtime = self.remove_runtime(extension_id).await;
        if let Some(runtime) = runtime {
            stop_runtime_instance(runtime).await?;
        }

        Ok(())
    }

    async fn get_status(
        &self,
        manifest: &ExtensionPackageManifest,
    ) -> ExtensionRuntimeStatusResponse {
        if manifest.runtime != "python-bridge" {
            return ExtensionRuntimeStatusResponse {
                extension_id: manifest.id.clone(),
                runtime: manifest.runtime.clone(),
                supports_persistent_runtime: false,
                running: false,
                pid: None,
                started_at: None,
            };
        }

        match self.get_runtime(&manifest.id).await {
            Some(runtime) => {
                let guard = runtime.lock().await;
                guard.status(&manifest.runtime)
            }
            None => ExtensionRuntimeStatusResponse {
                extension_id: manifest.id.clone(),
                runtime: manifest.runtime.clone(),
                supports_persistent_runtime: true,
                running: false,
                pid: None,
                started_at: None,
            },
        }
    }

    async fn shutdown_all(&self) {
        let runtimes = {
            let mut runtimes = self.runtimes.lock().await;
            runtimes
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>()
        };

        for runtime in runtimes {
            if let Err(error) = stop_runtime_instance(runtime).await {
                warn!(
                    "failed to stop extension runtime during shutdown: {}",
                    error
                );
            }
        }
    }
}

fn extension_runtime_manager() -> &'static ExtensionRuntimeManager {
    static EXTENSION_RUNTIME_MANAGER: OnceLock<ExtensionRuntimeManager> = OnceLock::new();
    EXTENSION_RUNTIME_MANAGER.get_or_init(ExtensionRuntimeManager::default)
}

fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as i64
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

fn summarize_json_value(value: Option<&Value>, max_len: usize) -> String {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            let mut snippet = trimmed.chars().take(max_len).collect::<String>();
            if trimmed.chars().count() > max_len {
                snippet.push('…');
            }
            format!("string(len={}, value=\"{}\")", trimmed.chars().count(), snippet)
        }
        Some(Value::Array(items)) => format!("array(len={})", items.len()),
        Some(Value::Object(map)) => format!("object(keys={})", map.len()),
        Some(Value::Bool(flag)) => format!("bool({})", flag),
        Some(Value::Number(number)) => format!("number({})", number),
        Some(Value::Null) => "null".to_string(),
        None => "missing".to_string(),
    }
}

fn summarize_runtime_payload(payload: &Value) -> String {
    let Some(map) = payload.as_object() else {
        return format!("non-object payload: {}", payload);
    };

    let command = map
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let keys = map.keys().cloned().collect::<Vec<_>>().join(", ");

    if command == "generate_voice_design" {
        return format!(
            "keys=[{}], text={}, voicePrompt={}, language={}, outputPrefix={}",
            keys,
            summarize_json_value(map.get("text"), 80),
            summarize_json_value(map.get("voicePrompt"), 120),
            summarize_json_value(map.get("language"), 24),
            summarize_json_value(map.get("outputPrefix"), 48),
        );
    }

    format!("keys=[{}]", keys)
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

fn extract_response_error(response: &Value, fallback: &str) -> String {
    response
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_string())
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

async fn run_one_shot_extension_command(
    folder: &Path,
    manifest: &ExtensionPackageManifest,
    command: &str,
    payload: Option<Value>,
) -> Result<Value, String> {
    let (python_path, script_path) = resolve_runtime_entry_paths(folder, manifest)?;
    let request_payload = build_command_payload(command, payload)?;
    let request_path = write_request_file(folder, &request_payload)?;

    let mut command_process = Command::new(&python_path);
    apply_python_stdio_env(&mut command_process);

    let output = command_process
        .current_dir(folder)
        .arg("-u")
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
        warn!(
            "failed to remove temporary extension request file {}: {}",
            request_path.display(),
            error
        );
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

parse_extension_response(command, output.status.success(), &stdout, &stderr)
}

fn apply_python_stdio_env(command: &mut Command) -> &mut Command {
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
}

fn spawn_stderr_logger(extension_id: String, stderr: ChildStderr) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();

            match reader.read_until(b'\n', &mut buffer).await {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer);
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        warn!("extension runtime '{}' stderr: {}", extension_id, trimmed);
                    }
                }
                Err(error) => {
                    warn!(
                        "failed to read extension runtime '{}' stderr: {}",
                        extension_id, error
                    );
                    break;
                }
            }
        }
    });
}

async fn spawn_python_runtime(
    folder: &Path,
    manifest: &ExtensionPackageManifest,
) -> Result<ManagedPythonRuntime, String> {
    let (python_path, script_path) = resolve_runtime_entry_paths(folder, manifest)?;

    let mut command_process = Command::new(&python_path);
    apply_python_stdio_env(&mut command_process);

    let mut child = command_process
        .current_dir(folder)
        .arg("-u")
        .arg(&script_path)
        .arg("--server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start persistent extension runtime '{}' with {}: {}",
                manifest.id,
                python_path.display(),
                error
            )
        })?;

    let pid = child.id().ok_or_else(|| {
        format!(
            "Extension runtime '{}' did not expose a process id after startup.",
            manifest.id
        )
    })?;

    let stdin = child.stdin.take().ok_or_else(|| {
        format!(
            "Extension runtime '{}' did not expose stdin for request handling.",
            manifest.id
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        format!(
            "Extension runtime '{}' did not expose stdout for responses.",
            manifest.id
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        format!(
            "Extension runtime '{}' did not expose stderr for logs.",
            manifest.id
        )
    })?;

    spawn_stderr_logger(manifest.id.clone(), stderr);

    let mut runtime = ManagedPythonRuntime {
        extension_id: manifest.id.clone(),
        pid,
        started_at: current_timestamp_ms(),
        child,
        stdin,
        stdout: BufReader::new(stdout).lines(),
    };

    let health_payload = build_command_payload("health", None)?;
    if let Err(error) = runtime
        .send_request(
            health_payload,
            Some(Duration::from_millis(EXTENSION_RUNTIME_BOOT_TIMEOUT_MS)),
        )
        .await
    {
        if let Err(kill_error) = runtime.child.kill().await {
            warn!(
                "failed to terminate extension runtime '{}' after startup health check failure: {}",
                manifest.id, kill_error
            );
        } else {
            let _ = runtime.child.wait().await;
        }

        return Err(format!(
            "Extension runtime '{}' failed its startup health check: {}",
            manifest.id, error
        ));
    }

    info!("started extension runtime '{}' on pid {}", manifest.id, pid);

    Ok(runtime)
}

async fn stop_runtime_instance(runtime: Arc<Mutex<ManagedPythonRuntime>>) -> Result<(), String> {
    let mut guard = runtime.lock().await;
    let extension_id = guard.extension_id.clone();

    let shutdown_payload = json!({
        "command": "shutdown",
        "requestId": Uuid::new_v4().to_string(),
    });

    if let Err(error) = guard
        .send_request(
            shutdown_payload,
            Some(Duration::from_millis(EXTENSION_RUNTIME_STOP_TIMEOUT_MS)),
        )
        .await
    {
        warn!(
            "graceful shutdown request failed for extension runtime '{}': {}",
            extension_id, error
        );
    }

    match timeout(
        Duration::from_millis(EXTENSION_RUNTIME_STOP_TIMEOUT_MS),
        guard.child.wait(),
    )
    .await
    {
        Ok(Ok(_)) => {
            info!("stopped extension runtime '{}'", extension_id);
            Ok(())
        }
        Ok(Err(error)) => Err(format!(
            "Failed while waiting for extension runtime '{}' to exit: {}",
            extension_id, error
        )),
        Err(_) => {
            warn!(
                "extension runtime '{}' did not stop in time; terminating it",
                extension_id
            );
            guard.child.kill().await.map_err(|error| {
                format!(
                    "Failed to terminate extension runtime '{}': {}",
                    extension_id, error
                )
            })?;
            let _ = guard.child.wait().await;
            Ok(())
        }
    }
}

#[tauri::command]
pub fn read_extension_package(folder_path: String) -> Result<ExtensionPackageManifest, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    read_manifest_from_folder(&folder)
}

#[tauri::command]
pub async fn start_extension_runtime(
    folder_path: String,
) -> Result<ExtensionRuntimeStatusResponse, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    let manifest = read_manifest_from_folder(&folder)?;

    if manifest.runtime != "python-bridge" {
        return Ok(extension_runtime_manager().get_status(&manifest).await);
    }

    extension_runtime_manager()
        .start_python_runtime(&folder, &manifest)
        .await
}

#[tauri::command]
pub async fn stop_extension_runtime(
    folder_path: String,
) -> Result<ExtensionRuntimeStatusResponse, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    let manifest = read_manifest_from_folder(&folder)?;

    if manifest.runtime == "python-bridge" {
        extension_runtime_manager()
            .stop_python_runtime(&manifest.id)
            .await?;
    }

    Ok(extension_runtime_manager().get_status(&manifest).await)
}

#[tauri::command]
pub async fn get_extension_runtime_status(
    folder_path: String,
) -> Result<ExtensionRuntimeStatusResponse, String> {
    let folder = resolve_extension_folder(&folder_path)?;
    let manifest = read_manifest_from_folder(&folder)?;

    Ok(extension_runtime_manager().get_status(&manifest).await)
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

    if manifest.runtime == "python-bridge" {
        let request_payload = build_command_payload(&trimmed_command, payload)?;
        let result = extension_runtime_manager()
            .run_python_command(&manifest, request_payload)
            .await;
        if let Err(error) = &result {
            warn!(
                "extension command '{}' failed for '{}': {}",
                trimmed_command, manifest.id, error
            );
        }
        return result;
    }

    let result =
        run_one_shot_extension_command(&folder, &manifest, &trimmed_command, payload).await;
    if let Err(error) = &result {
        warn!(
            "extension command '{}' failed for '{}': {}",
            trimmed_command, manifest.id, error
        );
    }
    result
}

pub async fn shutdown_all_extension_runtimes() {
    extension_runtime_manager().shutdown_all().await;
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
        let extension_dir_string = extension_dir.to_string_lossy().to_string();

        start_extension_runtime(extension_dir_string.clone())
            .await
            .expect("persistent runtime should start");

        let response =
            run_extension_command(extension_dir_string.clone(), "health".to_string(), None)
                .await
                .expect("health command should succeed");

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            response.get("command").and_then(Value::as_str),
            Some("health")
        );

        stop_extension_runtime(extension_dir_string)
            .await
            .expect("persistent runtime should stop");
    }

    #[tokio::test]
    #[ignore = "requires the local offline Qwen extension runtime, models, and generation time"]
    async fn complete_extension_voice_design_generation_succeeds() {
        let extension_dir = resolve_complete_extension_path();
        let extension_dir_string = extension_dir.to_string_lossy().to_string();

        start_extension_runtime(extension_dir_string.clone())
            .await
            .expect("persistent runtime should start");

        let response = run_extension_command(
            extension_dir_string.clone(),
            "generate_voice_design".to_string(),
            Some(json!({
                "text": "浣犲ソ锛岃繖鏄竴涓粠搴旂敤鍚庣鍛戒护閾捐矾鍙戣捣鐨勬墿灞曞寘鍙敤鎬ф祴璇曘€?",
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

        stop_extension_runtime(extension_dir_string)
            .await
            .expect("persistent runtime should stop");
    }
}
