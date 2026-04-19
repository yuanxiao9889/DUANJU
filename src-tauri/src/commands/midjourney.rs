use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
#[cfg(target_os = "windows")]
use std::process::{Command, Output};
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::time::{SystemTime, UNIX_EPOCH};

const MIDJOURNEY_REQUEST_TIMEOUT_SECS: u64 = 180;
const COMFLY_STYLE_UPLOAD_ENDPOINTS: [&str; 2] = [
    "https://ai.comfly.chat/v1/files",
    "https://ai.comfly.chat/v1/upload",
];
const ZHENZHEN_STYLE_UPLOAD_ENDPOINTS: [&str; 2] = [
    "https://ai.t8star.cn/v1/files",
    "https://ai.t8star.cn/v1/upload",
];
const BLTCY_STYLE_UPLOAD_ENDPOINTS: [&str; 2] = [
    "https://api.bltcy.ai/v1/upload",
    "https://api.bltcy.ai/v1/files",
];
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy)]
struct MidjourneyProviderConfig {
    provider_id: &'static str,
    imagine_endpoint: &'static str,
    action_endpoint: &'static str,
    modal_endpoint: &'static str,
    task_fetch_endpoint_prefix: &'static str,
    prompt_image_upload_endpoint: &'static str,
    style_upload_endpoints: &'static [&'static str],
}

