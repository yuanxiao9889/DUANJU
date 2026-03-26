use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::Part;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://ai.t8star.cn";
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";
const TASKS_ENDPOINT_PATH: &str = "/v1/images/tasks";
const POLL_INTERVAL_MS: u64 = 2000;
const MAX_POLL_RETRIES: u32 = 150;

const SUPPORTED_MODELS: [&str; 4] = [
    "nano-banana",
    "nano-banana-hd",
    "nano-banana-2-4k",
    "gemini-3.1-flash-image-preview-4k",
];
const LEGACY_HD_MODEL: &str = "nano-banana-hd";
const FOUR_K_MODEL: &str = "nano-banana-2-4k";
const GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL: &str = "gemini-3.1-flash-image-preview-4k";
const HD_RESOLUTION: &str = "4K";

const SUPPORTED_ASPECT_RATIOS: [&str; 14] = [
    "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9",
    "21:9",
];

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
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct GeminiPreviewRequestBody {
    model: String,
    prompt: String,
    size: String,
    resolution: String,
    n: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_urls: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct GenerationsResponse {
    data: Option<Vec<ImageData>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct ImageData {
    url: Option<String>,
    b64_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: String,
}

pub struct ZhenzhenProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl ZhenzhenProvider {
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
        if sanitized_model == GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL {
            return sanitized_model;
        }
        if requested_size.trim().eq_ignore_ascii_case(HD_RESOLUTION) {
            return FOUR_K_MODEL.to_string();
        }
        if sanitized_model == LEGACY_HD_MODEL {
            return FOUR_K_MODEL.to_string();
        }
        sanitized_model
    }

    fn is_gemini_preview_model(model: &str) -> bool {
        Self::sanitize_model(model) == GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL
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
            let bytes = response
                .bytes()
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

    fn file_extension_from_source(source: &str) -> &'static str {
        let trimmed = source.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("data:image/jpeg") || lower.starts_with("data:image/jpg") {
            return "jpg";
        }
        if lower.starts_with("data:image/webp") {
            return "webp";
        }
        if lower.starts_with("data:image/gif") {
            return "gif";
        }
        if lower.starts_with("data:image/bmp") {
            return "bmp";
        }
        if lower.starts_with("data:image/avif") {
            return "avif";
        }
        if lower.starts_with("data:image/png") {
            return "png";
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };

        path.extension()
            .and_then(|raw| raw.to_str())
            .map(|raw| raw.trim().to_ascii_lowercase())
            .filter(|raw| !raw.is_empty())
            .and_then(|raw| match raw.as_str() {
                "jpg" | "jpeg" => Some("jpg"),
                "png" => Some("png"),
                "webp" => Some("webp"),
                "gif" => Some("gif"),
                "bmp" => Some("bmp"),
                "avif" => Some("avif"),
                _ => None,
            })
            .unwrap_or("png")
    }

    fn mime_type_from_extension(extension: &str) -> &'static str {
        match extension {
            "jpg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "avif" => "image/avif",
            _ => "image/png",
        }
    }

    fn validate_aspect_ratio(aspect_ratio: &str) -> bool {
        SUPPORTED_ASPECT_RATIOS.contains(&aspect_ratio)
    }

    fn resolve_image_size(model: &str, size: &str) -> Option<String> {
        let normalized_model = model.trim().to_ascii_lowercase();
        if normalized_model.ends_with("-4k") || normalized_model.ends_with("-2k") {
            return None;
        }

        let normalized = size.trim().to_ascii_uppercase();
        match normalized.as_str() {
            "1K" | "2K" | "4K" => Some(normalized),
            _ => None,
        }
    }

    fn resolve_gemini_resolution(size: &str) -> String {
        match size.trim().to_ascii_uppercase().as_str() {
            "2K" => "2K".to_string(),
            "4K" => "4K".to_string(),
            _ => "1K".to_string(),
        }
    }

    fn resolve_gemini_canvas_size(aspect_ratio: &str) -> String {
        if Self::validate_aspect_ratio(aspect_ratio) {
            return aspect_ratio.to_string();
        }
        "1:1".to_string()
    }

    async fn normalize_gemini_reference_images(
        reference_images: &[String],
    ) -> Result<Vec<String>, AIError> {
        let mut normalized = Vec::with_capacity(reference_images.len());
        for (index, source) in reference_images.iter().enumerate() {
            let trimmed = source.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                normalized.push(trimmed.to_string());
                continue;
            }

            let bytes = Self::source_to_bytes(trimmed).await.map_err(|error| {
                AIError::InvalidRequest(format!(
                    "Failed to read reference image {}: {}",
                    index + 1,
                    error
                ))
            })?;
            let extension = Self::file_extension_from_source(trimmed);
            let mime_type = Self::mime_type_from_extension(extension);
            normalized.push(format!(
                "data:{};base64,{}",
                mime_type,
                STANDARD.encode(bytes)
            ));
        }
        Ok(normalized)
    }

    fn extract_error_message(payload: &Value) -> Option<String> {
        [
            "/error/message",
            "/message",
            "/msg",
            "/data/fail_reason",
            "/fail_reason",
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

    fn extract_task_id(payload: &Value) -> Option<String> {
        ["/task_id", "/data/task_id", "/id"]
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

    fn extract_first_image(payload: &Value) -> Option<String> {
        let url_pointers = [
            "/data/0/url",
            "/data/data/0/url",
            "/data/data/data/0/url",
            "/data/output/data/0/url",
            "/data/result/data/0/url",
            "/data/image_urls/0",
            "/data/output/image_urls/0",
            "/result/image_urls/0",
            "/image_urls/0",
        ];

        if let Some(url) = url_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }) {
            return Some(url);
        }

        let b64_pointers = [
            "/data/0/b64_json",
            "/data/data/0/b64_json",
            "/data/data/data/0/b64_json",
            "/data/output/data/0/b64_json",
            "/data/result/data/0/b64_json",
        ];

        b64_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("data:image/png;base64,{}", value))
        })
    }

    fn extract_task_status(payload: &Value) -> Option<String> {
        ["/data/status", "/status"].iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_ascii_uppercase())
        })
    }

    async fn submit_gemini_preview_task(
        &self,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<Value, AIError> {
        let endpoint = format!("{}{}?async=true", self.base_url, GENERATIONS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let reference_images = request.reference_images.as_deref().unwrap_or(&[]);
        let normalized_reference_images =
            Self::normalize_gemini_reference_images(reference_images).await?;

        let body = GeminiPreviewRequestBody {
            model: model.to_string(),
            prompt: request.prompt.clone(),
            size: Self::resolve_gemini_canvas_size(&request.aspect_ratio),
            resolution: Self::resolve_gemini_resolution(&request.size),
            n: 1,
            image_urls: if normalized_reference_images.is_empty() {
                None
            } else {
                Some(normalized_reference_images)
            },
        };

        info!(
            "[Zhenzhen API] Gemini Preview URL: {}, model: {}, size: {}, aspect_ratio: {}, refs: {}",
            endpoint,
            model,
            request.size,
            request.aspect_ratio,
            reference_images.len()
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
        info!("[Zhenzhen API] Gemini Preview response status: {}", status);
        info!("[Zhenzhen API] Gemini Preview response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Zhenzhen Gemini Preview request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str::<Value>(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen Gemini Preview response: {}. Response was: {}",
                error, response_text
            ))
        })
    }

    async fn poll_gemini_preview_task(&self, task_id: &str) -> Result<Option<String>, AIError> {
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
        let response_text = response.text().await.map_err(AIError::from)?;
        info!("[Zhenzhen API] Task status response status: {}", status);
        info!("[Zhenzhen API] Task status response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Zhenzhen task status request failed {}: {}",
                status, response_text
            )));
        }

        let payload = serde_json::from_str::<Value>(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen task status response: {}. Response was: {}",
                error, response_text
            ))
        })?;

        if let Some(image) = Self::extract_first_image(&payload) {
            return Ok(Some(image));
        }

        if let Some(task_status) = Self::extract_task_status(&payload) {
            match task_status.as_str() {
                "SUCCESS" | "SUCCEEDED" | "COMPLETED" | "DONE" => {
                    return Err(AIError::Provider(
                        "Zhenzhen task completed but response did not include image data"
                            .to_string(),
                    ));
                }
                "FAILURE" | "FAILED" | "ERROR" | "CANCELLED" => {
                    let message = Self::extract_error_message(&payload).unwrap_or_else(|| {
                        format!("Zhenzhen task failed with status {}", task_status)
                    });
                    return Err(AIError::TaskFailed(message));
                }
                "QUEUED" | "SUBMITTED" | "PENDING" | "RUNNING" | "PROCESSING" | "IN_PROGRESS" => {
                    return Ok(None);
                }
                _ => {}
            }
        }

        if let Some(message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(message));
        }

        Ok(None)
    }

    async fn generate_with_gemini_preview(
        &self,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<String, AIError> {
        let payload = self.submit_gemini_preview_task(request, model).await?;

        if let Some(error) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error));
        }

        if let Some(image) = Self::extract_first_image(&payload) {
            return Ok(image);
        }

        let task_id = Self::extract_task_id(&payload).ok_or_else(|| {
            AIError::Provider(
                "Zhenzhen Gemini Preview response missing both image data and task_id".to_string(),
            )
        })?;

        for _ in 0..MAX_POLL_RETRIES {
            match self.poll_gemini_preview_task(&task_id).await? {
                Some(image) => return Ok(image),
                None => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
            }
        }

        Err(AIError::Provider(format!(
            "Zhenzhen Gemini Preview task timed out after {} retries",
            MAX_POLL_RETRIES
        )))
    }

    async fn request_text_to_image(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<GenerationsResponse, AIError> {
        let endpoint = format!("{}{}", self.base_url, GENERATIONS_ENDPOINT_PATH);
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
            aspect_ratio: if !request.aspect_ratio.is_empty()
                && Self::validate_aspect_ratio(&request.aspect_ratio)
            {
                Some(request.aspect_ratio.clone())
            } else {
                None
            },
            image: None,
        };

        info!(
            "[Zhenzhen API] Text2Img URL: {}, model: {}, size: {}, aspect_ratio: {}",
            endpoint, model, request.size, request.aspect_ratio
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
        info!("[Zhenzhen API] Response status: {}", status);
        info!("[Zhenzhen API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Zhenzhen request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen response: {}. Response was: {}",
                error, response_text
            ))
        })
    }

    async fn request_image_to_image(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<GenerationsResponse, AIError> {
        let endpoint = format!("{}{}", self.base_url, EDITS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let reference_images = request.reference_images.as_ref().ok_or_else(|| {
            AIError::InvalidRequest("Reference images required for img2img".to_string())
        })?;

        let mut form = reqwest::multipart::Form::new()
            .text("prompt", request.prompt.clone())
            .text("model", model.clone())
            .text("response_format", "url".to_string());

        if let Some(image_size) = Self::resolve_image_size(&model, &request.size) {
            form = form.text("image_size", image_size);
        }

        if !request.aspect_ratio.is_empty() && Self::validate_aspect_ratio(&request.aspect_ratio) {
            form = form.text("aspect_ratio", request.aspect_ratio.clone());
        }

        for (index, source) in reference_images.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await.map_err(|error| {
                AIError::InvalidRequest(format!(
                    "Failed to read reference image {}: {}",
                    index + 1,
                    error
                ))
            })?;
            let extension = Self::file_extension_from_source(source);
            let file_name = format!("image_{}.{}", index + 1, extension);
            let part = Part::bytes(bytes)
                .file_name(file_name)
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart part: {}", error))
                })?;
            form = form.part("image", part);
        }

        info!(
            "[Zhenzhen API] Img2Img URL: {}, model: {}, size: {}, aspect_ratio: {}, refs: {}",
            endpoint,
            model,
            request.size,
            request.aspect_ratio,
            reference_images.len()
        );

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await.map_err(AIError::from)?;
        info!("[Zhenzhen API] Response status: {}", status);
        info!("[Zhenzhen API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Zhenzhen request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen response: {}. Response was: {}",
                error, response_text
            ))
        })
    }
}

