use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://ai.comfly.chat";
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";
const TASKS_ENDPOINT_PATH: &str = "/v1/images/tasks";
const POLL_INTERVAL_MS: u64 = 2000;
const MAX_POLL_RETRIES: u32 = 150;

const SUPPORTED_MODELS: [&str; 6] = [
    "nano-banana",
    "nano-banana-hd",
    "nano-banana-2",
    "nano-banana-2-2k",
    "nano-banana-2-4k",
    "gemini-3.1-flash-image-preview-4k",
];
const LEGACY_HD_MODEL: &str = "nano-banana-hd";
const TWO_K_MODEL: &str = "nano-banana-2-2k";
const FOUR_K_MODEL: &str = "nano-banana-2-4k";
const GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL: &str = "gemini-3.1-flash-image-preview-4k";

const SUPPORTED_ASPECT_RATIOS: [&str; 14] = [
    "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1",
    "9:16", "16:9", "21:9",
];

#[derive(Debug, Deserialize)]
struct TaskSubmissionResponse {
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct TaskStatusResponse {
    data: TaskStatusData,
}

#[derive(Debug, Deserialize)]
struct TaskStatusData {
    status: String,
    #[serde(default)]
    progress: Option<String>,
    #[serde(default)]
    data: Option<TaskResultData>,
    #[serde(default)]
    fail_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TaskResultData {
    data: Option<Vec<ImageData>>,
}

#[derive(Debug, Deserialize)]
struct ImageData {
    url: Option<String>,
    b64_json: Option<String>,
}

#[derive(Debug, Serialize)]
struct GenerationsRequestBody {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
}

pub struct ComflyProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl ComflyProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn resolve_effective_model(model: &str, requested_size: &str) -> String {
        let sanitized_model = Self::sanitize_model(model);
        let normalized_size = requested_size.trim().to_ascii_uppercase();

        if sanitized_model == GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL {
            return sanitized_model;
        }
        if normalized_size == "4K" {
            return FOUR_K_MODEL.to_string();
        }
        if normalized_size == "2K" {
            return TWO_K_MODEL.to_string();
        }
        if sanitized_model == LEGACY_HD_MODEL {
            return FOUR_K_MODEL.to_string();
        }

        sanitized_model
    }

    fn decode_file_url_path(value: &str) -> String {
        let raw = value.trim_start_matches("file://");
        let decoded = urlencoding::decode(raw)
            .map(|result| result.into_owned())
            .unwrap_or_else(|_| raw.to_string());
        let normalized = if decoded.starts_with('/')
            && decoded.len() > 2
            && decoded.as_bytes().get(2) == Some(&b':')
        {
            &decoded[1..]
        } else {
            &decoded
        };
        normalized.to_string()
    }

    async fn source_to_bytes(source: &str) -> Result<Vec<u8>, String> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err("source is empty".to_string());
        }