fn resolve_midjourney_provider_config(
    provider_id: &str,
) -> Result<MidjourneyProviderConfig, String> {
    match provider_id.trim() {
        "comfly" => Ok(MidjourneyProviderConfig {
            provider_id: "comfly",
            imagine_endpoint: "https://ai.comfly.chat/mj/submit/imagine",
            action_endpoint: "https://ai.comfly.chat/mj/submit/action",
            modal_endpoint: "https://ai.comfly.chat/mj/submit/modal",
            task_fetch_endpoint_prefix: "https://ai.comfly.chat/mj/task",
            prompt_image_upload_endpoint: "https://ai.comfly.chat/mj/submit/upload-discord-images",
            style_upload_endpoints: &COMFLY_STYLE_UPLOAD_ENDPOINTS,
        }),
        "zhenzhen" => Ok(MidjourneyProviderConfig {
            provider_id: "zhenzhen",
            imagine_endpoint: "https://ai.t8star.cn/mj/submit/imagine",
            action_endpoint: "https://ai.t8star.cn/mj/submit/action",
            modal_endpoint: "https://ai.t8star.cn/mj/submit/modal",
            task_fetch_endpoint_prefix: "https://ai.t8star.cn/mj/task",
            prompt_image_upload_endpoint: "https://ai.t8star.cn/mj/submit/upload-discord-images",
            style_upload_endpoints: &ZHENZHEN_STYLE_UPLOAD_ENDPOINTS,
        }),
        "bltcy" => Ok(MidjourneyProviderConfig {
            provider_id: "bltcy",
            imagine_endpoint: "https://api.bltcy.ai/mj/submit/imagine",
            action_endpoint: "https://api.bltcy.ai/mj/submit/action",
            modal_endpoint: "https://api.bltcy.ai/mj/submit/modal",
            task_fetch_endpoint_prefix: "https://api.bltcy.ai/mj/task",
            prompt_image_upload_endpoint: "https://api.bltcy.ai/mj/submit/upload-discord-images",
            style_upload_endpoints: &BLTCY_STYLE_UPLOAD_ENDPOINTS,
        }),
        other => Err(format!("unsupported Midjourney provider: {}", other)),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitMidjourneyImaginePayload {
    pub provider_id: String,
    pub api_key: String,
    pub prompt: String,
    #[serde(default)]
    pub reference_images: Vec<String>,
    #[serde(default)]
    pub style_reference_images: Vec<String>,
    pub aspect_ratio: Option<String>,
    pub raw_mode: Option<bool>,
    pub version_preset: Option<String>,
    pub advanced_params: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitMidjourneyImagineResponse {
    pub task_id: String,
    pub prompt: String,
    pub final_prompt: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QueryMidjourneyTasksPayload {
    pub provider_id: String,
    pub api_key: String,
    #[serde(default)]
    pub task_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitMidjourneyActionPayload {
    pub provider_id: String,
    pub api_key: String,
    pub task_id: String,
    pub custom_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitMidjourneyModalPayload {
    pub provider_id: String,
    pub api_key: String,
    pub task_id: String,
    pub prompt: Option<String>,
    pub mask_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidjourneyMutationResponse {
    pub code: Option<i64>,
    pub task_id: Option<String>,
    pub description: Option<String>,
    pub state: Option<Value>,
    pub properties: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidjourneyTaskButtonDto {
    pub custom_id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub button_type: Option<String>,
    #[serde(rename = "style")]
    pub style_value: Option<String>,
    pub emoji: Option<String>,
    pub group_index: usize,
    pub order: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidjourneyTaskDto {
    pub id: String,
    pub action: Option<String>,
    pub status: String,
    pub progress: String,
    pub image_url: Option<String>,
    #[serde(default)]
    pub image_urls: Vec<String>,
    pub prompt: Option<String>,
    pub prompt_en: Option<String>,
    pub final_prompt: Option<String>,
    #[serde(default)]
    pub buttons: Vec<MidjourneyTaskButtonDto>,
    pub properties: Option<Value>,
    pub state: Option<Value>,
    pub fail_reason: Option<String>,
    pub submit_time: Option<i64>,
    pub start_time: Option<i64>,
    pub finish_time: Option<i64>,
}

#[derive(Debug, Clone)]
struct SourceBytes {
    bytes: Vec<u8>,
    mime: String,
    extension: String,
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(MIDJOURNEY_REQUEST_TIMEOUT_SECS))
        .http1_only()
        .build()
        .map_err(|error| format!("failed to build Midjourney client: {error}"))
}

const CURL_HTTP_STATUS_MARKER: &str = "__CURL_HTTP_STATUS__:";

#[cfg(target_os = "windows")]
fn parse_curl_json_output(output: Output) -> Result<(u16, Value), String> {
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let marker_index = stdout
        .rfind(CURL_HTTP_STATUS_MARKER)
        .ok_or_else(|| format!("curl response missing status marker. stderr: {}", stderr))?;
    let body = stdout[..marker_index].trim().to_string();
    let status_text = stdout[marker_index + CURL_HTTP_STATUS_MARKER.len()..]
        .trim()
        .to_string();
    let status_code = status_text.parse::<u16>().map_err(|error| {
        format!(
            "failed to parse curl http status {}: {}",
            status_text, error
        )
    })?;

    if !output.status.success() && body.is_empty() {
        return Err(format!(
            "curl request failed with exit code {:?}: {}",
            output.status.code(),
            stderr
        ));
    }

    let payload = serde_json::from_str::<Value>(&body).map_err(|error| {
        format!(
            "failed to parse curl response JSON: {}. Response: {}. stderr: {}",
            error, body, stderr
        )
    })?;

    Ok((status_code, payload))
}

#[cfg(target_os = "windows")]
fn run_curl_json_post(endpoint: &str, api_key: &str, body: &Value) -> Result<(u16, Value), String> {
    let body_text = serde_json::to_string(body)
        .map_err(|error| format!("failed to serialize curl json body: {}", error))?;
    let mut temp_path = std::env::temp_dir();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to create curl payload timestamp: {}", error))?
        .as_millis();
    temp_path.push(format!(
        "storyboard-mj-request-{}-{}.json",
        std::process::id(),
        nonce
    ));
    std::fs::write(&temp_path, body_text.as_bytes()).map_err(|error| {
        format!(
            "failed to write temp Midjourney request body {}: {}",
            temp_path.display(),
            error
        )
    })?;

    let mut command = Command::new("curl.exe");
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args([
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            "180",
            "--request",
            "POST",
            endpoint,
            "--header",
            &format!("Authorization: Bearer {}", api_key),
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            &format!("@{}", temp_path.display()),
            "--write-out",
            &format!("\n{}%{{http_code}}", CURL_HTTP_STATUS_MARKER),
        ])
        .output();

    let cleanup_result = std::fs::remove_file(&temp_path);
    let parsed = output
        .map_err(|error| format!("failed to launch curl.exe for {}: {}", endpoint, error))
        .and_then(parse_curl_json_output);
    if let Err(error) = cleanup_result {
        eprintln!(
            "failed to remove temp Midjourney request file {}: {}",
            temp_path.display(),
            error
        );
    }

    parsed
}

#[cfg(target_os = "windows")]
fn create_temp_upload_file(source: &SourceBytes) -> Result<std::path::PathBuf, String> {
    let mut path = std::env::temp_dir();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("failed to create upload timestamp: {}", error))?
        .as_millis();
    let extension = source.extension.trim().trim_start_matches('.');
    path.push(format!(
        "storyboard-mj-upload-{}-{}.{}",
        std::process::id(),
        nonce,
        if extension.is_empty() {
            "bin"
        } else {
            extension
        }
    ));
    std::fs::write(&path, &source.bytes).map_err(|error| {
        format!(
            "failed to write temp upload file {}: {}",
            path.display(),
            error
        )
    })?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn run_curl_file_upload(
    endpoint: &str,
    api_key: &str,
    source: &SourceBytes,
) -> Result<(u16, Value), String> {
    let temp_path = create_temp_upload_file(source)?;
    let form_value = format!("file=@{};type={}", temp_path.display(), source.mime);

    let mut command = Command::new("curl.exe");
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args([
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            "180",
            "--request",
            "POST",
            endpoint,
            "--header",
            &format!("Authorization: Bearer {}", api_key),
            "--form",
            &form_value,
            "--write-out",
            &format!("\n{}%{{http_code}}", CURL_HTTP_STATUS_MARKER),
        ])
        .output()
        .map_err(|error| format!("failed to launch curl.exe for {}: {}", endpoint, error));

    let cleanup_result = std::fs::remove_file(&temp_path);
    let parsed = output.and_then(parse_curl_json_output);
    if let Err(error) = cleanup_result {
        eprintln!(
            "failed to remove temp Midjourney upload file {}: {}",
            temp_path.display(),
            error
        );
    }
    parsed
}

fn extension_from_mime(mime: &str) -> String {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => "png".to_string(),
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/webp" => "webp".to_string(),
        "image/gif" => "gif".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/tiff" => "tiff".to_string(),
        "image/avif" => "avif".to_string(),
        _ => "png".to_string(),
    }
}

fn mime_from_extension(extension: &str) -> String {
    match extension.trim().to_ascii_lowercase().as_str() {
        "png" => "image/png".to_string(),
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "webp" => "image/webp".to_string(),
        "gif" => "image/gif".to_string(),
        "bmp" => "image/bmp".to_string(),
        "tif" | "tiff" => "image/tiff".to_string(),
        "avif" => "image/avif".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn parse_data_url(source: &str) -> Result<SourceBytes, String> {
    let (meta, payload) = source
        .split_once(',')
        .ok_or_else(|| "invalid data URL format".to_string())?;

    if !meta.starts_with("data:") || !meta.ends_with(";base64") {
        return Err("only base64 data URL is supported".to_string());
    }

    let mime = meta
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .unwrap_or("image/png")
        .trim()
        .to_string();

    let bytes = BASE64_STANDARD
        .decode(payload)
        .map_err(|error| format!("failed to decode data URL: {error}"))?;

    Ok(SourceBytes {
        bytes,
        extension: extension_from_mime(&mime),
        mime,
    })
}

async fn read_source_bytes(client: &Client, source: &str) -> Result<SourceBytes, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("image source is empty".to_string());
    }

    if trimmed.starts_with("data:") {
        return parse_data_url(trimmed);
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let response = client
            .get(trimmed)
            .send()
            .await
            .map_err(|error| format!("failed to download image source: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "image source request failed with status {}",
                response.status()
            ));
        }

        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "image/png".to_string());
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("failed to read downloaded image bytes: {error}"))?
            .to_vec();

        return Ok(SourceBytes {
            extension: extension_from_mime(&mime),
            mime,
            bytes,
        });
    }

    let path = Path::new(trimmed);
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read local image source {}: {error}", trimmed))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "png".to_string());
    let mime = mime_from_extension(&extension);

    Ok(SourceBytes {
        bytes,
        mime,
        extension,
    })
}

fn source_bytes_to_data_url(source: &SourceBytes) -> String {
    format!(
        "data:{};base64,{}",
        source.mime,
        BASE64_STANDARD.encode(&source.bytes)
    )
}

fn is_provider_proxy_image_url(provider: MidjourneyProviderConfig, image_url: &str) -> bool {
    let trimmed = image_url.trim();
    if trimmed.is_empty() {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    let provider_base = provider
        .task_fetch_endpoint_prefix
        .trim_end_matches("/mj/task")
        .to_ascii_lowercase();

    lower.contains("/mj/image/") || (!provider_base.is_empty() && lower.starts_with(&provider_base))
}

fn normalize_scalar_string(value: &Value) -> Option<String> {
    let normalized = match value {
        Value::String(text) => text.trim().to_string(),
        Value::Number(number) => number.to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        _ => String::new(),
    };

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn extract_image_like_url_from_object(record: &serde_json::Map<String, Value>) -> Option<String> {
    const CANDIDATE_KEYS: [&str; 15] = [
        "url",
        "imageUrl",
        "image_url",
        "src",
        "value",
        "uri",
        "href",
        "rawUrl",
        "raw_url",
        "originUrl",
        "origin_url",
        "downloadUrl",
        "download_url",
        "previewUrl",
        "preview_url",
    ];

    for key in CANDIDATE_KEYS {
        if let Some(value) = record.get(key) {
            if let Some(url) = normalize_scalar_string(value) {
                return Some(url);
            }
        }
    }

    for nested in record.values() {
        if let Value::Object(nested_record) = nested {
            if let Some(url) = extract_image_like_url_from_object(nested_record) {
                return Some(url);
            }
        }
    }

    None
}

fn extract_string_by_pointers(payload: &Value, pointers: &[&str]) -> Option<String> {
    pointers
        .iter()
        .find_map(|pointer| payload.pointer(pointer).and_then(normalize_scalar_string))
}

fn extract_string_array_by_pointers(payload: &Value, pointers: &[&str]) -> Vec<String> {
    pointers
        .iter()
        .find_map(|pointer| {
            payload.pointer(pointer).and_then(|value| match value {
                Value::Array(items) => {
                    let values: Vec<String> = items
                        .iter()
                        .filter_map(|item| match item {
                            Value::String(_) | Value::Number(_) | Value::Bool(_) => {
                                normalize_scalar_string(item)
                            }
                            Value::Object(record) => extract_image_like_url_from_object(record),
                            _ => None,
                        })
                        .filter(|value| !value.is_empty())
                        .collect();
                    if values.is_empty() {
                        None
                    } else {
                        Some(values)
                    }
                }
                _ => None,
            })
        })
        .unwrap_or_default()
}

fn extract_string_array_or_wrapped_string_by_pointers(
    payload: &Value,
    pointers: &[&str],
) -> Vec<String> {
    let values = extract_string_array_by_pointers(payload, pointers);
    if !values.is_empty() {
        return values;
    }

    extract_string_by_pointers(payload, pointers)
        .into_iter()
        .collect()
}

fn extract_i64_by_pointers(payload: &Value, pointers: &[&str]) -> Option<i64> {
    pointers.iter().find_map(|pointer| {
        payload.pointer(pointer).and_then(|value| match value {
            Value::Number(number) => number.as_i64(),
            Value::String(text) => text.trim().parse::<i64>().ok(),
            _ => None,
        })
    })
}

fn extract_value_by_pointers(payload: &Value, pointers: &[&str]) -> Option<Value> {
    pointers
        .iter()
        .find_map(|pointer| payload.pointer(pointer).cloned())
}

fn extract_button_emoji(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let normalized = text.trim();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized.to_string())
            }
        }
        Value::Object(record) => extract_string_by_pointers(
            value,
            &["/name", "/label", "/shortcode", "/id", "/value", "/text"],
        )
        .or_else(|| record.values().find_map(extract_button_emoji)),
        _ => None,
    }
}

fn normalize_midjourney_button(
    value: &Value,
    group_index: usize,
    order: usize,
) -> Option<MidjourneyTaskButtonDto> {
    let record = match value {
        Value::Object(record) => record,
        _ => return None,
    };

    let custom_id = record
        .get("customId")
        .or_else(|| record.get("custom_id"))
        .or_else(|| record.get("id"))
        .and_then(normalize_scalar_string)?;
    let label = record
        .get("label")
        .or_else(|| record.get("text"))
        .or_else(|| record.get("name"))
        .and_then(normalize_scalar_string)
        .unwrap_or_else(|| custom_id.clone());

    Some(MidjourneyTaskButtonDto {
        custom_id,
        label,
        button_type: record.get("type").and_then(normalize_scalar_string),
        style_value: record.get("style").and_then(normalize_scalar_string),
        emoji: record.get("emoji").and_then(extract_button_emoji),
        group_index,
        order,
    })
}

fn normalize_midjourney_buttons_from_value(value: &Value) -> Vec<MidjourneyTaskButtonDto> {
    match value {
        Value::Array(items) => {
            if items.iter().any(|item| matches!(item, Value::Array(_))) {
                items
                    .iter()
                    .enumerate()
                    .flat_map(|(group_index, row)| match row {
                        Value::Array(row_items) => row_items
                            .iter()
                            .enumerate()
                            .filter_map(move |(order, item)| {
                                normalize_midjourney_button(item, group_index, order)
                            })
                            .collect::<Vec<_>>(),
                        _ => normalize_midjourney_button(row, group_index, 0)
                            .into_iter()
                            .collect::<Vec<_>>(),
                    })
                    .collect()
            } else {
                items
                    .iter()
                    .enumerate()
                    .filter_map(|(order, item)| normalize_midjourney_button(item, 0, order))
                    .collect()
            }
        }
        _ => normalize_midjourney_button(value, 0, 0)
            .into_iter()
            .collect(),
    }
}

fn extract_midjourney_buttons(payload: &Value) -> Vec<MidjourneyTaskButtonDto> {
    [
        "/buttons",
        "/result/buttons",
        "/data/buttons",
        "/properties/buttons",
        "/result/properties/buttons",
        "/data/properties/buttons",
        "/buttonMessage/buttons",
        "/result/buttonMessage/buttons",
        "/data/buttonMessage/buttons",
    ]
    .iter()
    .find_map(|pointer| {
        payload
            .pointer(pointer)
            .map(normalize_midjourney_buttons_from_value)
    })
    .unwrap_or_default()
}

fn extract_error_message(payload: &Value) -> Option<String> {
    extract_string_by_pointers(
        payload,
        &[
            "/description",
            "/message",
            "/msg",
            "/detail",
            "/details",
            "/error/message",
            "/error/msg",
            "/data/message",
            "/data/msg",
        ],
    )
}

async fn parse_json_response(
    response: reqwest::Response,
) -> Result<(reqwest::StatusCode, Value), String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("failed to read Midjourney response body: {error}"))?;

    let payload = serde_json::from_str::<Value>(&text).map_err(|error| {
        format!("failed to parse Midjourney response JSON: {error}. Response: {text}")
    })?;

    Ok((status, payload))
}

