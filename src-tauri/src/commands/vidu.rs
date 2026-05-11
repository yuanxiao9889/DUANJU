use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const VIDU_API_BASES: [&str; 2] = [
    "https://api.vidu.cn/ent/v2",
    "https://api.vidu.com/ent/v2",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateViduVideoTaskPayload {
    pub api_key: String,
    pub input_mode: String,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub videos: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bgm: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateViduVideoTaskResponse {
    pub task_id: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateViduVoiceClonePayload {
    pub api_key: String,
    pub audio_url: String,
    pub voice_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateViduVoiceCloneResponse {
    pub task_id: String,
    pub state: String,
    pub voice_id: Option<String>,
    pub demo_audio: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetViduVideoTaskPayload {
    pub api_key: String,
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViduVideoCreation {
    pub id: Option<String>,
    pub url: Option<String>,
    pub cover_url: Option<String>,
    pub watermarked_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetViduVideoTaskResponse {
    pub id: String,
    pub state: String,
    pub err_code: Option<String>,
    pub model: Option<String>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    pub duration: Option<i32>,
    pub audio: Option<bool>,
    pub bgm: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub progress: Option<i32>,
    pub creations: Vec<ViduVideoCreation>,
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn normalize_api_key(raw_api_key: &str) -> String {
    let mut normalized = raw_api_key
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();

    loop {
        let lower = normalized.to_ascii_lowercase();
        let stripped = if lower.starts_with("authorization:") {
            normalized
                .split_once(':')
                .map(|(_, value)| value.trim().to_string())
        } else if lower.starts_with("token ") {
            Some(normalized[6..].trim().to_string())
        } else if lower.starts_with("token:") {
            normalized
                .split_once(':')
                .map(|(_, value)| value.trim().to_string())
        } else if lower.starts_with("bearer ") {
            Some(normalized[7..].trim().to_string())
        } else if lower.starts_with("bearer:") {
            normalized
                .split_once(':')
                .map(|(_, value)| value.trim().to_string())
        } else {
            None
        };

        match stripped {
            Some(next) if next != normalized => {
                normalized = next
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim()
                    .to_string();
            }
            _ => break,
        }
    }

    normalized
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

fn extract_i32(payload: &Value, pointers: &[&str]) -> Option<i32> {
    pointers.iter().find_map(|pointer| {
        payload.pointer(pointer).and_then(|value| {
            value
                .as_i64()
                .and_then(|number| i32::try_from(number).ok())
                .or_else(|| value.as_str()?.trim().parse::<i32>().ok())
        })
    })
}

fn extract_bool(payload: &Value, pointers: &[&str]) -> Option<bool> {
    pointers.iter().find_map(|pointer| {
        payload.pointer(pointer).and_then(|value| {
            value.as_bool().or_else(|| {
                let normalized = value.as_str()?.trim().to_ascii_lowercase();
                match normalized.as_str() {
                    "true" | "1" | "yes" => Some(true),
                    "false" | "0" | "no" => Some(false),
                    _ => None,
                }
            })
        })
    })
}

fn extract_error_message(payload: &Value) -> Option<String> {
    extract_string(
        payload,
        &[
            "/error/message",
            "/err_msg",
            "/error_msg",
            "/message",
            "/msg",
            "/detail",
            "/err_code",
        ],
    )
}

fn extract_task_id(payload: &Value) -> Option<String> {
    extract_string(payload, &["/task_id", "/id", "/data/task_id", "/data/id"])
}

async fn parse_json_response(response: reqwest::Response, label: &str) -> Result<Value, String> {
    let status = response.status();
    let status_code = status.as_u16();
    let response_text = response.text().await.map_err(|error| {
        format!("Failed to read Vidu {} response: {}", label, error)
    })?;

    if !status.is_success() && response_text.trim().is_empty() {
        return Err(format!(
            "Vidu {} API returned HTTP {} with an empty response body",
            label, status_code
        ));
    }

    let payload = serde_json::from_str::<Value>(&response_text).map_err(|error| {
        format!(
            "Failed to parse Vidu {} response JSON from HTTP {}: {}. Response was: {}",
            label, status_code, error, response_text
        )
    })?;

    if !status.is_success() {
        return Err(extract_error_message(&payload).unwrap_or_else(|| {
            format!("Vidu {} API returned HTTP {}: {}", label, status_code, payload)
        }));
    }

    Ok(payload)
}

fn is_retryable_auth_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("unauthorized")
        || normalized.contains("invalid token")
        || normalized.contains("forbidden")
        || normalized.contains("401")
        || normalized.contains("403")
}

fn endpoint_for_input_mode(input_mode: &str) -> Result<&'static str, String> {
    match input_mode {
        "textToVideo" => Ok("text2video"),
        "firstFrame" => Ok("img2video"),
        "firstLastFrame" => Ok("start-end2video"),
        "reference" => Ok("reference2video"),
        _ => Err(format!("Unsupported Vidu input mode: {}", input_mode)),
    }
}

fn build_create_body(payload: CreateViduVideoTaskPayload) -> Result<Value, String> {
    let model = payload.model.trim();
    if model.is_empty() {
        return Err("Vidu model is required".to_string());
    }

    let prompt = payload.prompt.trim();
    if prompt.is_empty() {
        return Err("Vidu prompt is required".to_string());
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

    let videos = payload
        .videos
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .map(Value::String)
        .collect::<Vec<_>>();
    if !videos.is_empty() {
        body.insert("videos".to_string(), Value::Array(videos));
    }

    if let Some(value) = normalize_optional_string(payload.aspect_ratio) {
        body.insert("aspect_ratio".to_string(), Value::String(value));
    }
    if let Some(value) = payload.duration {
        body.insert("duration".to_string(), Value::Number(value.into()));
    }
    if let Some(value) = normalize_optional_string(payload.resolution) {
        body.insert("resolution".to_string(), Value::String(value));
    }
    if let Some(value) = payload.audio {
        body.insert("audio".to_string(), Value::Bool(value));
    }
    if let Some(value) = payload.bgm {
        body.insert("bgm".to_string(), Value::Bool(value));
    }
    if let Some(value) = normalize_optional_string(payload.voice_id) {
        body.insert("voice_id".to_string(), Value::String(value));
    }

    Ok(Value::Object(body))
}

fn build_voice_clone_body(payload: &CreateViduVoiceClonePayload) -> Result<Value, String> {
    let audio_url = payload.audio_url.trim();
    if audio_url.is_empty() {
        return Err("Vidu voice clone audio_url is required".to_string());
    }

    let voice_id = payload.voice_id.trim();
    if voice_id.is_empty() {
        return Err("Vidu voice clone voice_id is required".to_string());
    }

    let text = payload.text.trim();
    if text.is_empty() {
        return Err("Vidu voice clone text is required".to_string());
    }

    let mut body = Map::new();
    body.insert("audio_url".to_string(), Value::String(audio_url.to_string()));
    body.insert("voice_id".to_string(), Value::String(voice_id.to_string()));
    body.insert("text".to_string(), Value::String(text.to_string()));
    Ok(Value::Object(body))
}

fn parse_creations(payload: &Value) -> Vec<ViduVideoCreation> {
    payload
        .pointer("/creations")
        .or_else(|| payload.pointer("/data/creations"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| ViduVideoCreation {
                    id: extract_string(item, &["/id", "/creation_id"]),
                    url: extract_string(item, &["/url", "/video_url"]),
                    cover_url: extract_string(item, &["/cover_url", "/cover", "/thumbnail_url"]),
                    watermarked_url: extract_string(item, &["/watermarked_url"]),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn create_vidu_video_task(
    payload: CreateViduVideoTaskPayload,
) -> Result<CreateViduVideoTaskResponse, String> {
    let api_key = normalize_api_key(&payload.api_key);
    if api_key.is_empty() {
        return Err("Vidu API key is required".to_string());
    }

    let endpoint_path = endpoint_for_input_mode(payload.input_mode.trim())?;
    let body = build_create_body(payload)?;

    let client = Client::new();
    let mut last_error: Option<String> = None;
    let mut response_payload: Option<Value> = None;

    for api_base in VIDU_API_BASES {
        let response = client
            .post(format!("{}/{}", api_base, endpoint_path))
            .header("Accept", "application/json")
            .header("Authorization", format!("Token {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Failed to call Vidu create task API: {}", error))?;

        match parse_json_response(response, "create video task").await {
            Ok(payload) => {
                response_payload = Some(payload);
                break;
            }
            Err(error) if is_retryable_auth_error(&error) && api_base != VIDU_API_BASES[1] => {
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    let response_payload = response_payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| "Vidu create task API did not return a response".to_string())
    })?;
    let task_id = extract_task_id(&response_payload).ok_or_else(|| {
        extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Vidu create task response did not include task_id: {}",
                response_payload
            )
        })
    })?;

    Ok(CreateViduVideoTaskResponse {
        task_id,
        state: extract_string(&response_payload, &["/state", "/data/state"]),
    })
}

#[tauri::command]
pub async fn create_vidu_voice_clone(
    payload: CreateViduVoiceClonePayload,
) -> Result<CreateViduVoiceCloneResponse, String> {
    let api_key = normalize_api_key(&payload.api_key);
    if api_key.is_empty() {
        return Err("Vidu API key is required".to_string());
    }

    let body = build_voice_clone_body(&payload)?;
    let client = Client::new();
    let mut last_error: Option<String> = None;
    let mut response_payload: Option<Value> = None;

    for api_base in VIDU_API_BASES {
        let response = client
            .post(format!("{}/audio-clone", api_base))
            .header("Accept", "application/json")
            .header("Authorization", format!("Token {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Failed to call Vidu voice clone API: {}", error))?;

        match parse_json_response(response, "voice clone").await {
            Ok(payload) => {
                response_payload = Some(payload);
                break;
            }
            Err(error) if is_retryable_auth_error(&error) && api_base != VIDU_API_BASES[1] => {
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    let response_payload = response_payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| "Vidu voice clone API did not return a response".to_string())
    })?;
    let task_id = extract_task_id(&response_payload).ok_or_else(|| {
        extract_error_message(&response_payload).unwrap_or_else(|| {
            format!(
                "Vidu voice clone response did not include task_id: {}",
                response_payload
            )
        })
    })?;

    Ok(CreateViduVoiceCloneResponse {
        task_id,
        state: extract_string(&response_payload, &["/state", "/data/state"])
            .unwrap_or_else(|| "created".to_string()),
        voice_id: extract_string(&response_payload, &["/voice_id", "/data/voice_id"])
            .or_else(|| extract_string(&body, &["/voice_id"])),
        demo_audio: extract_string(&response_payload, &["/demo_audio", "/data/demo_audio"]),
        created_at: extract_string(&response_payload, &["/created_at", "/data/created_at"]),
    })
}

#[tauri::command]
pub async fn get_vidu_video_task(
    payload: GetViduVideoTaskPayload,
) -> Result<GetViduVideoTaskResponse, String> {
    let api_key = normalize_api_key(&payload.api_key);
    if api_key.is_empty() {
        return Err("Vidu API key is required".to_string());
    }

    let task_id = payload.task_id.trim();
    if task_id.is_empty() {
        return Err("Vidu task_id is required".to_string());
    }

    let client = Client::new();
    let mut last_error: Option<String> = None;
    let mut response_payload: Option<Value> = None;

    for api_base in VIDU_API_BASES {
        let response = client
            .get(format!("{}/tasks/{}/creations", api_base, task_id))
            .header("Accept", "application/json")
            .header("Authorization", format!("Token {}", api_key))
            .send()
            .await
            .map_err(|error| format!("Failed to call Vidu query task API: {}", error))?;

        match parse_json_response(response, "query video task").await {
            Ok(payload) => {
                response_payload = Some(payload);
                break;
            }
            Err(error) if is_retryable_auth_error(&error) && api_base != VIDU_API_BASES[1] => {
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }

    let response_payload = response_payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| "Vidu query task API did not return a response".to_string())
    })?;
    Ok(GetViduVideoTaskResponse {
        id: extract_task_id(&response_payload).unwrap_or_else(|| task_id.to_string()),
        state: extract_string(&response_payload, &["/state", "/data/state"])
            .unwrap_or_else(|| "unknown".to_string()),
        err_code: extract_string(&response_payload, &["/err_code", "/data/err_code"]),
        model: extract_string(&response_payload, &["/model", "/data/model"]),
        aspect_ratio: extract_string(&response_payload, &["/aspect_ratio", "/data/aspect_ratio"]),
        resolution: extract_string(&response_payload, &["/resolution", "/data/resolution"]),
        duration: extract_i32(&response_payload, &["/duration", "/data/duration"]),
        audio: extract_bool(&response_payload, &["/audio", "/data/audio"]),
        bgm: extract_bool(&response_payload, &["/bgm", "/data/bgm"]),
        created_at: extract_string(&response_payload, &["/created_at", "/data/created_at"]),
        updated_at: extract_string(&response_payload, &["/updated_at", "/data/updated_at"]),
        progress: extract_i32(&response_payload, &["/progress", "/data/progress"]),
        creations: parse_creations(&response_payload),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pasted_authorization_header() {
        assert_eq!(
            normalize_api_key("Authorization: Token vidu_test_key"),
            "vidu_test_key"
        );
        assert_eq!(normalize_api_key("Token vidu_test_key"), "vidu_test_key");
        assert_eq!(normalize_api_key("Bearer vidu_test_key"), "vidu_test_key");
    }

    #[test]
    fn treats_empty_http_auth_failures_as_retryable() {
        assert!(is_retryable_auth_error(
            "Vidu create video task API returned HTTP 403 with an empty response body"
        ));
        assert!(is_retryable_auth_error("unauthorized"));
        assert!(!is_retryable_auth_error("invalid request body"));
    }
}
