use reqwest::{header::CONTENT_TYPE, Client};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::sleep;

use crate::commands::storage::{self, MediaPersistContext};

const JSON_REQUEST_MAX_ATTEMPTS: usize = 2;
const JSON_REQUEST_RETRY_DELAY_MS: u64 = 2_000;
const CURL_JSON_TRANSPORT_MIN_BYTES: usize = 64 * 1024;
const CURL_JSON_TRANSPORT_TIMEOUT_SECONDS: u64 = 1_000;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGptBestVideoTaskPayload {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub prompt: String,
    pub seconds: i32,
    pub size: String,
    #[serde(default)]
    pub image: Option<Value>,
    #[serde(default)]
    pub reference_images: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGptBestVideoTaskResponse {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetGptBestVideoTaskPayload {
    pub api_key: String,
    pub base_url: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetGptBestVideoTaskResponse {
    pub task_id: String,
    pub status: String,
    pub model: Option<String>,
    pub cover_url: Option<String>,
    pub output_url: Option<String>,
    pub size: Option<String>,
    pub seconds: Option<i32>,
    pub error_message: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadGptBestVideoContentPayload {
    pub api_key: String,
    pub base_url: String,
    pub task_id: String,
    #[serde(default)]
    pub media_context: Option<MediaPersistContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadGptBestVideoContentResponse {
    pub video_url: String,
    pub file_name: Option<String>,
}

fn normalize_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Third-party video Base URL is required".to_string());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Third-party video Base URL must start with http:// or https://".to_string());
    }
    Ok(trimmed.to_string())
}

fn videos_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim_end_matches('/');
    if normalized.ends_with("/api/v1/videos") || normalized.ends_with("/v1/videos") {
        normalized.to_string()
    } else if normalized.ends_with("/api/v1") || normalized.ends_with("/v1") {
        format!("{}/videos", normalized)
    } else {
        format!("{}/api/v1/videos", normalized)
    }
}

fn query_endpoint(base_url: &str, task_id: &str) -> String {
    format!("{}/{}", videos_endpoint(base_url), task_id)
}

fn content_endpoint(base_url: &str, task_id: &str) -> String {
    format!("{}/{}/content", videos_endpoint(base_url), task_id)
}

fn extract_string(payload: &Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        payload
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn extract_i64(payload: &Value, pointers: &[&str]) -> Option<i64> {
    pointers.iter().find_map(|pointer| {
        payload.pointer(pointer).and_then(|value| {
            value.as_i64().or_else(|| {
                value
                    .as_str()
                    .and_then(|text| text.trim().parse::<i64>().ok())
            })
        })
    })
}

fn extract_i32(payload: &Value, pointers: &[&str]) -> Option<i32> {
    extract_i64(payload, pointers).and_then(|value| i32::try_from(value).ok())
}

fn extract_error_message(payload: &Value) -> Option<String> {
    extract_string(
        payload,
        &[
            "/error/message",
            "/error_msg",
            "/errorMessage",
            "/message",
            "/msg",
            "/data/error",
            "/data/error_message",
            "/data/fail_reason",
        ],
    )
}

fn extract_task_id(payload: &Value) -> Option<String> {
    extract_string(
        payload,
        &[
            "/task_id",
            "/id",
            "/data/task_id",
            "/data/id",
            "/data/request_id",
            "/request_id",
        ],
    )
}

fn extract_output_url(payload: &Value) -> Option<String> {
    extract_string(
        payload,
        &[
            "/data/output_url",
            "/data/video_url",
            "/data/url",
            "/output_url",
            "/video_url",
            "/url",
        ],
    )
}

async fn parse_json_response(response: reqwest::Response, label: &str) -> Result<Value, String> {
    let status = response.status();
    let response_text = response.text().await.map_err(|error| {
        format!(
            "Failed to read third-party video {} response: {}",
            label, error
        )
    })?;

    let payload = serde_json::from_str::<Value>(&response_text).map_err(|error| {
        format!(
            "Failed to parse third-party video {} response JSON: {}. Response was: {}",
            label, error, response_text
        )
    })?;

    if !status.is_success() {
        return Err(extract_error_message(&payload).unwrap_or_else(|| {
            format!(
                "Third-party video {} API returned {}: {}",
                label, status, payload
            )
        }));
    }

    Ok(payload)
}

fn is_json_parse_error(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    normalized.contains("unexpected end of json input")
        || normalized.contains("unterminated string starting at")
        || normalized.contains("json decode error")
        || normalized.contains("json_invalid")
        || normalized.contains("eof while parsing")
}

fn should_retry_http_status(status: reqwest::StatusCode, response_text: &str) -> bool {
    matches!(status.as_u16(), 409 | 425 | 429 | 500 | 502 | 503)
        || (status.as_u16() == 400 && is_json_parse_error(response_text))
}

fn should_retry_transport_error(error: &reqwest::Error) -> bool {
    error.is_connect() && !error.is_timeout()
}

fn should_use_curl_json_transport(payload_len: usize) -> bool {
    payload_len >= CURL_JSON_TRANSPORT_MIN_BYTES
}

fn parse_response_text_json(response_text: &str, label: &str) -> Result<Value, String> {
    serde_json::from_str::<Value>(response_text).map_err(|error| {
        format!(
            "Failed to parse third-party video {} response JSON: {}. Response was: {}",
            label, error, response_text
        )
    })
}

async fn send_video_create_json_with_curl(
    endpoint: String,
    api_key: String,
    payload: Vec<u8>,
) -> Result<(reqwest::StatusCode, String), String> {
    tokio::task::spawn_blocking(move || {
        let request_file_path = std::env::temp_dir().join(format!(
            "storyboard-copilot-oopii-video-request-{}.json",
            uuid::Uuid::new_v4()
        ));
        let response_file_path = std::env::temp_dir().join(format!(
            "storyboard-copilot-oopii-video-response-{}.txt",
            uuid::Uuid::new_v4()
        ));

        let result = (|| {
            fs::write(&request_file_path, &payload).map_err(|error| {
                format!(
                    "Failed to persist third-party video curl payload: {}",
                    error
                )
            })?;

            let curl_binary = if cfg!(target_os = "windows") {
                "curl.exe"
            } else {
                "curl"
            };
            let mut command = Command::new(curl_binary);
            #[cfg(target_os = "windows")]
            command.creation_flags(CREATE_NO_WINDOW);
            let output = command
                .arg("-sS")
                .arg("--http1.1")
                .arg("--connect-timeout")
                .arg("30")
                .arg("--max-time")
                .arg(CURL_JSON_TRANSPORT_TIMEOUT_SECONDS.to_string())
                .arg("-X")
                .arg("POST")
                .arg(&endpoint)
                .arg("-H")
                .arg("Accept: application/json")
                .arg("-H")
                .arg("Content-Type: application/json")
                .arg("-H")
                .arg("User-Agent: Storyboard-Copilot/third-party-video")
                .arg("-H")
                .arg(format!("Authorization: Bearer {}", api_key))
                .arg("--data-binary")
                .arg(format!("@{}", request_file_path.display()))
                .arg("-o")
                .arg(&response_file_path)
                .arg("-w")
                .arg("%{http_code}")
                .output()
                .map_err(|error| {
                    format!(
                        "Failed to execute curl for third-party video request: {}",
                        error
                    )
                })?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(if stderr.is_empty() {
                    format!(
                        "curl transport failed for third-party video request: exit status {}",
                        output.status
                    )
                } else {
                    format!(
                        "curl transport failed for third-party video request: {}",
                        stderr
                    )
                });
            }

            let status_code = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<u16>()
                .map_err(|error| {
                    format!(
                        "Failed to parse third-party video curl HTTP status: {}",
                        error
                    )
                })?;
            let response_bytes = fs::read(&response_file_path).map_err(|error| {
                format!("Failed to read third-party video curl response: {}", error)
            })?;
            let response_text = String::from_utf8_lossy(&response_bytes).into_owned();
            let status = reqwest::StatusCode::from_u16(status_code).map_err(|error| {
                format!("Invalid third-party video curl HTTP status: {}", error)
            })?;

            Ok((status, response_text))
        })();

        let _ = fs::remove_file(&request_file_path);
        let _ = fs::remove_file(&response_file_path);
        result
    })
    .await
    .map_err(|error| format!("Third-party video curl transport join error: {}", error))?
}

async fn send_video_create_json_request(
    client: &Client,
    endpoint: String,
    api_key: &str,
    payload: Vec<u8>,
) -> Result<Value, String> {
    let use_curl_transport = should_use_curl_json_transport(payload.len());

    for attempt in 1..=JSON_REQUEST_MAX_ATTEMPTS {
        if use_curl_transport {
            match send_video_create_json_with_curl(
                endpoint.clone(),
                api_key.to_string(),
                payload.clone(),
            )
            .await
            {
                Ok((status, response_text)) => {
                    if !status.is_success() {
                        if attempt < JSON_REQUEST_MAX_ATTEMPTS
                            && should_retry_http_status(status, &response_text)
                        {
                            sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                            continue;
                        }
                        let payload =
                            parse_response_text_json(&response_text, "create video task")?;
                        return Err(extract_error_message(&payload).unwrap_or_else(|| {
                            format!(
                                "Third-party video create video task API returned {}: {}",
                                status, payload
                            )
                        }));
                    }

                    return parse_response_text_json(&response_text, "create video task");
                }
                Err(_) => {
                    // Fall through to reqwest for environments without curl.
                }
            }
        }

        match client
            .post(&endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Storyboard-Copilot/third-party-video")
            .body(payload.clone())
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                let response_text = response.text().await.map_err(|error| {
                    format!(
                        "Failed to read third-party video create video task response: {}",
                        error
                    )
                })?;
                if !status.is_success() {
                    if attempt < JSON_REQUEST_MAX_ATTEMPTS
                        && should_retry_http_status(status, &response_text)
                    {
                        sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                        continue;
                    }
                    let payload = parse_response_text_json(&response_text, "create video task")?;
                    return Err(extract_error_message(&payload).unwrap_or_else(|| {
                        format!(
                            "Third-party video create video task API returned {}: {}",
                            status, payload
                        )
                    }));
                }

                return parse_response_text_json(&response_text, "create video task");
            }
            Err(error)
                if attempt < JSON_REQUEST_MAX_ATTEMPTS && should_retry_transport_error(&error) =>
            {
                sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to call third-party video create task API: {}",
                    error
                ));
            }
        }
    }

    Err(format!(
        "Third-party video create task failed after {} attempts",
        JSON_REQUEST_MAX_ATTEMPTS
    ))
}