async fn fetch_authenticated_image_data_url(
    client: &Client,
    image_url: &str,
    api_key: &str,
) -> Result<String, String> {
    let response = client
        .get(image_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|error| format!("failed to fetch Midjourney image {}: {}", image_url, error))?;

    if !response.status().is_success() {
        return Err(format!(
            "Midjourney image request failed with status {} for {}",
            response.status(),
            image_url
        ));
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "image/png".to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|error| {
            format!(
                "failed to read Midjourney image body {}: {}",
                image_url, error
            )
        })?
        .to_vec();

    Ok(format!(
        "data:{};base64,{}",
        mime,
        BASE64_STANDARD.encode(bytes)
    ))
}

async fn normalize_task_image_urls(
    client: &Client,
    provider: MidjourneyProviderConfig,
    api_key: &str,
    image_urls: &[String],
) -> Vec<String> {
    let mut normalized_urls: Vec<String> = Vec::with_capacity(image_urls.len());

    for raw_image_url in image_urls {
        let image_url = raw_image_url.trim();
        if image_url.is_empty() {
            continue;
        }

        if is_provider_proxy_image_url(provider, image_url) {
            if let Ok(data_url) =
                fetch_authenticated_image_data_url(client, image_url, api_key).await
            {
                normalized_urls.push(data_url);
            }
            continue;
        }

        normalized_urls.push(image_url.to_string());
    }

    normalized_urls
}

