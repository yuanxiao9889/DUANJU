use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn};

const ARK_TASKS_ENDPOINT: &str =
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const JSON_REQUEST_MAX_ATTEMPTS: usize = 2;
const JSON_REQUEST_RETRY_DELAY_MS: u64 = 2_000;
const CURL_JSON_TRANSPORT_MIN_BYTES: usize = 64 * 1024;
const CURL_JSON_TRANSPORT_TIMEOUT_SECONDS: u64 = 1_000;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedanceContentUrlPayload {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedanceContentItemPayload {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<SeedanceContentUrlPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<SeedanceContentUrlPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_url: Option<SeedanceContentUrlPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSeedanceVideoTaskPayload {
    pub api_key: String,
    pub model: String,
    pub content: Vec<SeedanceContentItemPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generate_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_last_frame: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watermark: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSeedanceVideoTaskResponse {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetSeedanceVideoTaskPayload {
    pub api_key: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetSeedanceVideoTaskResponse {
    pub task_id: String,
    pub status: String,
    pub model: Option<String>,
    pub video_url: Option<String>,
    pub last_frame_url: Option<String>,
    pub resolution: Option<String>,
    pub ratio: Option<String>,
    pub duration: Option<i32>,
    pub generate_audio: Option<bool>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArkCreateTaskResponse {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArkGetTaskContent {
    video_url: Option<String>,
    last_frame_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ArkGetTaskResponse {
    id: Option<String>,
    status: Option<String>,
    model: Option<String>,
    content: Option<ArkGetTaskContent>,
    resolution: Option<String>,
    ratio: Option<String>,
    duration: Option<i32>,
    generate_audio: Option<bool>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    error: Option<Value>,
}

fn insert_optional_string(body: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(normalized) = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
    {
        body.insert(key.to_string(), Value::String(normalized));
    }
}

fn insert_optional_bool(body: &mut Map<String, Value>, key: &str, value: Option<bool>) {
    if let Some(normalized) = value {
        body.insert(key.to_string(), Value::Bool(normalized));
    }
}

fn insert_optional_i32(body: &mut Map<String, Value>, key: &str, value: Option<i32>) {
    if let Some(normalized) = value {
        body.insert(key.to_string(), Value::Number(normalized.into()));
    }
}

fn extract_error_message(payload: &Value) -> Option<String> {
    [
        "/error/message",
        "/error/code",
        "/message",
        "/detail",
        "/details",
        "/msg",
    ]
    .iter()
    .find_map(|pointer| {
        payload
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
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

async fn parse_response_json(
    response: reqwest::Response,
) -> Result<(reqwest::StatusCode, Value), String> {
    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Seedance response body: {}", error))?;

    let payload = serde_json::from_str::<Value>(&response_text).map_err(|error| {
        format!(
            "Failed to parse Seedance response JSON: {}. Response was: {}",
            error, response_text
        )
    })?;

    Ok((status, payload))
}

fn parse_response_text_json(
    status: reqwest::StatusCode,
    response_text: &str,
) -> Result<Value, String> {
    serde_json::from_str::<Value>(response_text)
        .map_err(|error| {
            format!(
                "Failed to parse Seedance response JSON: {}. Response was: {}",
                error, response_text
            )
        })
        .map(|payload| {
            if !status.is_success() {
                payload
            } else {
                payload
            }
        })
}

async fn send_seedance_json_with_curl(
    api_key: String,
    payload: Vec<u8>,
) -> Result<(reqwest::StatusCode, String), String> {
    tokio::task::spawn_blocking(move || {
        let request_file_path = std::env::temp_dir().join(format!(
            "storyboard-copilot-seedance-request-{}.json",
            uuid::Uuid::new_v4()
        ));
        let response_file_path = std::env::temp_dir().join(format!(
            "storyboard-copilot-seedance-response-{}.txt",
            uuid::Uuid::new_v4()
        ));

        let result = (|| {
            fs::write(&request_file_path, &payload)
                .map_err(|error| format!("Failed to persist Seedance curl payload: {}", error))?;

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
                .arg(ARK_TASKS_ENDPOINT)
                .arg("-H")
                .arg("Accept: application/json")
                .arg("-H")
                .arg("Content-Type: application/json")
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
                    format!("Failed to execute curl for Seedance request: {}", error)
                })?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(if stderr.is_empty() {
                    format!(
                        "curl transport failed for Seedance request: exit status {}",
                        output.status
                    )
                } else {
                    format!("curl transport failed for Seedance request: {}", stderr)
                });
            }

            let status_code = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<u16>()
                .map_err(|error| format!("Failed to parse Seedance curl HTTP status: {}", error))?;
            let response_bytes = fs::read(&response_file_path)
                .map_err(|error| format!("Failed to read Seedance curl response: {}", error))?;
            let response_text = String::from_utf8_lossy(&response_bytes).into_owned();
            let status = reqwest::StatusCode::from_u16(status_code)
                .map_err(|error| format!("Invalid Seedance curl HTTP status: {}", error))?;

            Ok((status, response_text))
        })();

        let _ = fs::remove_file(&request_file_path);
        let _ = fs::remove_file(&response_file_path);
        result
    })
    .await
    .map_err(|error| format!("Seedance curl transport join error: {}", error))?
}

async fn send_seedance_create_task_request(
    client: &Client,
    api_key: &str,
    body: Value,
) -> Result<Value, String> {
    let payload = serde_json::to_vec(&body)
        .map_err(|error| format!("Failed to serialize Seedance request body: {}", error))?;
    info!(
        "[Seedance] create task request body bytes: {}",
        payload.len()
    );
    let use_curl_transport = should_use_curl_json_transport(payload.len());
    if use_curl_transport {
        info!(
            "[Seedance] create task request body exceeded {} bytes, preferring curl transport",
            CURL_JSON_TRANSPORT_MIN_BYTES
        );
    }

    for attempt in 1..=JSON_REQUEST_MAX_ATTEMPTS {
        if use_curl_transport {
            match send_seedance_json_with_curl(api_key.to_string(), payload.clone()).await {
                Ok((status, response_text)) => {
                    info!(
                        "[Seedance] create task attempt {}/{} -> {} (curl)",
                        attempt, JSON_REQUEST_MAX_ATTEMPTS, status
                    );
                    info!(
                        "[Seedance] create task attempt {}/{} response (curl): {}",
                        attempt, JSON_REQUEST_MAX_ATTEMPTS, response_text
                    );
                    if !status.is_success() {
                        if attempt < JSON_REQUEST_MAX_ATTEMPTS
                            && should_retry_http_status(status, &response_text)
                        {
                            warn!(
                                "[Seedance] create task attempt {}/{} hit retryable status {} via curl. Retrying after {}ms.",
                                attempt,
                                JSON_REQUEST_MAX_ATTEMPTS,
                                status,
                                JSON_REQUEST_RETRY_DELAY_MS
                            );
                            sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                            continue;
                        }
                        let payload = parse_response_text_json(status, &response_text)?;
                        return Err(extract_error_message(&payload).unwrap_or_else(|| {
                            format!("Seedance create task API returned {}: {}", status, payload)
                        }));
                    }

                    return parse_response_text_json(status, &response_text);
                }
                Err(error) => {
                    warn!(
                        "[Seedance] create task attempt {}/{} curl transport unavailable, falling back to reqwest: {}",
                        attempt, JSON_REQUEST_MAX_ATTEMPTS, error
                    );
                }
            }
        }

        match client
            .post(ARK_TASKS_ENDPOINT)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .body(payload.clone())
            .send()
            .await
        {
            Ok(response) => {
                let (status, response_payload) = parse_response_json(response).await?;
                info!(
                    "[Seedance] create task attempt {}/{} -> {}",
                    attempt, JSON_REQUEST_MAX_ATTEMPTS, status
                );
                info!(
                    "[Seedance] create task attempt {}/{} response: {}",
                    attempt, JSON_REQUEST_MAX_ATTEMPTS, response_payload
                );
                if !status.is_success() {
                    let response_text = response_payload.to_string();
                    if attempt < JSON_REQUEST_MAX_ATTEMPTS
                        && should_retry_http_status(status, &response_text)
                    {
                        warn!(
                            "[Seedance] create task attempt {}/{} hit retryable status {}. Retrying after {}ms.",
                            attempt,
                            JSON_REQUEST_MAX_ATTEMPTS,
                            status,
                            JSON_REQUEST_RETRY_DELAY_MS
                        );
                        sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                        continue;
                    }
                    return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
                        format!(
                            "Seedance create task API returned {}: {}",
                            status, response_payload
                        )
                    }));
                }

                return Ok(response_payload);
            }
            Err(error)
                if attempt < JSON_REQUEST_MAX_ATTEMPTS && should_retry_transport_error(&error) =>
            {
                warn!(
                    "[Seedance] create task attempt {}/{} hit retryable transport error: {}. Retrying after {}ms.",
                    attempt,
                    JSON_REQUEST_MAX_ATTEMPTS,
                    error,
                    JSON_REQUEST_RETRY_DELAY_MS
                );
                sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
            }
            Err(error) => {
                return Err(format!(
                    "Failed to call Seedance create task API: {}",
                    error
                ))
            }
        }
    }

    Err(format!(
        "Seedance create task request exhausted {} attempts without a response",
        JSON_REQUEST_MAX_ATTEMPTS
    ))
}

#[tauri::command]
pub async fn create_seedance_video_task(
    payload: CreateSeedanceVideoTaskPayload,
) -> Result<CreateSeedanceVideoTaskResponse, String> {
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("Volcengine API key is required".to_string());
    }

    let model = payload.model.trim();
    if model.is_empty() {
        return Err("Seedance model id is required".to_string());
    }

    if payload.content.is_empty() {
        return Err("Seedance request content is empty".to_string());
    }

    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(model.to_string()));
    body.insert(
        "content".to_string(),
        serde_json::to_value(&payload.content)
            .map_err(|error| format!("Failed to serialize Seedance content: {}", error))?,
    );
    insert_optional_string(&mut body, "ratio", payload.ratio);
    insert_optional_i32(&mut body, "duration", payload.duration);
    insert_optional_string(&mut body, "resolution", payload.resolution);
    insert_optional_bool(&mut body, "generate_audio", payload.generate_audio);
    insert_optional_bool(&mut body, "return_last_frame", payload.return_last_frame);
    insert_optional_bool(&mut body, "watermark", payload.watermark);

    info!(
        "[Seedance] create task: model={}, content_items={}",
        model,
        payload.content.len()
    );

    let client = Client::new();
    let response_payload =
        send_seedance_create_task_request(&client, api_key, Value::Object(body)).await?;

    let parsed: ArkCreateTaskResponse = serde_json::from_value(response_payload.clone())
        .map_err(|error| format!("Failed to parse Seedance create task response: {}", error))?;
    let task_id = parsed
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            extract_error_message(&response_payload).unwrap_or_else(|| {
                format!(
                    "Seedance create task response did not include task id: {}",
                    response_payload
                )
            })
        })?;

    Ok(CreateSeedanceVideoTaskResponse { task_id })
}

#[tauri::command]
pub async fn get_seedance_video_task(
    payload: GetSeedanceVideoTaskPayload,
) -> Result<GetSeedanceVideoTaskResponse, String> {
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("Volcengine API key is required".to_string());
    }

    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Seedance task id is required".to_string());
    }

    let endpoint = format!("{}/{}", ARK_TASKS_ENDPOINT, task_id);
    let client = Client::new();
    let response = client
        .get(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|error| format!("Failed to call Seedance query task API: {}", error))?;

    let (status, response_payload) = parse_response_json(response).await?;
    if !status.is_success() {
        return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Seedance query task API returned {}: {}",
                status, response_payload
            )
        }));
    }

    let parsed: ArkGetTaskResponse = serde_json::from_value(response_payload.clone())
        .map_err(|error| format!("Failed to parse Seedance task response: {}", error))?;
    let resolved_task_id = parsed
        .id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| task_id.to_string());
    let error_message = parsed
        .error
        .as_ref()
        .and_then(extract_error_message)
        .or_else(|| extract_error_message(&response_payload));

    Ok(GetSeedanceVideoTaskResponse {
        task_id: resolved_task_id,
        status: parsed
            .status
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "unknown".to_string()),
        model: parsed.model.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        video_url: parsed
            .content
            .as_ref()
            .and_then(|content| content.video_url.clone())
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
        last_frame_url: parsed
            .content
            .as_ref()
            .and_then(|content| content.last_frame_url.clone())
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
        resolution: parsed.resolution.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        ratio: parsed.ratio.and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }),
        duration: parsed.duration,
        generate_audio: parsed.generate_audio,
        created_at: parsed.created_at,
        updated_at: parsed.updated_at,
        error_message,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_json_parse_error, should_retry_http_status};

    #[test]
    fn seedance_retry_detection_matches_upstream_json_parse_errors() {
        assert!(is_json_parse_error("unexpected end of JSON input"));
        assert!(is_json_parse_error("json_invalid"));
        assert!(!is_json_parse_error("model not found"));
    }

    #[test]
    fn seedance_retry_http_status_for_bad_request_parse_error() {
        assert!(should_retry_http_status(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"message":"unexpected end of JSON input"}}"#
        ));
        assert!(!should_retry_http_status(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"error":{"message":"invalid api key"}}"#
        ));
    }
}