async fn parse_binary_response(
    response: reqwest::Response,
    label: &str,
) -> Result<Vec<u8>, String> {
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| {
        format!(
            "Failed to read third-party video {} response bytes: {}",
            label, error
        )
    })?;

    if !status.is_success() {
        let fallback_text = String::from_utf8_lossy(&bytes).into_owned();
        if let Ok(payload) = serde_json::from_slice::<Value>(&bytes) {
            return Err(extract_error_message(&payload).unwrap_or_else(|| {
                format!(
                    "Third-party video {} API returned {}: {}",
                    label, status, payload
                )
            }));
        }

        return Err(format!(
            "Third-party video {} API returned {}: {}",
            label, status, fallback_text
        ));
    }

    Ok(bytes.to_vec())
}

fn resolve_binary_extension(content_type: Option<&str>) -> &'static str {
    let normalized = content_type.unwrap_or_default().trim().to_ascii_lowercase();
    if normalized.contains("video/mp4") {
        return "mp4";
    }
    if normalized.contains("video/quicktime") {
        return "mov";
    }
    "mp4"
}

fn build_video_http_client() -> Result<Client, String> {
    Client::builder()
        .http1_only()
        .build()
        .map_err(|error| format!("Failed to build third-party video HTTP client: {}", error))
}