async fn send_midjourney_json_request(
    client: &Client,
    endpoint: &str,
    api_key: &str,
    body: &Value,
    operation: &str,
) -> Result<(reqwest::StatusCode, Value), String> {
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(body)
        .send()
        .await;

    match response {
        Ok(response) => parse_json_response(response).await,
        Err(error) => {
            #[cfg(target_os = "windows")]
            {
                match run_curl_json_post(endpoint, api_key, body) {
                    Ok((status_code, payload)) => {
                        Ok((to_reqwest_status_code(status_code), payload))
                    }
                    Err(curl_error) => Err(format!(
                        "failed to {} via {}: {} | curl fallback: {}",
                        operation, endpoint, error, curl_error
                    )),
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                Err(format!(
                    "failed to {} via {}: {}",
                    operation, endpoint, error
                ))
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn to_reqwest_status_code(status_code: u16) -> reqwest::StatusCode {
    reqwest::StatusCode::from_u16(status_code).unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
}

fn validate_advanced_params(advanced_params: &str) -> Result<(), String> {
    let lowered = advanced_params.to_ascii_lowercase();
    for reserved in ["--ar", "--raw", "--v", "--sref"] {
        if lowered.contains(reserved) {
            return Err(format!(
                "advanced_params must not include reserved option {}",
                reserved
            ));
        }
    }

    Ok(())
}

fn build_final_prompt(
    prompt: &str,
    reference_image_urls: &[String],
    aspect_ratio: Option<&str>,
    raw_mode: bool,
    version_preset: Option<&str>,
    style_reference_urls: &[String],
    advanced_params: Option<&str>,
) -> String {
    let mut prompt_fragments: Vec<String> = reference_image_urls
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    let trimmed_prompt = prompt.trim();
    if !trimmed_prompt.is_empty() {
        prompt_fragments.push(trimmed_prompt.to_string());
    }

    let mut fragments = vec![prompt_fragments.join(" ")];

    if let Some(value) = aspect_ratio
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fragments.push(format!("--ar {value}"));
    }
    if raw_mode {
        fragments.push("--raw".to_string());
    }
    if let Some(value) = version_preset
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fragments.push(format!("--v {value}"));
    }
    if !style_reference_urls.is_empty() {
        fragments.push(format!("--sref {}", style_reference_urls.join(" ")));
    }
    if let Some(value) = advanced_params
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        fragments.push(value.to_string());
    }

    fragments.join(" ")
}

fn extract_uploaded_midjourney_image_urls(payload: &Value) -> Vec<String> {
    let urls = extract_string_array_by_pointers(
        payload,
        &[
            "/result",
            "/data",
            "/urls",
            "/result/urls",
            "/data/urls",
            "/data/result",
        ],
    );
    if !urls.is_empty() {
        return urls;
    }

    extract_string_by_pointers(payload, &["/url", "/data/url", "/result/url"])
        .into_iter()
        .collect()
}

async fn upload_midjourney_prompt_images(
    client: &Client,
    provider: MidjourneyProviderConfig,
    api_key: &str,
    sources: &[&str],
    label: &str,
) -> Result<Vec<String>, String> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }

    let mut base64_array = Vec::with_capacity(sources.len());
    for source in sources {
        let source_bytes = read_source_bytes(client, source).await?;
        base64_array.push(source_bytes_to_data_url(&source_bytes));
    }

    let request_body = json!({
        "base64Array": base64_array,
    });
    let (status, payload) = send_midjourney_json_request(
        client,
        provider.prompt_image_upload_endpoint,
        api_key,
        &request_body,
        label,
    )
    .await?;

    if !status.is_success() {
        return Err(extract_error_message(&payload)
            .unwrap_or_else(|| format!("{} failed with status {}: {}", label, status, payload)));
    }

    let urls = extract_uploaded_midjourney_image_urls(&payload);
    if urls.is_empty() {
        return Err(format!(
            "{} succeeded but no image urls were returned: {}",
            label, payload
        ));
    }

    Ok(urls)
}

