use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{
    multipart::{Form, Part},
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://ai.t8star.cn";
const CHAT_COMPLETIONS_ENDPOINT_PATH: &str = "/v1/chat/completions";
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";
const GPT_IMAGE_2_MAX_EDGE: f32 = 3840.0;
const GPT_IMAGE_2_MAX_PIXELS: f32 = 8_294_400.0;

const SUPPORTED_MODELS: [&str; 11] = [
    "nano-banana-pro",
    "nano-banana",
    "nano-banana-hd",
    "nano-banana-2",
    "nano-banana-2-2k",
    "nano-banana-2-4k",
    "nano-banana-pro-2k",
    "nano-banana-pro-4k",
    "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-image-preview-4k",
    "gpt-image-2",
];
const LEGACY_DEFAULT_MODELS: [&str; 2] = ["nano-banana", "nano-banana-2"];
const LEGACY_TWO_K_MODEL: &str = "nano-banana-2-2k";
const LEGACY_HD_MODEL: &str = "nano-banana-hd";
const LEGACY_FOUR_K_MODEL: &str = "nano-banana-2-4k";
const DEFAULT_MODEL: &str = "nano-banana-pro";
const LEGACY_NEW_VARIANTS: [&str; 2] = ["nano-banana-pro-2k", "nano-banana-pro-4k"];
const GEMINI_FLASH_IMAGE_PREVIEW_MODEL: &str = "gemini-3.1-flash-image-preview";
const LEGACY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL: &str = "gemini-3.1-flash-image-preview-4k";
const GPT_IMAGE_2_MODEL: &str = "gpt-image-2";

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
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quality: Option<String>,
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
        if sanitized_model == GEMINI_FLASH_IMAGE_PREVIEW_MODEL
            || sanitized_model == LEGACY_GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL
        {
            let _ = requested_size;
            return GEMINI_FLASH_IMAGE_PREVIEW_MODEL.to_string();
        }
        if LEGACY_DEFAULT_MODELS.contains(&sanitized_model.as_str()) {
            return DEFAULT_MODEL.to_string();
        }
        if sanitized_model == LEGACY_TWO_K_MODEL {
            return DEFAULT_MODEL.to_string();
        }
        if sanitized_model == LEGACY_HD_MODEL
            || sanitized_model == LEGACY_FOUR_K_MODEL
            || LEGACY_NEW_VARIANTS.contains(&sanitized_model.as_str())
        {
            return DEFAULT_MODEL.to_string();
        }
        if sanitized_model.is_empty() {
            let _ = requested_size;
            return DEFAULT_MODEL.to_string();
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

    fn resolve_image_size(model: &str, size: &str) -> Option<String> {
        let normalized_model = model.trim().to_ascii_lowercase();
        if normalized_model == GPT_IMAGE_2_MODEL {
            return None;
        }
        if normalized_model.ends_with("-4k") || normalized_model.ends_with("-2k") {
            return None;
        }

        let normalized = size.trim().to_ascii_uppercase();
        match normalized.as_str() {
            "1K" | "2K" | "4K" => Some(normalized),
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
            "/message",
            "/msg",
            "/data/fail_reason",
            "/fail_reason",
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

        [
            "/choices/0/text",
            "/output/text",
            "/output_text",
            "/text",
            "/response/text",
            "/data/text",
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
                "Failed to parse Zhenzhen chat response: {}. Response was: {}",
                error, response_text
            ))
        })?;

        if !status.is_success() {
            return Err(AIError::Provider(
                Self::extract_error_message(&payload).unwrap_or_else(|| {
                    format!("Zhenzhen chat request failed {}: {}", status, response_text)
                }),
            ));
        }

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        Self::extract_text(&payload).ok_or_else(|| {
            AIError::Provider(format!(
                "Zhenzhen chat response did not include text data: {}",
                payload
            ))
        })
    }

    async fn request_generation(
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
            "[Zhenzhen API] Generations URL: {}, model: {}, size: {}, aspect_ratio: {}",
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

    async fn request_edit(
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

        let mut form = Form::new()
            .text("model", model.clone())
            .text("prompt", request.prompt.clone())
            .text("response_format", "url".to_string());

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
            let bytes = Self::source_to_bytes(source).await.map_err(|error| {
                AIError::InvalidRequest(format!("Failed to read image {}: {}", idx + 1, error))
            })?;
            let extension = Self::file_extension_from_source(source);
            let part = Part::bytes(bytes)
                .file_name(format!("image_{}.{}", idx + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart part: {}", error))
                })?;
            form = form.part("image", part);
        }

        info!(
            "[Zhenzhen API] Edits URL: {}, model: {}, size: {}, aspect_ratio: {}, images: {}",
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
                "Zhenzhen edit request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen edit response: {}. Response was: {}",
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
            "zhenzhen/nano-banana-pro".to_string(),
            "zhenzhen/gemini-3.1-flash-image-preview".to_string(),
            "zhenzhen/gpt-image-2".to_string(),
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

        if Self::should_use_chat_completion(&request) {
            return self.request_chat_completion(&request, &model).await;
        }

        let has_reference_images = request
            .reference_images
            .as_ref()
            .map(|images| !images.is_empty())
            .unwrap_or(false);

        let response = if has_reference_images {
            self.request_edit(&request, model).await?
        } else {
            self.request_generation(&request, model).await?
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