fn normalize_video_image_input(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(Value::String(trimmed.to_string()))
            }
        }
        Value::Object(object) => object.get("url").and_then(Value::as_str).and_then(|url| {
            let trimmed = url.trim();
            if trimmed.is_empty() {
                None
            } else {
                let mut normalized = Map::new();
                normalized.insert("url".to_string(), Value::String(trimmed.to_string()));
                Some(Value::Object(normalized))
            }
        }),
        _ => None,
    }
}

#[tauri::command]
pub async fn create_gpt_best_video_task(
    payload: CreateGptBestVideoTaskPayload,
) -> Result<CreateGptBestVideoTaskResponse, String> {
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("Third-party video API key is required".to_string());
    }

    let base_url = normalize_base_url(&payload.base_url)?;
    let model = payload.model.trim();
    if model.is_empty() {
        return Err("Third-party video model is required".to_string());
    }

    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("Third-party video prompt is required".to_string());
    }

    if payload.seconds <= 0 {
        return Err("Third-party video seconds must be greater than 0".to_string());
    }

    let size = payload.size.trim();
    if size.is_empty() {
        return Err("Third-party video size is required".to_string());
    }

    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(model.to_string()));
    body.insert("prompt".to_string(), Value::String(prompt.to_string()));
    body.insert("seconds".to_string(), Value::Number(payload.seconds.into()));
    body.insert("size".to_string(), Value::String(size.to_string()));
    if let Some(image) = payload.image.as_ref().and_then(normalize_video_image_input) {
        body.insert("image".to_string(), image);
    }
    let reference_images: Vec<Value> = payload
        .reference_images
        .iter()
        .filter_map(normalize_video_image_input)
        .take(7)
        .collect();
    if !reference_images.is_empty() {
        body.insert(
            "reference_images".to_string(),
            Value::Array(reference_images),
        );
    }

    let request_body = Value::Object(body);
    let request_body_bytes = serde_json::to_vec(&request_body).map_err(|error| {
        format!(
            "Failed to serialize third-party video create task request JSON: {}",
            error
        )
    })?;

    let client = build_video_http_client()?;
    let response_payload = send_video_create_json_request(
        &client,
        videos_endpoint(&base_url),
        api_key,
        request_body_bytes,
    )
    .await?;
    let task_id = extract_task_id(&response_payload).ok_or_else(|| {
        extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Third-party video create task response did not include task_id: {}",
                response_payload
            )
        })
    })?;

    Ok(CreateGptBestVideoTaskResponse { task_id })
}

