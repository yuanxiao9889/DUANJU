use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://ai.comfly.chat";
const CHAT_COMPLETIONS_ENDPOINT_PATH: &str = "/v1/chat/completions";
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";
const TASKS_ENDPOINT_PATH: &str = "/v1/images/tasks";
const POLL_INTERVAL_MS: u64 = 2000;
const MAX_POLL_RETRIES: u32 = 150;
const GPT_IMAGE_2_MAX_EDGE: f32 = 3840.0;
const GPT_IMAGE_2_MAX_PIXELS: f32 = 8_294_400.0;

const SUPPORTED_MODELS: [&str; 3] = [
    "nano-banana-pro",
    "gemini-3.1-flash-image-preview",
    "gpt-image-2",
];
const DEFAULT_MODEL: &str = "nano-banana-pro";
const GEMINI_FLASH_IMAGE_PREVIEW_MODEL: &str = "gemini-3.1-flash-image-preview";
const GPT_IMAGE_2_MODEL: &str = "gpt-image-2";

const SUPPORTED_ASPECT_RATIOS: [&str; 14] = [
    "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9",
    "21:9",
];

#[derive(Debug, Deserialize)]
struct TaskSubmissionResponse {
    task_id: String,
}

#[derive(Debug, Serialize)]
struct GenerationsRequestBody {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
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
        if sanitized_model.is_empty() {
            let _ = requested_size;
            return DEFAULT_MODEL.to_string();
        }
        if sanitized_model == GEMINI_FLASH_IMAGE_PREVIEW_MODEL {
            return GEMINI_FLASH_IMAGE_PREVIEW_MODEL.to_string();
        }
        if sanitized_model == DEFAULT_MODEL {
            return DEFAULT_MODEL.to_string();
        }

        let _ = requested_size;
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

    fn validate_aspect_ratio(aspect_ratio: &str) -> bool {
        SUPPORTED_ASPECT_RATIOS.contains(&aspect_ratio)
    }

    fn parse_size_dimensions(value: &str) -> Option<(u32, u32)> {
        let (raw_width, raw_height) = value.trim().split_once('x')?;
        let width = raw_width.trim().parse::<u32>().ok()?;
        let height = raw_height.trim().parse::<u32>().ok()?;
        if width == 0 || height == 0 {
            return None;
        }
        Some((width, height))
    }

    fn round_dimension_to_multiple(value: f32) -> u32 {
        let rounded = ((value / 16.0).round() as i32).max(1) * 16;
        rounded as u32
    }

    fn is_near_ratio(actual: f32, target: f32) -> bool {
        (actual - target).abs() < 0.12
    }

    fn clamp_gpt_image_2_dimensions(width: f32, height: f32) -> Option<(u32, u32)> {
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return None;
        }

        let edge_scale = (GPT_IMAGE_2_MAX_EDGE / width.max(height)).min(1.0);
        let pixel_scale = (GPT_IMAGE_2_MAX_PIXELS / (width * height)).sqrt().min(1.0);
        let scale = edge_scale.min(pixel_scale);

        let mut scaled_width = width * scale;
        let mut scaled_height = height * scale;
        let mut rounded_width = Self::round_dimension_to_multiple(scaled_width);
        let mut rounded_height = Self::round_dimension_to_multiple(scaled_height);

        while (rounded_width as f32 > GPT_IMAGE_2_MAX_EDGE
            || rounded_height as f32 > GPT_IMAGE_2_MAX_EDGE
            || (rounded_width * rounded_height) as f32 > GPT_IMAGE_2_MAX_PIXELS)
            && rounded_width > 16
            && rounded_height > 16
        {
            let downscale = (GPT_IMAGE_2_MAX_EDGE / rounded_width.max(rounded_height) as f32).min(
                (GPT_IMAGE_2_MAX_PIXELS / (rounded_width * rounded_height) as f32)
                    .sqrt()
                    .min(1.0),
            );
            scaled_width *= downscale.min(0.995);
            scaled_height *= downscale.min(0.995);
            rounded_width = Self::round_dimension_to_multiple(scaled_width);
            rounded_height = Self::round_dimension_to_multiple(scaled_height);
        }

