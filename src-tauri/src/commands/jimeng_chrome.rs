use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::sleep;
use tracing::{info, warn};
use uuid::Uuid;

use super::jimeng_panel::SubmitJimengPanelPayload;

const JIMENG_CHROME_REMOTE_DEBUGGING_PORT: u16 = 9334;
const JIMENG_CHROME_TARGET_URL: &str =
    "https://jimeng.jianying.com/ai-tool/generate?type=video&workspace=0";
const JIMENG_CHROME_WAIT_TIMEOUT_MS: u64 = 25_000;
const JIMENG_CHROME_POLL_INTERVAL_MS: u64 = 400;
const JIMENG_CHROME_BRIDGE_SCRIPT: &str = include_str!("jimeng_panel_bridge.js");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JimengChromeSessionInfo {
    pub executable_path: String,
    pub user_data_dir: String,
    pub remote_debugging_port: u16,
    pub target_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChromeVersionInfo {
    #[serde(rename = "webSocketDebuggerUrl")]
    _web_socket_debugger_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChromeTargetInfo {
    id: String,
    title: Option<String>,
    url: String,
    #[serde(rename = "type")]
    target_type: Option<String>,
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JimengChromePageContext {
    location_href: Option<String>,
    ready_state: Option<String>,
    document_title: Option<String>,
    has_bridge: Option<bool>,
}

struct ChromeCdpClient {
    stream: TcpStream,
    next_id: u64,
}

impl ChromeCdpClient {
    async fn connect(websocket_url: &str) -> Result<Self, String> {
        let parsed_url = reqwest::Url::parse(websocket_url)
            .map_err(|error| format!("failed to parse Chrome DevTools websocket url: {error}"))?;

        let host = parsed_url
            .host_str()
            .ok_or_else(|| "Chrome DevTools websocket url is missing a host".to_string())?;
        let port = parsed_url
            .port_or_known_default()
            .ok_or_else(|| "Chrome DevTools websocket url is missing a port".to_string())?;
        let path = if let Some(query) = parsed_url.query() {
            format!("{}?{}", parsed_url.path(), query)
        } else {
            parsed_url.path().to_string()
        };

        let mut stream = TcpStream::connect((host, port))
            .await
            .map_err(|error| format!("failed to connect to Chrome DevTools socket: {error}"))?;

        let websocket_key =
            base64::engine::general_purpose::STANDARD.encode(Uuid::new_v4().as_bytes());
        let handshake_request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {websocket_key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );

        stream
            .write_all(handshake_request.as_bytes())
            .await
            .map_err(|error| {
                format!("failed to send Chrome DevTools websocket handshake: {error}")
            })?;

        let mut response_bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !response_bytes
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let read = stream
                .read(&mut buffer)
                .await
                .map_err(|error| format!("failed to read Chrome DevTools handshake: {error}"))?;
            if read == 0 {
                return Err("Chrome DevTools websocket handshake closed unexpectedly".to_string());
            }
            response_bytes.extend_from_slice(&buffer[..read]);
            if response_bytes.len() > 16 * 1024 {
                return Err(
                    "Chrome DevTools websocket handshake response was too large".to_string()
                );
            }
        }

        let response_text = String::from_utf8(response_bytes).map_err(|error| {
            format!("failed to decode Chrome DevTools handshake response: {error}")
        })?;
        if !response_text.starts_with("HTTP/1.1 101") && !response_text.starts_with("HTTP/1.0 101")
        {
            return Err(format!(
                "Chrome DevTools websocket handshake failed: {}",
                response_text.lines().next().unwrap_or("<no status line>")
            ));
        }

        Ok(Self { stream, next_id: 1 })
    }

    async fn send_command(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let request_id = self.next_id;
        self.next_id += 1;

        let payload = json!({
            "id": request_id,
            "method": method,
            "params": params,
        });

        self.write_text_frame(&payload.to_string())
            .await
            .map_err(|error| format!("failed to send Chrome DevTools command {method}: {error}"))?;

        loop {
            let (opcode, frame_payload) = self.read_frame().await?;
            match opcode {
                0x1 => {
                    let text = String::from_utf8(frame_payload).map_err(|error| {
                        format!("failed to decode Chrome DevTools text frame: {error}")
                    })?;

                    let value: Value = serde_json::from_str(&text).map_err(|error| {
                        format!("failed to parse Chrome DevTools JSON: {error}")
                    })?;

                    if value.get("id").and_then(Value::as_u64) != Some(request_id) {
                        continue;
                    }

                    if let Some(error) = value.get("error") {
                        return Err(format!(
                            "Chrome DevTools command {method} failed: {}",
                            error
                        ));
                    }

                    return Ok(value.get("result").cloned().unwrap_or(Value::Null));
                }
                0x8 => {
                    return Err("Chrome DevTools connection closed unexpectedly".to_string());
                }
                0x9 => {
                    self.write_control_frame(0xA, &frame_payload).await?;
                }
                0xA => {}
                _ => {}
            }
        }
    }

    async fn evaluate_json(&mut self, expression: &str) -> Result<Value, String> {
        let result = self
            .send_command(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "awaitPromise": true,
                    "returnByValue": true,
                }),
            )
            .await?;

        if let Some(exception) = result.get("exceptionDetails") {
            return Err(format!("Chrome page evaluation failed: {}", exception));
        }

        let remote_result = result.get("result").cloned().unwrap_or(Value::Null);
        if remote_result.get("type").and_then(Value::as_str) == Some("undefined") {
            return Ok(Value::Null);
        }

        if let Some(value) = remote_result.get("value") {
            return Ok(value.clone());
        }

        if let Some(description) = remote_result.get("description").and_then(Value::as_str) {
            return Ok(Value::String(description.to_string()));
        }

        Ok(remote_result)
    }

    async fn bring_to_front(&mut self) -> Result<(), String> {
        let _ = self.send_command("Page.bringToFront", json!({})).await?;
        Ok(())
    }

    async fn navigate(&mut self, url: &str) -> Result<(), String> {
        let _ = self
            .send_command("Page.navigate", json!({ "url": url }))
            .await?;
        Ok(())
    }

    async fn write_text_frame(&mut self, text: &str) -> Result<(), String> {
        self.write_control_frame(0x1, text.as_bytes()).await
    }

    async fn write_control_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<(), String> {
        let mut frame = Vec::with_capacity(payload.len() + 16);
        frame.push(0x80 | (opcode & 0x0F));

        if payload.len() <= 125 {
            frame.push(0x80 | payload.len() as u8);
        } else if payload.len() <= u16::MAX as usize {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        }

        let mask_key = [0x13_u8, 0x37_u8, 0x42_u8, 0x24_u8];
        frame.extend_from_slice(&mask_key);
        for (index, byte) in payload.iter().enumerate() {
            frame.push(byte ^ mask_key[index % 4]);
        }

        self.stream
            .write_all(&frame)
            .await
            .map_err(|error| format!("failed to write websocket frame: {error}"))
    }

    async fn read_frame(&mut self) -> Result<(u8, Vec<u8>), String> {
        let mut header = [0_u8; 2];
        self.stream
            .read_exact(&mut header)
            .await
            .map_err(|error| format!("failed to read websocket frame header: {error}"))?;

        let opcode = header[0] & 0x0F;
        let masked = (header[1] & 0x80) != 0;
        let mut payload_len = (header[1] & 0x7F) as u64;

        if payload_len == 126 {
            let mut extended = [0_u8; 2];
            self.stream
                .read_exact(&mut extended)
                .await
                .map_err(|error| format!("failed to read websocket extended length: {error}"))?;
            payload_len = u16::from_be_bytes(extended) as u64;
        } else if payload_len == 127 {
            let mut extended = [0_u8; 8];
            self.stream
                .read_exact(&mut extended)
                .await
                .map_err(|error| format!("failed to read websocket long length: {error}"))?;
            payload_len = u64::from_be_bytes(extended);
        }

        let mut mask_key = [0_u8; 4];
        if masked {
            self.stream
                .read_exact(&mut mask_key)
                .await
                .map_err(|error| format!("failed to read websocket mask key: {error}"))?;
        }

        let mut payload = vec![0_u8; payload_len as usize];
        if payload_len > 0 {
            self.stream
                .read_exact(&mut payload)
                .await
                .map_err(|error| format!("failed to read websocket payload: {error}"))?;
        }

        if masked {
            for (index, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask_key[index % 4];
            }
        }

        Ok((opcode, payload))
    }
}