        if let Some((meta, payload)) = trimmed.split_once(',') {
            if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
                return STANDARD
                    .decode(payload)
                    .map_err(|err| format!("invalid base64 payload: {}", err));
            }
        }

        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            return STANDARD
                .decode(trimmed)
                .map_err(|err| format!("invalid base64 payload: {}", err));
        }

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            let response = reqwest::get(trimmed)
                .await
                .map_err(|err| format!("failed to download image: {}", err))?;
            let bytes = response.bytes()
                .await
                .map_err(|err| format!("failed to read image bytes: {}", err))?;
            return Ok(bytes.to_vec());
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };
        std::fs::read(&path).map_err(|err| {
            format!(
                "failed to read path \"{}\": {}",
                path.to_string_lossy(),
                err
            )
        })
    }

    fn validate_aspect_ratio(aspect_ratio: &str) -> bool {
        SUPPORTED_ASPECT_RATIOS.contains(&aspect_ratio)
    }

    fn resolve_image_size(model: &str, size: &str) -> Option<String> {
        let normalized_model = model.trim().to_ascii_lowercase();
        if normalized_model == TWO_K_MODEL
            || normalized_model == FOUR_K_MODEL
        {
            return None;
        }

        let normalized_size = size.trim().to_ascii_uppercase();
        match normalized_size.as_str() {
            "1K" | "2K" | "4K" => Some(normalized_size),
            _ => None,
        }
    }

    async fn submit_text2img(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<String, AIError> {
        let endpoint = format!("{}{}?async=true", self.base_url, GENERATIONS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let body = GenerationsRequestBody {
            model: model.clone(),
            prompt: request.prompt.clone(),
            response_format: Some("url".to_string()),
            image_size: Self::resolve_image_size(&model, &request.size),
            aspect_ratio: if !request.aspect_ratio.is_empty() && Self::validate_aspect_ratio(&request.aspect_ratio) {
                Some(request.aspect_ratio.clone())
            } else {
                None
            },
        };

        info!(
            "[Comfly API] Text2Img URL: {}, model: {}, size: {}, aspect_ratio: {}",
            endpoint,
            model,
            request.size,
            request.aspect_ratio
        );

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await.map_err(AIError::from)?;
        info!("[Comfly API] Response status: {}", status);
        info!("[Comfly API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Comfly request failed {}: {}",
                status, response_text
            )));
        }

        let task_response: TaskSubmissionResponse = serde_json::from_str(&response_text).map_err(|e| {
            AIError::Provider(format!(
                "Failed to parse Comfly response: {}. Response was: {}",
                e, response_text
            ))
        })?;

        Ok(task_response.task_id)
    }

    async fn submit_img2img(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<String, AIError> {
        let endpoint = format!("{}{}?async=true", self.base_url, EDITS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let reference_images = request.reference_images.as_ref().ok_or_else(|| {
            AIError::InvalidRequest("Reference images required for img2img".to_string())
        })?;

        info!(
            "[Comfly API] Img2Img URL: {}, model: {}, size: {}, aspect_ratio: {}, images: {}",
            endpoint,
            model,
            request.size,
            request.aspect_ratio,
            reference_images.len()
        );

        let mut form = reqwest::multipart::Form::new();
        form = form.text("prompt", request.prompt.clone());
        form = form.text("model", model.clone());
        form = form.text("response_format", "url".to_string());

        if let Some(image_size) = Self::resolve_image_size(&model, &request.size) {
            form = form.text("image_size", image_size);
        }

        if !request.aspect_ratio.is_empty() && Self::validate_aspect_ratio(&request.aspect_ratio) {
            form = form.text("aspect_ratio", request.aspect_ratio.clone());
        }

        for (idx, source) in reference_images.iter().enumerate() {
            let bytes = Self::source_to_bytes(source)
                .await
                .map_err(|e| AIError::InvalidRequest(format!("Failed to read image {}: {}", idx, e)))?;
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("image_{}.png", idx))
                .mime_str("image/png")
                .map_err(|e| AIError::Provider(format!("Failed to create multipart part: {}", e)))?;
            form = form.part("image", part);
        }

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await.map_err(AIError::from)?;
        info!("[Comfly API] Response status: {}", status);
        info!("[Comfly API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Comfly request failed {}: {}",
                status, response_text
            )));
        }

        let task_response: TaskSubmissionResponse = serde_json::from_str(&response_text).map_err(|e| {
            AIError::Provider(format!(
                "Failed to parse Comfly response: {}. Response was: {}",
                e, response_text
            ))
        })?;

        Ok(task_response.task_id)
    }

    async fn poll_task(&self, task_id: &str) -> Result<Option<String>, AIError> {
        let endpoint = format!("{}{}/{}", self.base_url, TASKS_ENDPOINT_PATH, task_id);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "Comfly task status request failed {}: {}",
                status, error_text
            )));
        }

        let status_response: TaskStatusResponse = response.json().await.map_err(|e| {
            AIError::Provider(format!("Failed to parse task status response: {}", e))
        })?;

        match status_response.data.status.as_str() {
            "SUCCESS" => {
                let result_data = status_response.data.data.ok_or_else(|| {
                    AIError::Provider("Task succeeded but no result data".to_string())
                })?;
                let images = result_data.data.ok_or_else(|| {
                    AIError::Provider("Task succeeded but no image data".to_string())
                })?;
                let first_image = images.first().ok_or_else(|| {
                    AIError::Provider("Task succeeded but empty image array".to_string())
                })?;
                
                if let Some(url) = &first_image.url {
                    return Ok(Some(url.clone()));
                }
                if let Some(b64_json) = &first_image.b64_json {
                    return Ok(Some(format!("data:image/png;base64,{}", b64_json)));
                }
                Err(AIError::Provider("Task succeeded but no URL or base64 data".to_string()))
            }
            "FAILURE" => {
                let reason = status_response.data.fail_reason.unwrap_or_else(|| "Unknown error".to_string());
                Err(AIError::Provider(format!("Task failed: {}", reason)))
            }
            _ => Ok(None),
        }
    }

    async fn wait_for_task(&self, task_id: &str) -> Result<String, AIError> {
        let mut retries = 0;
        loop {
            if retries >= MAX_POLL_RETRIES {
                return Err(AIError::Provider(format!(
                    "Task timed out after {} retries",
                    MAX_POLL_RETRIES
                )));
            }

            match self.poll_task(task_id).await? {
                Some(url) => return Ok(url),
                None => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                    retries += 1;
                }
            }
        }
    }
}

impl Default for ComflyProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for ComflyProvider {
    fn name(&self) -> &str {
        "comfly"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("comfly/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "comfly/nano-banana".to_string(),
            "comfly/nano-banana-hd".to_string(),
            "comfly/nano-banana-2".to_string(),
            "comfly/nano-banana-2-2k".to_string(),
            "comfly/nano-banana-2-4k".to_string(),
            "comfly/gemini-3.1-flash-image-preview-4k".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = Self::resolve_effective_model(&request.model, &request.size);
        let has_reference_images = request.reference_images.as_ref()
            .map(|imgs| !imgs.is_empty())
            .unwrap_or(false);

        info!(
            "[Comfly Request] model: {}, size: {}, aspect_ratio: {}, has_images: {}",
            model,
            request.size,
            request.aspect_ratio,
            has_reference_images
        );

        let task_id = if has_reference_images {
            self.submit_img2img(&request, model).await?
        } else {
            self.submit_text2img(&request, model).await?
        };

        info!("[Comfly API] Task ID: {}", task_id);
        self.wait_for_task(&task_id).await
    }
}
