use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tracing::info;

const ARK_TASKS_ENDPOINT: &str =
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

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
    let response = client
        .post(ARK_TASKS_ENDPOINT)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|error| format!("Failed to call Seedance create task API: {}", error))?;

    let (status, response_payload) = parse_response_json(response).await?;
    if !status.is_success() {
        return Err(extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Seedance create task API returned {}: {}",
                status, response_payload
            )
        }));
    }

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