fn chrome_debug_base_url() -> String {
    format!("http://127.0.0.1:{}", JIMENG_CHROME_REMOTE_DEBUGGING_PORT)
}

fn resolve_chrome_profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let profile_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("jimeng-chrome-profile");

    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("failed to create Jimeng Chrome profile dir: {error}"))?;

    Ok(profile_dir)
}

fn chrome_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    let push_candidate = |candidates: &mut Vec<PathBuf>, base: Option<String>, suffix: &str| {
        if let Some(base) = base {
            candidates.push(Path::new(&base).join(suffix));
        }
    };

    push_candidate(
        &mut candidates,
        env::var("PROGRAMFILES").ok(),
        "Google\\Chrome\\Application\\chrome.exe",
    );
    push_candidate(
        &mut candidates,
        env::var("PROGRAMFILES(X86)").ok(),
        "Google\\Chrome\\Application\\chrome.exe",
    );
    push_candidate(
        &mut candidates,
        env::var("LOCALAPPDATA").ok(),
        "Google\\Chrome\\Application\\chrome.exe",
    );
    push_candidate(
        &mut candidates,
        env::var("LOCALAPPDATA").ok(),
        "Chromium\\Application\\chrome.exe",
    );

    candidates
}

fn resolve_chrome_executable_path() -> Result<PathBuf, String> {
    for candidate in chrome_candidate_paths() {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err("未找到可用的 Chrome/Chromium，可先安装 Google Chrome 后再试。".to_string())
}

fn resolve_jimeng_chrome_executable_path() -> Result<PathBuf, String> {
    resolve_chrome_executable_path().map_err(|_| {
        "Chrome/Chromium was not found. Please install Google Chrome and try again."
            .to_string()
    })
}

fn spawn_chrome_window(
    executable_path: &Path,
    user_data_dir: &Path,
    target_url: &str,
) -> Result<(), String> {
    let mut command = Command::new(executable_path);
    command
        .arg(format!(
            "--remote-debugging-port={}",
            JIMENG_CHROME_REMOTE_DEBUGGING_PORT
        ))
        .arg("--disable-logging")
        .arg("--log-level=3")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-default-apps")
        .arg(format!(
            "--user-data-dir={}",
            user_data_dir.to_string_lossy()
        ))
        .arg("--new-window")
        .arg(target_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
        .spawn()
        .map_err(|error| format!("failed to launch Chrome automation window: {error}"))?;

    Ok(())
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|error| format!("failed to query Chrome DevTools endpoint: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Chrome DevTools endpoint returned {}",
            response.status()
        ));
    }

    response
        .json::<T>()
        .await
        .map_err(|error| format!("failed to decode Chrome DevTools JSON: {error}"))
}