#[tauri::command]
pub async fn get_gpt_best_video_task(
    payload: GetGptBestVideoTaskPayload,
) -> Result<GetGptBestVideoTaskResponse, String> {
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("Third-party video API key is required".to_string());
    }

    let base_url = normalize_base_url(&payload.base_url)?;
    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Third-party video task_id is required".to_string());
    }

    let client = build_video_http_client()?;
    let response = client
        .get(query_endpoint(&base_url, task_id))
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|error| format!("Failed to call third-party video query task API: {}", error))?;

    let response_payload = parse_json_response(response, "query video task").await?;
    let resolved_task_id =
        extract_task_id(&response_payload).unwrap_or_else(|| task_id.to_string());

    Ok(GetGptBestVideoTaskResponse {
        task_id: resolved_task_id,
        status: extract_string(
            &response_payload,
            &["/data/status", "/status", "/data/state", "/state"],
        )
        .unwrap_or_else(|| "UNKNOWN".to_string()),
        model: extract_string(&response_payload, &["/data/model", "/model"]),
        cover_url: extract_string(
            &response_payload,
            &[
                "/data/cover_url",
                "/cover_url",
                "/data/poster_url",
                "/poster_url",
            ],
        ),
        output_url: extract_output_url(&response_payload),
        size: extract_string(&response_payload, &["/data/size", "/size"]),
        seconds: extract_i32(&response_payload, &["/data/seconds", "/seconds"]),
        error_message: extract_error_message(&response_payload),
        created_at: extract_i64(&response_payload, &["/data/created_at", "/created_at"]),
        updated_at: extract_i64(&response_payload, &["/data/updated_at", "/updated_at"]),
    })
}

#[tauri::command]
pub async fn download_gpt_best_video_content(
    app: AppHandle,
    payload: DownloadGptBestVideoContentPayload,
) -> Result<DownloadGptBestVideoContentResponse, String> {
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("Third-party video API key is required".to_string());
    }

    let base_url = normalize_base_url(&payload.base_url)?;
    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Third-party video task_id is required".to_string());
    }

    let client = build_video_http_client()?;
    let response = client
        .get(content_endpoint(&base_url, task_id))
        .header("Accept", "video/mp4,application/octet-stream,*/*")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|error| format!("Failed to call third-party video content API: {}", error))?;

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = parse_binary_response(response, "download video content").await?;
    let extension = resolve_binary_extension(content_type.as_deref());
    let persisted_path = storage::persist_media_bytes(
        &app,
        &bytes,
        extension,
        payload.media_context.as_ref(),
        "original",
    )?;

    Ok(DownloadGptBestVideoContentResponse {
        video_url: persisted_path,
        file_name: Some(format!("third-party-video-{}.{}", task_id, extension)),
    })
}
