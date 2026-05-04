use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGptBestVideoTaskPayload {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
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
    pub video_url: Option<String>,
    pub last_frame_url: Option<String>,
    pub ratio: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<i32>,
    pub error_message: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
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

fn generations_endpoint(base_url: &str) -> String {
    let normalized = base_url.trim_end_matches('/');
    if normalized.ends_with("/v2/videos/generations") {
        normalized.to_string()
    } else {
        format!("{}/v2/videos/generations", normalized)
    }
}

fn query_endpoint(base_url: &str, task_id: &str) -> String {
    format!("{}/{}", generations_endpoint(base_url), task_id)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
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
    if let Some(value) = extract_string(
        payload,
        &[
            "/data/output",
            "/data/video_url",
            "/data/url",
            "/output",
            "/video_url",
            "/url",
        ],
    ) {
        return Some(value);
    }

    let output = payload
        .pointer("/data/output")
        .or_else(|| payload.pointer("/output"));
    if let Some(array) = output.and_then(Value::as_array) {
        return array.iter().find_map(|item| {
            if let Some(url) = item
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(url.to_string());
            }
            extract_string(item, &["/url", "/video_url"])
        });
    }

    None
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

    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(model.to_string()));
    body.insert("prompt".to_string(), Value::String(prompt.to_string()));

    let images = payload
        .images
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .map(Value::String)
        .collect::<Vec<_>>();
    if !images.is_empty() {
        body.insert("images".to_string(), Value::Array(images));
    }

    if let Some(value) = normalize_optional_string(payload.ratio) {
        body.insert("ratio".to_string(), Value::String(value));
    }
    if let Some(value) = payload.duration {
        body.insert("duration".to_string(), Value::Number(value.into()));
    }
    if let Some(value) = normalize_optional_string(payload.resolution) {
        body.insert("resolution".to_string(), Value::String(value));
    }

    let client = Client::new();
    let response = client
        .post(generations_endpoint(&base_url))
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Failed to call third-party video create task API: {}",
                error
            )
        })?;

    let response_payload = parse_json_response(response, "create video task").await?;
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

    let client = Client::new();
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
        status: extract_string(&response_payload, &["/data/status", "/status"])
            .unwrap_or_else(|| "UNKNOWN".to_string()),
        model: extract_string(&response_payload, &["/data/model", "/model"]),
        video_url: extract_output_url(&response_payload),
        last_frame_url: extract_string(
            &response_payload,
            &["/data/last_frame_url", "/last_frame_url", "/data/cover_url"],
        ),
        ratio: extract_string(&response_payload, &["/data/ratio", "/ratio"]),
        resolution: extract_string(&response_payload, &["/data/resolution", "/resolution"]),
        duration: extract_i32(&response_payload, &["/data/duration", "/duration"]),
        error_message: extract_error_message(&response_payload),
        created_at: extract_i64(&response_payload, &["/data/created_at", "/created_at"]),
        updated_at: extract_i64(&response_payload, &["/data/updated_at", "/updated_at"]),
    })
}