async fn upload_style_reference(
    client: &Client,
    provider: MidjourneyProviderConfig,
    api_key: &str,
    source: &str,
    index: usize,
) -> Result<String, String> {
    if let Ok(urls) = upload_midjourney_prompt_images(
        client,
        provider,
        api_key,
        &[source],
        "upload Midjourney style reference",
    )
    .await
    {
        if let Some(url) = urls.into_iter().next() {
            return Ok(url);
        }
    }

    let source_bytes = read_source_bytes(client, source).await?;
    let file_name = format!("mj-style-ref-{}.{}", index + 1, source_bytes.extension);
    let mut last_error: Option<String> = None;

    for endpoint in provider.style_upload_endpoints {
        let part = multipart::Part::bytes(source_bytes.bytes.clone())
            .file_name(file_name.clone())
            .mime_str(&source_bytes.mime)
            .map_err(|error| format!("failed to set upload mime type: {error}"))?;

        let form = multipart::Form::new().part("file", part);
        let response = client
            .post(*endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await;

        let (status, payload) = match response {
            Ok(response) => parse_json_response(response).await?,
            Err(error) => {
                #[cfg(target_os = "windows")]
                {
                    match run_curl_file_upload(endpoint, api_key, &source_bytes) {
                        Ok((status_code, payload)) => {
                            (to_reqwest_status_code(status_code), payload)
                        }
                        Err(curl_error) => {
                            last_error = Some(format!(
                                "failed to upload Midjourney style reference via {}: {} | curl fallback: {}",
                                endpoint, error, curl_error
                            ));
                            continue;
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    last_error = Some(format!(
                        "failed to upload Midjourney style reference via {}: {}",
                        endpoint, error
                    ));
                    continue;
                }
            }
        };

        if !status.is_success() {
            last_error = Some(extract_error_message(&payload).unwrap_or_else(|| {
                format!(
                    "style reference upload failed via {} with status {}: {}",
                    endpoint, status, payload
                )
            }));
            continue;
        }

        if let Some(url) =
            extract_string_by_pointers(&payload, &["/url", "/data/url", "/result/url"])
        {
            return Ok(url);
        }

        last_error = Some(format!(
            "style reference upload via {} did not return url: {}",
            endpoint, payload
        ));
    }

    Err(last_error.unwrap_or_else(|| {
        format!(
            "style reference upload failed for provider {}",
            provider.provider_id
        )
    }))
}

fn normalize_midjourney_mutation_response(payload: &Value) -> MidjourneyMutationResponse {
    MidjourneyMutationResponse {
        code: extract_i64_by_pointers(payload, &["/code", "/result/code", "/data/code"]),
        task_id: extract_string_by_pointers(
            payload,
            &[
                "/taskId",
                "/result/taskId",
                "/data/taskId",
                "/task_id",
                "/result/task_id",
                "/data/task_id",
                "/result",
                "/result/id",
                "/id",
                "/data/id",
            ],
        ),
        description: extract_string_by_pointers(
            payload,
            &[
                "/description",
                "/message",
                "/msg",
                "/detail",
                "/details",
                "/result/description",
                "/result/message",
                "/data/description",
                "/data/message",
            ],
        ),
        state: extract_value_by_pointers(payload, &["/state", "/result/state", "/data/state"]),
        properties: extract_value_by_pointers(
            payload,
            &["/properties", "/result/properties", "/data/properties"],
        ),
    }
}

fn normalize_midjourney_task(
    payload: &Value,
    fallback_task_id: &str,
) -> Result<MidjourneyTaskDto, String> {
    let task_id = extract_string_by_pointers(payload, &["/id", "/result/id", "/data/id"])
        .unwrap_or_else(|| fallback_task_id.to_string());
    if task_id.trim().is_empty() {
        return Err(format!("Midjourney task response missing id: {}", payload));
    }

    Ok(MidjourneyTaskDto {
        id: task_id,
        action: extract_string_by_pointers(payload, &["/action", "/result/action", "/data/action"]),
        status: extract_string_by_pointers(payload, &["/status", "/result/status", "/data/status"])
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        progress: extract_string_by_pointers(
            payload,
            &["/progress", "/result/progress", "/data/progress"],
        )
        .unwrap_or_default(),
        image_url: extract_string_by_pointers(
            payload,
            &[
                "/imageUrl",
                "/result/imageUrl",
                "/data/imageUrl",
                "/properties/imageUrl",
                "/result/properties/imageUrl",
                "/data/properties/imageUrl",
                "/image_url",
                "/result/image_url",
                "/data/image_url",
                "/properties/image_url",
                "/result/properties/image_url",
                "/data/properties/image_url",
            ],
        ),
        image_urls: extract_string_array_or_wrapped_string_by_pointers(
            payload,
            &[
                "/imageUrls",
                "/result/imageUrls",
                "/data/imageUrls",
                "/properties/imageUrls",
                "/result/properties/imageUrls",
                "/data/properties/imageUrls",
                "/image_urls",
                "/result/image_urls",
                "/data/image_urls",
                "/properties/image_urls",
                "/result/properties/image_urls",
                "/data/properties/image_urls",
            ],
        ),
        prompt: extract_string_by_pointers(payload, &["/prompt", "/result/prompt", "/data/prompt"]),
        prompt_en: extract_string_by_pointers(
            payload,
            &[
                "/promptEn",
                "/result/promptEn",
                "/data/promptEn",
                "/prompt_en",
                "/result/prompt_en",
                "/data/prompt_en",
            ],
        ),
        final_prompt: extract_string_by_pointers(
            payload,
            &[
                "/finalPrompt",
                "/result/finalPrompt",
                "/data/finalPrompt",
                "/properties/finalPrompt",
                "/result/properties/finalPrompt",
                "/data/properties/finalPrompt",
                "/final_prompt",
                "/result/final_prompt",
                "/data/final_prompt",
            ],
        ),
        buttons: extract_midjourney_buttons(payload),
        properties: extract_value_by_pointers(
            payload,
            &["/properties", "/result/properties", "/data/properties"],
        ),
        state: extract_value_by_pointers(payload, &["/state", "/result/state", "/data/state"]),
        fail_reason: extract_string_by_pointers(
            payload,
            &[
                "/failReason",
                "/result/failReason",
                "/data/failReason",
                "/fail_reason",
                "/result/fail_reason",
                "/data/fail_reason",
                "/error/failReason",
                "/error/fail_reason",
            ],
        ),
        submit_time: extract_i64_by_pointers(
            payload,
            &[
                "/submitTime",
                "/result/submitTime",
                "/data/submitTime",
                "/submit_time",
                "/result/submit_time",
                "/data/submit_time",
            ],
        ),
        start_time: extract_i64_by_pointers(
            payload,
            &[
                "/startTime",
                "/result/startTime",
                "/data/startTime",
                "/start_time",
                "/result/start_time",
                "/data/start_time",
            ],
        ),
        finish_time: extract_i64_by_pointers(
            payload,
            &[
                "/finishTime",
                "/result/finishTime",
                "/data/finishTime",
                "/finish_time",
                "/result/finish_time",
                "/data/finish_time",
            ],
        ),
    })
}

#[tauri::command]
pub async fn submit_midjourney_imagine(
    payload: SubmitMidjourneyImaginePayload,
) -> Result<SubmitMidjourneyImagineResponse, String> {
    let provider = resolve_midjourney_provider_config(&payload.provider_id)?;
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("MJ API key is required".to_string());
    }

    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".to_string());
    }

    if let Some(advanced_params) = payload.advanced_params.as_deref() {
        validate_advanced_params(advanced_params)?;
    }

    let client = build_http_client()?;
    let reference_sources: Vec<&str> = payload
        .reference_images
        .iter()
        .map(String::as_str)
        .filter(|item| !item.trim().is_empty())
        .collect();
    let mut reference_image_urls = Vec::new();
    let mut base64_array = Vec::new();
    let mut reference_upload_error: Option<String> = None;
    if !reference_sources.is_empty() {
        match upload_midjourney_prompt_images(
            &client,
            provider,
            api_key,
            &reference_sources,
            "upload Midjourney reference images",
        )
        .await
        {
            Ok(urls) => {
                reference_image_urls = urls;
            }
            Err(error) => {
                reference_upload_error = Some(error);
                for source in &reference_sources {
                    let source_bytes = read_source_bytes(&client, source).await?;
                    base64_array.push(source_bytes_to_data_url(&source_bytes));
                }
            }
        }
    }

    let mut style_reference_urls = Vec::new();
    for (index, source) in payload
        .style_reference_images
        .iter()
        .map(String::as_str)
        .filter(|item| !item.trim().is_empty())
        .enumerate()
    {
        style_reference_urls
            .push(upload_style_reference(&client, provider, api_key, source, index).await?);
    }

    let final_prompt = build_final_prompt(
        prompt,
        &reference_image_urls,
        payload.aspect_ratio.as_deref(),
        payload.raw_mode.unwrap_or(false),
        payload.version_preset.as_deref(),
        &style_reference_urls,
        payload.advanced_params.as_deref(),
    );
    let request_body = json!({
        "prompt": final_prompt,
        "base64Array": base64_array,
    });

    let (status, response_payload) = send_midjourney_json_request(
        &client,
        provider.imagine_endpoint,
        api_key,
        &request_body,
        "submit Midjourney imagine task",
    )
    .await
    .map_err(|error| {
        if let Some(reference_upload_error) = reference_upload_error.as_ref() {
            format!("{error} | reference upload fallback failed: {reference_upload_error}")
        } else {
            error
        }
    })?;

    if !status.is_success() {
        return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Midjourney imagine request via {} failed with status {}: {}",
                provider.provider_id, status, response_payload
            )
        }));
    }

    let task_id = extract_string_by_pointers(
        &response_payload,
        &["/result", "/result/id", "/id", "/data/id"],
    )
    .ok_or_else(|| {
        format!(
            "Midjourney imagine response missing task id: {}",
            response_payload
        )
    })?;

    Ok(SubmitMidjourneyImagineResponse {
        task_id,
        prompt: prompt.to_string(),
        final_prompt,
        state: extract_string_by_pointers(
            &response_payload,
            &["/description", "/state", "/result/state", "/data/state"],
        ),
    })
}