async fn chrome_debug_ready() -> bool {
    fetch_json::<ChromeVersionInfo>(&format!("{}/json/version", chrome_debug_base_url()))
        .await
        .is_ok()
}

async fn ensure_chrome_debug_session(
    executable_path: &Path,
    user_data_dir: &Path,
) -> Result<(), String> {
    if chrome_debug_ready().await {
        return Ok(());
    }

    spawn_chrome_window(executable_path, user_data_dir, JIMENG_CHROME_TARGET_URL)?;

    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        if chrome_debug_ready().await {
            return Ok(());
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    Err("Chrome 已启动，但调试连接没有就绪。".to_string())
}

async fn list_chrome_targets() -> Result<Vec<ChromeTargetInfo>, String> {
    fetch_json::<Vec<ChromeTargetInfo>>(&format!("{}/json/list", chrome_debug_base_url())).await
}

fn is_jimeng_target_url(url: &str) -> bool {
    url.starts_with("https://jimeng.jianying.com/")
        || url.starts_with("http://jimeng.jianying.com/")
}

fn is_jimeng_generate_url(url: &str) -> bool {
    url.starts_with("https://jimeng.jianying.com/ai-tool/generate")
        || url.starts_with("http://jimeng.jianying.com/ai-tool/generate")
}

fn is_jimeng_video_workspace_url(url: &str) -> bool {
    is_jimeng_generate_url(url) && url.contains("type=video")
}

fn find_best_jimeng_target(targets: &[ChromeTargetInfo]) -> Option<ChromeTargetInfo> {
    targets
        .iter()
        .find(|target| {
            target.target_type.as_deref() == Some("page")
                && is_jimeng_video_workspace_url(&target.url)
                && target.web_socket_debugger_url.is_some()
        })
        .cloned()
        .or_else(|| {
            targets
                .iter()
                .find(|target| {
                    target.target_type.as_deref() == Some("page")
                        && is_jimeng_generate_url(&target.url)
                        && target.web_socket_debugger_url.is_some()
                })
                .cloned()
        })
        .or_else(|| {
            targets
                .iter()
                .find(|target| {
                    target.target_type.as_deref() == Some("page")
                        && is_jimeng_target_url(&target.url)
                        && target.web_socket_debugger_url.is_some()
                })
                .cloned()
        })
}

async fn ensure_jimeng_target(
    executable_path: &Path,
    user_data_dir: &Path,
) -> Result<ChromeTargetInfo, String> {
    if let Some(target) = find_best_jimeng_target(&list_chrome_targets().await?) {
        return Ok(target);
    }

    spawn_chrome_window(executable_path, user_data_dir, JIMENG_CHROME_TARGET_URL)?;

    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        if let Some(target) = find_best_jimeng_target(&list_chrome_targets().await?) {
            return Ok(target);
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    Err("Chrome 已打开，但没有找到即梦页面标签页。".to_string())
}

async fn connect_target_client(target: &ChromeTargetInfo) -> Result<ChromeCdpClient, String> {
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| "Jimeng Chrome target does not expose a DevTools websocket".to_string())?;

    let mut client = ChromeCdpClient::connect(websocket_url).await?;
    client.bring_to_front().await?;
    Ok(client)
}

async fn read_page_context(
    client: &mut ChromeCdpClient,
) -> Result<JimengChromePageContext, String> {
    let page_context = client
        .evaluate_json(
            r#"
(() => {
  try {
    return {
      locationHref: window.location.href,
      readyState: document.readyState,
      documentTitle: document.title,
      hasBridge: Boolean(window.__STORYBOARD_JIMENG__),
    };
  } catch (error) {
    return {
      locationHref: null,
      readyState: null,
      documentTitle: null,
      hasBridge: false,
    };
  }
})()
"#,
        )
        .await?;

    serde_json::from_value(page_context)
        .map_err(|error| format!("failed to decode Jimeng Chrome page context: {error}"))
}

fn format_page_context(context: &JimengChromePageContext) -> String {
    format!(
        "{} (readyState={}, title={})",
        context.location_href.as_deref().unwrap_or("<unknown>"),
        context.ready_state.as_deref().unwrap_or("<unknown>"),
        context.document_title.as_deref().unwrap_or("<unknown>")
    )
}

async fn wait_for_jimeng_page_ready(client: &mut ChromeCdpClient) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    let mut navigated_to_generate = false;

    while Instant::now() < deadline {
        let page_context = read_page_context(client).await?;

        if !is_jimeng_video_workspace_url(page_context.location_href.as_deref().unwrap_or_default())
        {
            if !navigated_to_generate {
                client.navigate(JIMENG_CHROME_TARGET_URL).await?;
                navigated_to_generate = true;
            }

            sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
            continue;
        }

        let _ = client.evaluate_json(JIMENG_CHROME_BRIDGE_SCRIPT).await?;
        let page_context = read_page_context(client).await?;
        if page_context.has_bridge.unwrap_or(false) {
            return Ok(());
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    let last_context = read_page_context(client).await.unwrap_or_default();
    let current_url = last_context.location_href.as_deref().unwrap_or_default();
    if !is_jimeng_generate_url(current_url) {
        return Err(format!(
            "Chrome 自动化窗口已打开，但当前不在即梦生成页。请先在这个专用 Chrome 窗口里登录即梦，再重试。当前页面：{}",
            format_page_context(&last_context)
        ));
    }

    Err("即梦生成页已打开，但自动化桥接初始化失败。".to_string())
}

async fn poll_submission_state(client: &mut ChromeCdpClient) -> Result<Value, String> {
    client
        .evaluate_json(
            r#"
(() => {
  try {
    return window.__STORYBOARD_JIMENG__?.getSubmissionState?.() ?? null;
  } catch (error) {
    return {
      status: "error",
      error: String(error && error.message ? error.message : error),
    };
  }
})()
"#,
        )
        .await
}

async fn poll_inspection_state(client: &mut ChromeCdpClient) -> Result<Value, String> {
    client
        .evaluate_json(
            r#"
(() => {
  try {
    return window.__STORYBOARD_JIMENG__?.getInspectionState?.() ?? null;
  } catch (error) {
    return {
      status: "error",
      error: String(error && error.message ? error.message : error),
    };
  }
})()
"#,
        )
        .await
}

fn extract_submission_step_summary(submission_state: &Value) -> Option<String> {
    let step = submission_state.get("step")?;
    let step_name = step
        .get("step")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let detail = step
        .get("detail")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    Some(match detail {
        Some(detail) => format!("{step_name}: {detail}"),
        None => step_name.to_string(),
    })
}

fn extract_submission_step_name<'a>(submission_state: &'a Value) -> Option<&'a str> {
    submission_state
        .get("step")?
        .get("step")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn is_submission_effectively_confirmed(submission_state: &Value) -> bool {
    matches!(
        extract_submission_step_name(submission_state),
        Some("submit-click-confirmed" | "submit-click-assumed")
    )
}

fn decorate_submission_message(
    fallback_message: &str,
    submission_state: &Value,
    prefer_state_error: bool,
) -> String {
    let state_error = submission_state
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let step_summary = extract_submission_step_summary(submission_state);

    let base_message = if prefer_state_error {
        state_error.unwrap_or(fallback_message)
    } else {
        fallback_message
    };

    match step_summary {
        Some(step_summary) => format!("{base_message}。最后步骤：{step_summary}"),
        None => base_message.to_string(),
    }
}

async fn request_inspection(client: &mut ChromeCdpClient) -> Result<bool, String> {
    let request_result = client
        .evaluate_json(
            r#"
(() => Boolean(window.__STORYBOARD_JIMENG__?.requestInspection?.(true)))()
"#,
        )
        .await?;

    Ok(request_result.as_bool().unwrap_or(false))
}

async fn wait_for_inspection_report(client: &mut ChromeCdpClient) -> Result<Value, String> {
    if !request_inspection(client).await? {
        return Err("Chrome inspection request was not accepted".to_string());
    }

    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        let inspection_state = poll_inspection_state(client).await?;
        let status = inspection_state
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle");

        match status {
            "ready" => {
                let report = inspection_state.get("report").cloned().ok_or_else(|| {
                    "Jimeng Chrome inspection finished without a report".to_string()
                })?;
                return Ok(report);
            }
            "error" => {
                let error = inspection_state
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Jimeng Chrome inspection failed");
                return Err(error.to_string());
            }
            _ => {}
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    Err("timed out waiting for Jimeng Chrome inspection report".to_string())
}

async fn connect_ready_jimeng_client(app: &AppHandle) -> Result<ChromeCdpClient, String> {
    let session_info = ensure_session_info(app).await?;
    let executable_path = PathBuf::from(&session_info.executable_path);
    let user_data_dir = PathBuf::from(&session_info.user_data_dir);
    let target = ensure_jimeng_target(&executable_path, &user_data_dir).await?;

    info!(
        "Connecting to Jimeng Chrome target {} ({})",
        target.id,
        target.title.as_deref().unwrap_or("<untitled>")
    );

    let mut client = connect_target_client(&target).await?;
    wait_for_jimeng_page_ready(&mut client).await?;
    Ok(client)
}

async fn ensure_session_info(app: &AppHandle) -> Result<JimengChromeSessionInfo, String> {
    let executable_path = resolve_jimeng_chrome_executable_path()?;
    let user_data_dir = resolve_chrome_profile_dir(app)?;
    ensure_chrome_debug_session(&executable_path, &user_data_dir).await?;

    Ok(JimengChromeSessionInfo {
        executable_path: executable_path.to_string_lossy().to_string(),
        user_data_dir: user_data_dir.to_string_lossy().to_string(),
        remote_debugging_port: JIMENG_CHROME_REMOTE_DEBUGGING_PORT,
        target_url: JIMENG_CHROME_TARGET_URL.to_string(),
    })
}

#[tauri::command]
pub async fn ensure_jimeng_chrome_session(
    app: AppHandle,
) -> Result<JimengChromeSessionInfo, String> {
    let session_info = ensure_session_info(&app).await?;
    info!(
        "Jimeng Chrome automation ready: exe={}, profile={}",
        session_info.executable_path, session_info.user_data_dir
    );
    Ok(session_info)
}

#[tauri::command]
pub async fn focus_jimeng_chrome_workspace(
    app: AppHandle,
) -> Result<JimengChromeSessionInfo, String> {
    let session_info = ensure_session_info(&app).await?;
    let executable_path = PathBuf::from(&session_info.executable_path);
    let user_data_dir = PathBuf::from(&session_info.user_data_dir);
    let target = ensure_jimeng_target(&executable_path, &user_data_dir).await?;

    let mut client = connect_target_client(&target).await?;
    if !is_jimeng_generate_url(&target.url) {
        client.navigate(JIMENG_CHROME_TARGET_URL).await?;
    }
    client.bring_to_front().await?;

    Ok(session_info)
}

#[tauri::command]
pub async fn inspect_jimeng_chrome_options(app: AppHandle) -> Result<Value, String> {
    let mut client = connect_ready_jimeng_client(&app).await?;
    wait_for_inspection_report(&mut client).await
}

#[tauri::command]
pub async fn sync_jimeng_chrome_draft_options(
    app: AppHandle,
    payload: SubmitJimengPanelPayload,
) -> Result<Value, String> {
    let mut client = connect_ready_jimeng_client(&app).await?;

    let mut sync_payload = payload;
    sync_payload.auto_submit = Some(false);

    let payload_json = serde_json::to_string(&sync_payload).map_err(|error| {
        format!("failed to serialize Jimeng Chrome draft sync payload: {error}")
    })?;

    let sync_expression =
        format!("(() => Boolean(window.__STORYBOARD_JIMENG__?.syncDraft?.({payload_json})))()");
    let sync_result = client.evaluate_json(&sync_expression).await?;
    if !sync_result.as_bool().unwrap_or(false) {
        let submission_state = poll_submission_state(&mut client)
            .await
            .unwrap_or(Value::Null);
        return Err(decorate_submission_message(
            "Chrome draft sync was not accepted",
            &submission_state,
            true,
        ));
    }

    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        let submission_state = poll_submission_state(&mut client).await?;
        let status = submission_state
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle");

        match status {
            "ready" => return wait_for_inspection_report(&mut client).await,
            "error" => {
                let error_message = decorate_submission_message(
                    "Jimeng Chrome draft sync failed",
                    &submission_state,
                    true,
                );
                warn!("Jimeng Chrome draft sync failed: {}", error_message);
                return Err(error_message);
            }
            _ => {}
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    let submission_state = poll_submission_state(&mut client)
        .await
        .unwrap_or(Value::Null);
    let error_message = decorate_submission_message(
        "timed out waiting for Jimeng Chrome draft sync",
        &submission_state,
        false,
    );
    warn!("Jimeng Chrome draft sync timed out: {}", error_message);
    Err(error_message)
}

#[tauri::command]
pub async fn submit_jimeng_chrome_task(
    app: AppHandle,
    payload: SubmitJimengPanelPayload,
) -> Result<(), String> {
    let mut client = connect_ready_jimeng_client(&app).await?;

    let payload_json = serde_json::to_string(&payload)
        .map_err(|error| format!("failed to serialize Jimeng Chrome payload: {error}"))?;

    let submit_expression =
        format!("(() => Boolean(window.__STORYBOARD_JIMENG__?.submit?.({payload_json})))()");
    let submit_result = client.evaluate_json(&submit_expression).await?;
    if !submit_result.as_bool().unwrap_or(false) {
        let submission_state = poll_submission_state(&mut client)
            .await
            .unwrap_or(Value::Null);
        let error_message = decorate_submission_message(
            "Chrome 自动化提交没有成功进入队列。",
            &submission_state,
            true,
        );
        warn!("Jimeng Chrome submission was rejected: {}", error_message);
        return Err(error_message);
    }

    let deadline = Instant::now() + Duration::from_millis(JIMENG_CHROME_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        let submission_state = poll_submission_state(&mut client).await?;
        let status = submission_state
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle");

        match status {
            "ready" => return Ok(()),
            "error" => {
                if is_submission_effectively_confirmed(&submission_state) {
                    info!(
                        "Jimeng Chrome submission reported error after confirmed submit click; treating as success"
                    );
                    return Ok(());
                }
                let error_message = decorate_submission_message(
                    "Jimeng Chrome automation failed",
                    &submission_state,
                    true,
                );
                warn!("Jimeng Chrome submission failed: {}", error_message);
                return Err(error_message);
            }
            _ => {}
        }

        sleep(Duration::from_millis(JIMENG_CHROME_POLL_INTERVAL_MS)).await;
    }

    let submission_state = poll_submission_state(&mut client)
        .await
        .unwrap_or(Value::Null);
    let error_message = decorate_submission_message(
        "Chrome 自动化等待即梦页面完成填写时超时。",
        &submission_state,
        false,
    );
    if is_submission_effectively_confirmed(&submission_state) {
        info!("Jimeng Chrome submission timed out after confirmed submit click; treating as success");
        return Ok(());
    }
    warn!(
        "Jimeng Chrome automation submission timed out: {}",
        error_message
    );
    Err(error_message)
}