impl Default for ZhenzhenProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for ZhenzhenProvider {
    fn name(&self) -> &str {
        "zhenzhen"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("zhenzhen/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "zhenzhen/nano-banana".to_string(),
            "zhenzhen/nano-banana-hd".to_string(),
            "zhenzhen/nano-banana-2-4k".to_string(),
            "zhenzhen/gemini-3.1-flash-image-preview-4k".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = Self::resolve_effective_model(&request.model, &request.size);
        info!(
            "[Zhenzhen Request] model: {}, size: {}, aspect_ratio: {}, refs: {}",
            model,
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|v| v.len())
                .unwrap_or(0)
        );

        if Self::is_gemini_preview_model(&model) {
            return self.generate_with_gemini_preview(&request, &model).await;
        }

        let response = if request
            .reference_images
            .as_ref()
            .map(|images| !images.is_empty())
            .unwrap_or(false)
        {
            self.request_image_to_image(&request, model).await?
        } else {
            self.request_text_to_image(&request, model).await?
        };

        if let Some(error) = response.error {
            return Err(AIError::Provider(format!(
                "Zhenzhen API error: {}",
                error.message
            )));
        }

        let data = response
            .data
            .ok_or_else(|| AIError::Provider("Zhenzhen response missing data field".to_string()))?;

        let first_image = data.first().ok_or_else(|| {
            AIError::Provider("Zhenzhen response has empty data array".to_string())
        })?;

        if let Some(url) = &first_image.url {
            return Ok(url.clone());
        }

        if let Some(b64_json) = &first_image.b64_json {
            return Ok(format!("data:image/png;base64,{}", b64_json));
        }

        Err(AIError::Provider(
            "Zhenzhen response missing both url and b64_json".to_string(),
        ))
    }
}