#[tauri::command]
pub async fn submit_midjourney_action(
    payload: SubmitMidjourneyActionPayload,
) -> Result<MidjourneyMutationResponse, String> {
    let provider = resolve_midjourney_provider_config(&payload.provider_id)?;
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("MJ API key is required".to_string());
    }

    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Midjourney task id is required".to_string());
    }

    let custom_id = payload.custom_id.trim();
    if custom_id.is_empty() {
        return Err("Midjourney action custom id is required".to_string());
    }

    let client = build_http_client()?;
    let request_body = json!({
        "taskId": task_id,
        "customId": custom_id,
    });
    let (status, response_payload) = send_midjourney_json_request(
        &client,
        provider.action_endpoint,
        api_key,
        &request_body,
        "submit Midjourney action",
    )
    .await?;

    if !status.is_success() {
        return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Midjourney action request via {} failed with status {}: {}",
                provider.provider_id, status, response_payload
            )
        }));
    }

    Ok(normalize_midjourney_mutation_response(&response_payload))
}

#[tauri::command]
pub async fn submit_midjourney_modal(
    payload: SubmitMidjourneyModalPayload,
) -> Result<MidjourneyMutationResponse, String> {
    let provider = resolve_midjourney_provider_config(&payload.provider_id)?;
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("MJ API key is required".to_string());
    }

    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Midjourney task id is required".to_string());
    }

    let mut request_body = json!({
        "taskId": task_id,
    });
    if let Some(prompt) = payload
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request_body["prompt"] = Value::String(prompt.to_string());
    }
    if let Some(mask_base64) = payload
        .mask_base64
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request_body["maskBase64"] = Value::String(mask_base64.to_string());
    }

    let client = build_http_client()?;
    let (status, response_payload) = send_midjourney_json_request(
        &client,
        provider.modal_endpoint,
        api_key,
        &request_body,
        "submit Midjourney modal",
    )
    .await?;

    if !status.is_success() {
        return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Midjourney modal request via {} failed with status {}: {}",
                provider.provider_id, status, response_payload
            )
        }));
    }

    Ok(normalize_midjourney_mutation_response(&response_payload))
}