        Some((rounded_width, rounded_height))
    }

    fn resolve_gpt_image_2_size(size: &str, aspect_ratio: &str) -> Option<String> {
        let normalized_size = size.trim().to_ascii_lowercase();
        if normalized_size.is_empty() || normalized_size == "auto" {
            return Some("auto".to_string());
        }

        if let Some((width, height)) = Self::parse_size_dimensions(&normalized_size) {
            return Some(format!("{}x{}", width, height));
        }

        let ratio = Self::parse_aspect_ratio(aspect_ratio).unwrap_or(1.0);
        if !(1.0 / 3.0..=3.0).contains(&ratio) {
            return None;
        }

        // Bias common orientations to the documented "popular sizes" first.
        if Self::is_near_ratio(ratio, 1.0) {
            match normalized_size.as_str() {
                "1k" => return Some("1024x1024".to_string()),
                "2k" => return Some("2048x2048".to_string()),
                _ => {}
            }
        }
        if Self::is_near_ratio(ratio, 16.0 / 9.0) {
            match normalized_size.as_str() {
                "1k" => return Some("1536x1024".to_string()),
                "2k" => return Some("2048x1152".to_string()),
                "4k" => return Some("3840x2160".to_string()),
                _ => {}
            }
        }
        if Self::is_near_ratio(ratio, 9.0 / 16.0) {
            match normalized_size.as_str() {
                "1k" => return Some("1024x1536".to_string()),
                "2k" => return Some("1152x2048".to_string()),
                "4k" => return Some("2160x3840".to_string()),
                _ => {}
            }
        }

        let resolved = match normalized_size.as_str() {
            "1k" => {
                if ratio >= 1.0 {
                    let height = 1024.0;
                    let width = height * ratio;
                    Self::clamp_gpt_image_2_dimensions(width, height)
                } else {
                    let width = 1024.0;
                    let height = width / ratio;
                    Self::clamp_gpt_image_2_dimensions(width, height)
                }
            }
            "2k" => {
                if ratio >= 1.0 {
                    let width = 2048.0;
                    let height = width / ratio;
                    Self::clamp_gpt_image_2_dimensions(width, height)
                } else {
                    let height = 2048.0;
                    let width = height * ratio;
                    Self::clamp_gpt_image_2_dimensions(width, height)
                }
            }
            "4k" => {
                let width = (GPT_IMAGE_2_MAX_PIXELS * ratio).sqrt();
                let height = (GPT_IMAGE_2_MAX_PIXELS / ratio).sqrt();
                Self::clamp_gpt_image_2_dimensions(width, height)
            }
            _ => None,
        }?;

        Some(format!("{}x{}", resolved.0, resolved.1))
    }

    fn resolve_image_size(_model: &str, size: &str) -> Option<String> {
        if _model.trim().eq_ignore_ascii_case(GPT_IMAGE_2_MODEL) {
            return None;
        }
        let normalized_size = size.trim().to_ascii_uppercase();
        match normalized_size.as_str() {
            "1K" | "2K" | "4K" => Some(normalized_size),
            _ => None,
        }
    }

    fn should_use_size_field(model: &str) -> bool {
        model.trim().eq_ignore_ascii_case(GPT_IMAGE_2_MODEL)
    }

    fn resolve_gpt_image_2_quality(request: &GenerateRequest) -> Option<String> {
        let quality = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(|raw| raw.as_str())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "auto" | "low" | "medium" | "high"));

        quality.or_else(|| Some("auto".to_string()))
    }

    fn parse_aspect_ratio(value: &str) -> Option<f32> {
        let (raw_w, raw_h) = value.split_once(':')?;
        let width = raw_w.trim().parse::<f32>().ok()?;
        let height = raw_h.trim().parse::<f32>().ok()?;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }
        Some(width / height)
    }

    fn should_use_chat_completion(request: &GenerateRequest) -> bool {
        request.size.trim().is_empty() && request.aspect_ratio.trim().is_empty()
    }

    fn extract_error_message(payload: &Value) -> Option<String> {
        [
            "/error/message",
            "/error/status",
            "/message",
            "/detail",
            "/details",
            "/msg",
            "/choices/0/message/refusal",
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

    fn extract_text(payload: &Value) -> Option<String> {
        if let Some(content) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(content.to_string());
        }

        if let Some(content_parts) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_array)
        {
            let text_parts = content_parts
                .iter()
                .filter_map(|part| {
                    part.pointer("/text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<String>>();

            if !text_parts.is_empty() {
                return Some(text_parts.join("\n"));
            }
        }

        payload
            .pointer("/output_text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }

    fn extract_string_from_pointers(payload: &Value, pointers: &[&str]) -> Option<String> {
        pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn extract_task_status(payload: &Value) -> Option<String> {
        Self::extract_string_from_pointers(payload, &["/status", "/data/status"])
            .map(|value| value.to_ascii_uppercase())
    }

    fn extract_task_fail_reason(payload: &Value) -> Option<String> {
        Self::extract_string_from_pointers(
            payload,
            &[
                "/fail_reason",
                "/data/fail_reason",
                "/message",
                "/data/message",
            ],
        )
    }

    fn extract_task_image(payload: &Value) -> Option<String> {
        const IMAGE_ITEM_POINTERS: [&str; 2] = ["/data/data/0", "/data/data/data/0"];

        IMAGE_ITEM_POINTERS.iter().find_map(|pointer| {
            let item = payload.pointer(pointer)?;

            if let Some(url) = item
                .get("url")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(url.to_string());
            }

            item.get("b64_json")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!("data:image/png;base64,{}", value))
        })
    }

    async fn request_chat_completion(
        &self,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<String, AIError> {
        let endpoint = format!("{}{}", self.base_url, CHAT_COMPLETIONS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let body = json!({
            "model": Self::sanitize_model(model),
            "messages": [{
                "role": "user",
                "content": request.prompt.clone(),
            }],
            "stream": false,
        });

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
        let payload: Value = serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Comfly chat response: {}. Response was: {}",
                error, response_text
            ))
        })?;

        if !status.is_success() {
            return Err(AIError::Provider(
                Self::extract_error_message(&payload).unwrap_or_else(|| {
                    format!("Comfly chat request failed {}: {}", status, response_text)
                }),
            ));
        }

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        Self::extract_text(&payload).ok_or_else(|| {
            AIError::Provider(format!(
                "Comfly chat response did not include text data: {}",
                payload
            ))
        })
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
            size: if Self::should_use_size_field(&model) {
                Self::resolve_gpt_image_2_size(&request.size, &request.aspect_ratio)
            } else {
                None
            },
            image_size: Self::resolve_image_size(&model, &request.size),
            aspect_ratio: if !Self::should_use_size_field(&model)
                && !request.aspect_ratio.is_empty()
                && Self::validate_aspect_ratio(&request.aspect_ratio)
            {
                Some(request.aspect_ratio.clone())
            } else {
                None
            },
            quality: if Self::should_use_size_field(&model) {
                Self::resolve_gpt_image_2_quality(request)
            } else {
                None
            },
        };

        info!(
            "[Comfly API] Text2Img URL: {}, model: {}, size: {}, aspect_ratio: {}",
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
        info!("[Comfly API] Response status: {}", status);
        info!("[Comfly API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Comfly request failed {}: {}",
                status, response_text
            )));
        }

        let task_response: TaskSubmissionResponse =
            serde_json::from_str(&response_text).map_err(|e| {
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

        if Self::should_use_size_field(&model) {
            if let Some(size) = Self::resolve_gpt_image_2_size(&request.size, &request.aspect_ratio)
            {
                form = form.text("size", size);
            }
        } else if let Some(image_size) = Self::resolve_image_size(&model, &request.size) {
            form = form.text("image_size", image_size);
        }

        if !Self::should_use_size_field(&model)
            && !request.aspect_ratio.is_empty()
            && Self::validate_aspect_ratio(&request.aspect_ratio)
        {
            form = form.text("aspect_ratio", request.aspect_ratio.clone());
        }
        if Self::should_use_size_field(&model) {
            if let Some(quality) = Self::resolve_gpt_image_2_quality(request) {
                form = form.text("quality", quality);
            }
        }

        for (idx, source) in reference_images.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await.map_err(|e| {
                AIError::InvalidRequest(format!("Failed to read image {}: {}", idx, e))
            })?;
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(format!("image_{}.png", idx))
                .mime_str("image/png")
                .map_err(|e| {
                    AIError::Provider(format!("Failed to create multipart part: {}", e))
                })?;
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

        let task_response: TaskSubmissionResponse =
            serde_json::from_str(&response_text).map_err(|e| {
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

        let response_text = response.text().await.map_err(AIError::from)?;
        let payload: Value = serde_json::from_str(&response_text).map_err(|e| {
            AIError::Provider(format!(
                "Failed to parse task status response: {}. Response was: {}",
                e, response_text
            ))
        })?;

        let task_status = Self::extract_task_status(&payload).ok_or_else(|| {
            AIError::Provider(format!(
                "Task status response missing status field. Response was: {}",
                response_text
            ))
        })?;

        match task_status.as_str() {
            "SUCCESS" => Self::extract_task_image(&payload).map(Some).ok_or_else(|| {
                AIError::Provider(format!(
                    "Task succeeded but no URL or base64 data. Response was: {}",
                    response_text
                ))
            }),
            "FAILURE" | "FAILED" | "ERROR" => {
                let reason = Self::extract_task_fail_reason(&payload)
                    .unwrap_or_else(|| "Unknown error".to_string());
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
            "comfly/nano-banana-pro".to_string(),
            "comfly/gemini-3.1-flash-image-preview".to_string(),
            "comfly/gpt-image-2".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = Self::resolve_effective_model(&request.model, &request.size);
        if Self::should_use_chat_completion(&request) {
            return self.request_chat_completion(&request, &model).await;
        }

        let has_reference_images = request
            .reference_images
            .as_ref()
            .map(|imgs| !imgs.is_empty())
            .unwrap_or(false);

        info!(
            "[Comfly Request] model: {}, size: {}, aspect_ratio: {}, has_images: {}",
            model, request.size, request.aspect_ratio, has_reference_images
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

#[cfg(test)]
mod tests {
    use super::ComflyProvider;
    use serde_json::json;

    #[test]
    fn extracts_image_from_top_level_task_status_payload() {
        let payload = json!({
            "task_id": "demo-task",
            "status": "SUCCESS",
            "fail_reason": "",
            "data": {
                "data": [
                    {
                        "url": "https://oss.filenest.top/uploads/example.png",
                        "b64_json": ""
                    }
                ]
            }
        });

        assert_eq!(
            ComflyProvider::extract_task_status(&payload).as_deref(),
            Some("SUCCESS")
        );
        assert_eq!(
            ComflyProvider::extract_task_image(&payload).as_deref(),
            Some("https://oss.filenest.top/uploads/example.png")
        );
    }

    #[test]
    fn extracts_image_from_nested_task_status_payload() {
        let payload = json!({
            "code": 0,
            "message": "success",
            "data": {
                "status": "SUCCESS",
                "fail_reason": "",
                "data": {
                    "data": [
                        {
                            "b64_json": "ZmFrZS1iYXNlNjQ="
                        }
                    ]
                }
            }
        });

        assert_eq!(
            ComflyProvider::extract_task_status(&payload).as_deref(),
            Some("SUCCESS")
        );
        assert_eq!(
            ComflyProvider::extract_task_image(&payload).as_deref(),
            Some("data:image/png;base64,ZmFrZS1iYXNlNjQ=")
        );
    }
}