#[tauri::command]
pub async fn query_midjourney_tasks(
    payload: QueryMidjourneyTasksPayload,
) -> Result<Vec<MidjourneyTaskDto>, String> {
    let provider = resolve_midjourney_provider_config(&payload.provider_id)?;
    let api_key = payload.api_key.trim();
    if api_key.is_empty() {
        return Err("MJ API key is required".to_string());
    }

    let task_ids: Vec<String> = payload
        .task_ids
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = build_http_client()?;
    let mut tasks = Vec::with_capacity(task_ids.len());
    for task_id in task_ids {
        let endpoint = format!("{}/{}/fetch", provider.task_fetch_endpoint_prefix, task_id);
        let response = client
            .get(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|error| {
                format!(
                    "failed to query Midjourney task {} via {}: {}",
                    task_id, provider.provider_id, error
                )
            })?;
        let (status, payload) = parse_json_response(response).await?;
        if !status.is_success() {
            return Err(extract_error_message(&payload).unwrap_or_else(|| {
                format!(
                    "Midjourney task {} query via {} failed with status {}: {}",
                    task_id, provider.provider_id, status, payload
                )
            }));
        }

        let mut task = normalize_midjourney_task(&payload, &task_id)?;
        task.image_urls =
            normalize_task_image_urls(&client, provider, api_key, &task.image_urls).await;

        if let Some(image_url) = task.image_url.clone() {
            let trimmed_image_url = image_url.trim();
            if trimmed_image_url.is_empty() {
                task.image_url = None;
            } else if is_provider_proxy_image_url(provider, trimmed_image_url) {
                if let Ok(data_url) =
                    fetch_authenticated_image_data_url(&client, trimmed_image_url, api_key).await
                {
                    task.image_url = Some(data_url);
                } else if task.image_urls.is_empty() {
                    task.image_url = Some(trimmed_image_url.to_string());
                }
            } else {
                task.image_url = Some(trimmed_image_url.to_string());
            }
        } else if let Some(first_image_url) = task.image_urls.first() {
            task.image_url = Some(first_image_url.clone());
        }

        tasks.push(task);
    }

    Ok(tasks)
}
