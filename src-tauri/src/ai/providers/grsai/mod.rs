use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

const DRAW_ENDPOINT_PATH: &str = "/v1/draw/nano-banana";
const RESULT_ENDPOINT_PATH: &str = "/v1/draw/result";
const GPT_IMAGE_GENERATE_ENDPOINT_PATH: &str = "/v1/api/generate";
const GPT_IMAGE_RESULT_ENDPOINT_PATH: &str = "/v1/api/result";
const UPLOAD_TOKEN_ENDPOINT_PATH: &str = "/client/resource/newUploadTokenZH";
const DEFAULT_BASE_URL: &str = "https://grsai.dakka.com.cn";
const DEFAULT_PRO_MODEL: &str = "nano-banana-pro";
const DEFAULT_GPT_IMAGE_MODEL: &str = "gpt-image-2-vip";
const LEGACY_GPT_IMAGE_MODEL: &str = "gpt-image-2";
const GPT_IMAGE_2_MAX_EDGE: f32 = 3840.0;
const GPT_IMAGE_2_MAX_PIXELS: f32 = 8_294_400.0;
const POLL_INTERVAL_MS: u64 = 2000;
const LOG_RESPONSE_PREVIEW_CHARS: usize = 800;

const SUPPORTED_MODELS: [&str; 10] = [
    "nano-banana-2",
    "nano-banana-fast",
    "nano-banana",
    "nano-banana-pro",
    "nano-banana-pro-vt",
    "nano-banana-pro-cl",
    "nano-banana-pro-vip",
    "nano-banana-pro-4k-vip",
    LEGACY_GPT_IMAGE_MODEL,
    DEFAULT_GPT_IMAGE_MODEL,
];

const SUPPORTED_ASPECT_RATIOS: [&str; 15] = [
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "9:21", "1:3", "3:1",
    "1:2", "2:1",
];

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

fn encode_reference_for_grsai(source: &str) -> Option<String> {
    let trimmed = source.trim().trim_matches('`').trim();
    if trimmed.is_empty() {
        info!("[GRSAI API] encode_reference_for_grsai: source is empty");
        return None;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        info!("[GRSAI API] encode_reference_for_grsai: returning URL as-is");
        return Some(trimmed.to_string());
    }

    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            info!("[GRSAI API] encode_reference_for_grsai: returning data URL payload");
            return Some(payload.to_string());
        }
    }

    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        info!("[GRSAI API] encode_reference_for_grsai: returning as base64");
        return Some(trimmed.to_string());
    }

    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    info!(
        "[GRSAI API] encode_reference_for_grsai: reading file from path: {:?}",
        path
    );
    match std::fs::read(&path) {
        Ok(bytes) => {
            info!(
                "[GRSAI API] encode_reference_for_grsai: successfully read {} bytes",
                bytes.len()
            );
            Some(STANDARD.encode(bytes))
        }
        Err(e) => {
            info!(
                "[GRSAI API] encode_reference_for_grsai: failed to read file: {}",
                e
            );
            None
        }
    }
}

fn source_to_bytes(source: &str) -> Result<Vec<u8>, String> {
    let trimmed = source.trim().trim_matches('`').trim();
    if trimmed.is_empty() {
        return Err("source is empty".to_string());
    }

    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return STANDARD
                .decode(payload)
                .map_err(|err| format!("invalid data URL payload: {}", err));
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

    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
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

fn file_extension_from_source(source: &str) -> String {
    let trimmed = source.trim().trim_matches('`').trim();
    if trimmed.starts_with("data:image/") {
        let head = trimmed.split(',').next().unwrap_or_default();
        let suffix = head
            .trim_start_matches("data:image/")
            .split(';')
            .next()
            .unwrap_or("png")
            .trim();
        if !suffix.is_empty() {
            return suffix.to_lowercase();
        }
    }

    if trimmed.starts_with("file://")
        || (!trimmed.starts_with("http://") && !trimmed.starts_with("https://"))
    {
        let path = if trimmed.starts_with("file://") {
            PathBuf::from(decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };
        if let Some(ext) = path.extension().and_then(|raw| raw.to_str()) {
            let ext = ext.trim().to_lowercase();
            if !ext.is_empty() {
                return ext;
            }
        }
    }

    "png".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NanoBananaDrawRequestBody {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_size: Option<String>,
    urls: Vec<String>,
    #[serde(rename = "webHook")]
    web_hook: String,
    shut_progress: bool,
    cdn: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GptImageGenerateRequestBody {
    model: String,
    prompt: String,
    images: Vec<String>,
    aspect_ratio: String,
    quality: String,
    reply_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GrsaiRequestRoute {
    NanoBanana,
    Completions,
}

pub struct GrsaiProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl GrsaiProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    fn is_nano_banana_model(model: &str) -> bool {
        let normalized = model.trim().to_ascii_lowercase();
        normalized == "nano-banana"
            || normalized == "nano-banana-2"
            || normalized == "nano-banana-fast"
            || normalized.starts_with("nano-banana-pro")
    }

    fn resolve_request_route(model: &str) -> GrsaiRequestRoute {
        if Self::is_nano_banana_model(model) {
            GrsaiRequestRoute::NanoBanana
        } else {
            GrsaiRequestRoute::Completions
        }
    }

    fn normalize_requested_model(&self, request: &GenerateRequest) -> String {
        let requested = request
            .model
            .split_once('/')
            .map(|(_, model)| model.to_string())
            .unwrap_or_else(|| request.model.clone())
            .trim()
            .to_string();

        info!(
            "[GRSAI] Original model: {}, normalized: {}",
            request.model, requested
        );

        if requested.is_empty() {
            return DEFAULT_PRO_MODEL.to_string();
        }

        if requested == "nano-banana-2"
            || requested == "nano-banana-fast"
            || requested == "nano-banana"
        {
            return requested;
        }

        if requested == "nano-banana-pro" || requested.starts_with("nano-banana-pro-") {
            return request
                .extra_params
                .as_ref()
                .and_then(|params| params.get("grsai_pro_model"))
                .and_then(|value| value.as_str())
                .map(Self::normalize_pro_variant)
                .unwrap_or_else(|| "nano-banana-pro".to_string());
        }

        if Self::resolve_request_route(&requested) == GrsaiRequestRoute::Completions {
            return Self::resolve_completions_model(&requested);
        }

        requested
    }

    fn normalize_pro_variant(input: &str) -> String {
        let trimmed = input.trim().to_lowercase();
        if trimmed == DEFAULT_PRO_MODEL || trimmed.starts_with("nano-banana-pro-") {
            return trimmed;
        }
        DEFAULT_PRO_MODEL.to_string()
    }

    fn resolve_completions_model(input: &str) -> String {
        let trimmed = input.trim().to_ascii_lowercase();
        if trimmed.is_empty()
            || trimmed == LEGACY_GPT_IMAGE_MODEL
            || trimmed == DEFAULT_GPT_IMAGE_MODEL
        {
            return DEFAULT_GPT_IMAGE_MODEL.to_string();
        }
        trimmed
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

    fn parse_aspect_ratio(value: &str) -> Option<f32> {
        let (raw_w, raw_h) = value.split_once(':')?;
        let width = raw_w.trim().parse::<f32>().ok()?;
        let height = raw_h.trim().parse::<f32>().ok()?;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }
        Some(width / height)
    }

    fn normalize_legacy_aspect_ratio(aspect_ratio: &str) -> String {
        match aspect_ratio.trim() {
            "1:4" | "1:8" => "1:3".to_string(),
            "4:1" | "8:1" => "3:1".to_string(),
            other => other.to_string(),
        }
    }

    fn resolve_gpt_image_2_size(size: &str, aspect_ratio: &str) -> Option<String> {
        let normalized_size = size.trim().to_ascii_lowercase();
        if normalized_size.is_empty() || normalized_size == "auto" {
            return Some("auto".to_string());
        }

        let normalized_aspect_ratio = Self::normalize_legacy_aspect_ratio(aspect_ratio);
        if let Some((width, height)) = Self::parse_size_dimensions(&normalized_aspect_ratio) {
            return Some(format!("{}x{}", width, height));
        }

        if let Some((width, height)) = Self::parse_size_dimensions(&normalized_size) {
            return Some(format!("{}x{}", width, height));
        }

        let ratio = Self::parse_aspect_ratio(&normalized_aspect_ratio).unwrap_or(1.0);
        if !(1.0 / 3.0..=3.0).contains(&ratio) {
            return None;
        }

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

    fn resolve_completions_aspect_ratio(request: &GenerateRequest) -> String {
        let raw_aspect_ratio = request.aspect_ratio.trim();
        if raw_aspect_ratio.is_empty() || raw_aspect_ratio.eq_ignore_ascii_case("auto") {
            return "auto".to_string();
        }

        let normalized_aspect_ratio = Self::normalize_legacy_aspect_ratio(raw_aspect_ratio);
        if request.size.trim().is_empty() || request.size.trim().eq_ignore_ascii_case("auto") {
            if Self::parse_size_dimensions(&normalized_aspect_ratio).is_some()
                || Self::validate_aspect_ratio(&normalized_aspect_ratio)
            {
                return normalized_aspect_ratio;
            }
            return "auto".to_string();
        }

        Self::resolve_gpt_image_2_size(&request.size, &normalized_aspect_ratio)
            .unwrap_or_else(|| normalized_aspect_ratio.to_string())
    }

    fn resolve_completions_quality(request: &GenerateRequest) -> String {
        request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(|raw| raw.as_str())
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "auto" | "low" | "medium" | "high"))
            .unwrap_or_else(|| "auto".to_string())
    }

    fn resolve_task_payload<'a>(value: &'a Value) -> Result<&'a Value, AIError> {
        if let Some(code) = value.get("code").and_then(|raw| raw.as_i64()) {
            if code != 0 {
                let msg = value
                    .get("msg")
                    .and_then(|raw| raw.as_str())
                    .unwrap_or("unknown error");
                return Err(AIError::Provider(format!(
                    "GRSAI API code {}: {}",
                    code, msg
                )));
            }
            return value
                .get("data")
                .ok_or_else(|| AIError::Provider("GRSAI response missing data field".to_string()));
        }

        Ok(value)
    }

    fn looks_like_gpt_image_task_id(task_id: &str) -> bool {
        task_id
            .split_once('-')
            .map(|(prefix, rest)| {
                !prefix.is_empty()
                    && !rest.is_empty()
                    && prefix.chars().all(|ch| ch.is_ascii_digit())
            })
            .unwrap_or(false)
    }

    fn parse_response_value(response_text: &str) -> Result<Value, AIError> {
        let trimmed = response_text.trim();
        if trimmed.is_empty() {
            return Err(AIError::Provider("GRSAI response is empty".to_string()));
        }

        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return Ok(value);
        }

        let mut sse_data_payload: Option<&str> = None;
        for line in trimmed.lines() {
            let normalized = line.trim();
            if let Some(rest) = normalized.strip_prefix("data:") {
                let payload = rest.trim();
                if !payload.is_empty() && payload != "[DONE]" {
                    sse_data_payload = Some(payload);
                }
            }
        }

        if let Some(payload) = sse_data_payload {
            return serde_json::from_str::<Value>(payload).map_err(|e| {
                AIError::Provider(format!(
                    "Failed to parse GRSAI SSE payload: {}. Payload was: {}",
                    e, payload
                ))
            });
        }

        Err(AIError::Provider(format!(
            "Failed to parse GRSAI response as JSON or SSE data payload. Response was: {}",
            response_text
        )))
    }

    fn summarize_response_for_log(response_text: &str) -> String {
        let trimmed = response_text.trim();
        if trimmed.chars().count() <= LOG_RESPONSE_PREVIEW_CHARS {
            return trimmed.to_string();
        }

        let preview = trimmed
            .chars()
            .take(LOG_RESPONSE_PREVIEW_CHARS)
            .collect::<String>();
        format!("{}...({} chars)", preview, trimmed.chars().count())
    }

    fn extract_result_url(payload: &Value) -> Option<String> {
        payload
            .get("results")
            .and_then(|results| results.as_array())
            .and_then(|results| results.first())
            .and_then(|first| first.get("url"))
            .or_else(|| {
                payload
                    .get("data")
                    .and_then(|data| data.as_array())
                    .and_then(|data| data.first())
                    .and_then(|first| first.get("url"))
            })
            .or_else(|| payload.get("url"))
            .and_then(|url| url.as_str())
            .map(|url| url.trim().trim_matches('`').trim().to_string())
            .filter(|url| !url.is_empty())
    }

    fn extract_result_status(payload: &Value) -> Option<String> {
        payload
            .get("status")
            .or_else(|| payload.get("state"))
            .and_then(|raw| raw.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase())
    }

    fn extract_failure_reason(payload: &Value) -> String {
        for key in ["error", "failure_reason", "failureReason", "msg", "message"] {
            if let Some(reason) = payload
                .get(key)
                .and_then(|raw| raw.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return reason.to_string();
            }

            if let Some(reason) = payload
                .get(key)
                .and_then(|raw| raw.get("message"))
                .and_then(|raw| raw.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return reason.to_string();
            }
        }

        "unknown failure".to_string()
    }

    async fn upload_reference_image_zh(
        &self,
        api_key: &str,
        source: &str,
    ) -> Result<String, AIError> {
        if source.starts_with("http://") || source.starts_with("https://") {
            return Ok(source.to_string());
        }

        let extension = file_extension_from_source(source);
        let token_endpoint = format!("{}{}", self.base_url, UPLOAD_TOKEN_ENDPOINT_PATH);
        let token_response = self
            .client
            .post(&token_endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&json!({ "sux": extension }))
            .send()
            .await?;

        if !token_response.status().is_success() {
            let status = token_response.status();
            let error_text = token_response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "GRSAI upload token request failed {}: {}",
                status, error_text
            )));
        }

        let token_json = token_response.json::<Value>().await?;
        let token_payload = Self::resolve_task_payload(&token_json)?;
        let token = token_payload
            .get("token")
            .and_then(|raw| raw.as_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AIError::Provider("GRSAI upload token missing token".to_string()))?;
        let key = token_payload
            .get("key")
            .and_then(|raw| raw.as_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AIError::Provider("GRSAI upload token missing key".to_string()))?;
        let upload_url = token_payload
            .get("url")
            .and_then(|raw| raw.as_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AIError::Provider("GRSAI upload token missing url".to_string()))?;
        let domain = token_payload
            .get("domain")
            .and_then(|raw| raw.as_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AIError::Provider("GRSAI upload token missing domain".to_string()))?;

        let bytes = source_to_bytes(source).map_err(|err| {
            AIError::InvalidRequest(format!(
                "Failed to read reference image for GRSAI upload: {}; source={}",
                err, source
            ))
        })?;
        let file_part = Part::bytes(bytes).file_name(format!("ref.{}", extension));
        let form = Form::new()
            .text("token", token.to_string())
            .text("key", key.to_string())
            .part("file", file_part);

        let upload_response = self.client.post(upload_url).multipart(form).send().await?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let error_text = upload_response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "GRSAI file upload failed {}: {}",
                status, error_text
            )));
        }

        Ok(format!(
            "{}/{}",
            domain.trim_end_matches('/'),
            key.trim_start_matches('/')
        ))
    }

    async fn send_request_body<T: Serialize>(
        &self,
        endpoint: &str,
        api_key: &str,
        body: &T,
    ) -> Result<Value, AIError> {
        let request_body = serde_json::to_string(body)
            .map_err(|e| AIError::Provider(format!("Failed to serialize request body: {}", e)))?;

        info!("[GRSAI API] Full URL: {}", endpoint);
        info!("[GRSAI API] Request body length: {}", request_body.len());
        info!("[GRSAI API] API Key length: {}", api_key.len());

        let response = self
            .client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json; charset=utf-8")
            .body(request_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            info!("[GRSAI API] Error response: {}", error_text);
            return Err(AIError::Provider(format!(
                "GRSAI draw request failed {}: {}",
                status, error_text
            )));
        }

        let response_text = response.text().await.map_err(AIError::from)?;
        info!(
            "[GRSAI API] Response: {}",
            Self::summarize_response_for_log(response_text.as_str())
        );
        Self::parse_response_value(&response_text)
    }

    async fn prepare_reference_urls(
        &self,
        api_key: &str,
        request: &GenerateRequest,
        allow_inline_fallback: bool,
    ) -> Result<Vec<String>, AIError> {
        let mut urls: Vec<String> = Vec::new();
        if let Some(images) = request.reference_images.as_ref() {
            info!("[GRSAI API] Reference images count: {}", images.len());
            for image in images.iter().take(6) {
                match self.upload_reference_image_zh(api_key, image).await {
                    Ok(uploaded_url) => urls.push(uploaded_url),
                    Err(upload_error) => {
                        info!(
                            "[GRSAI API] upload_reference_image_zh failed, fallback enabled={}, error={}",
                            allow_inline_fallback, upload_error
                        );

                        if allow_inline_fallback {
                            if let Some(fallback) = encode_reference_for_grsai(image) {
                                urls.push(fallback);
                                continue;
                            }
                        }

                        return Err(upload_error);
                    }
                }
            }
            info!(
                "[GRSAI API] Prepared reference payload count: {}",
                urls.len()
            );
        }

        Ok(urls)
    }

    async fn request_draw(
        &self,
        request: &GenerateRequest,
        model: String,
        return_task_id_immediately: bool,
    ) -> Result<Value, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;
        let route = Self::resolve_request_route(&model);

        if route == GrsaiRequestRoute::Completions {
            let model = Self::resolve_completions_model(&model);
            let aspect_ratio = Self::resolve_completions_aspect_ratio(request);
            let quality = Self::resolve_completions_quality(request);
            let images = self.prepare_reference_urls(&api_key, request, true).await?;
            let reply_type = if return_task_id_immediately {
                "async"
            } else {
                "json"
            }
            .to_string();
            info!(
                "[GRSAI API] gpt-image request model: {}, aspectRatio: {}, quality: {}, images: {}, prompt_chars: {}, replyType: {}",
                model,
                aspect_ratio,
                quality,
                images.len(),
                request.prompt.chars().count(),
                reply_type
            );
            let body = GptImageGenerateRequestBody {
                model,
                prompt: request.prompt.clone(),
                images,
                aspect_ratio,
                quality,
                reply_type,
            };
            let endpoint = format!("{}{}", self.base_url, GPT_IMAGE_GENERATE_ENDPOINT_PATH);
            return self.send_request_body(&endpoint, &api_key, &body).await;
        }

        let image_size = if request.size.is_empty() {
            None
        } else {
            Some(request.size.clone())
        };
        let aspect_ratio = if request.aspect_ratio.is_empty() {
            None
        } else {
            Some(request.aspect_ratio.clone())
        };
        let urls = self.prepare_reference_urls(&api_key, request, true).await?;

        let body = NanoBananaDrawRequestBody {
            model,
            prompt: request.prompt.clone(),
            aspect_ratio,
            image_size,
            urls,
            web_hook: if return_task_id_immediately {
                "-1".to_string()
            } else {
                String::new()
            },
            shut_progress: true,
            cdn: "zh".to_string(),
        };

        let endpoint = format!("{}{}", self.base_url, DRAW_ENDPOINT_PATH);
        let response = self.send_request_body(&endpoint, &api_key, &body).await?;
        let should_retry_minimal = response
            .get("code")
            .and_then(|raw| raw.as_i64())
            .map(|code| code == -4)
            .unwrap_or(false)
            && response
                .get("msg")
                .and_then(|raw| raw.as_str())
                .map(|msg| msg.contains("unexpected end of JSON input"))
                .unwrap_or(false);

        if should_retry_minimal {
            let fallback_body = NanoBananaDrawRequestBody {
                model: body.model.clone(),
                prompt: body.prompt.clone(),
                aspect_ratio: None,
                image_size: body.image_size.clone(),
                urls: body.urls.clone(),
                web_hook: body.web_hook.clone(),
                shut_progress: body.shut_progress,
                cdn: body.cdn.clone(),
            };
            info!("[GRSAI API] Retrying draw request with minimal optional fields");
            return self
                .send_request_body(&endpoint, &api_key, &fallback_body)
                .await;
        }

        Ok(response)
    }

    async fn poll_draw_result_once(
        &self,
        task_id: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}{}", self.base_url, RESULT_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&json!({ "id": task_id }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "GRSAI result request failed {}: {}",
                status, error_text
            )));
        }

        let poll_response_text = response.text().await.map_err(AIError::from)?;
        info!(
            "[GRSAI API] draw result response: {}",
            Self::summarize_response_for_log(poll_response_text.as_str())
        );
        let poll_response = Self::parse_response_value(&poll_response_text)?;
        let payload = Self::resolve_task_payload(&poll_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(ProviderTaskPollResult::Succeeded(url));
        }

        match payload.get("status").and_then(|raw| raw.as_str()) {
            Some("running") | Option::None => Ok(ProviderTaskPollResult::Running),
            Some("failed") => {
                let reason = payload
                    .get("error")
                    .and_then(|raw| raw.as_str())
                    .filter(|value| !value.is_empty())
                    .or_else(|| payload.get("failure_reason").and_then(|raw| raw.as_str()))
                    .unwrap_or("unknown failure");
                Ok(ProviderTaskPollResult::Failed(reason.to_string()))
            }
            Some(other) => Err(AIError::Provider(format!(
                "GRSAI unexpected task status: {}",
                other
            ))),
        }
    }

    async fn poll_gpt_image_result_once(
        &self,
        task_id: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}{}", self.base_url, GPT_IMAGE_RESULT_ENDPOINT_PATH);
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
            .query(&[("id", task_id)])
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "GRSAI gpt-image result request failed {}: {}",
                status, error_text
            )));
        }

        let poll_response_text = response.text().await.map_err(AIError::from)?;
        info!(
            "[GRSAI API] gpt-image result response: {}",
            Self::summarize_response_for_log(poll_response_text.as_str())
        );
        let poll_response = Self::parse_response_value(&poll_response_text)?;

        if let Some(url) = Self::extract_result_url(&poll_response) {
            return Ok(ProviderTaskPollResult::Succeeded(url));
        }

        match Self::extract_result_status(&poll_response).as_deref() {
            Some("running") | Option::None => Ok(ProviderTaskPollResult::Running),
            Some("succeeded") => Err(AIError::Provider(format!(
                "GRSAI gpt-image result missing image url: {}",
                poll_response
            ))),
            Some("failed") | Some("violation") => Ok(ProviderTaskPollResult::Failed(
                Self::extract_failure_reason(&poll_response),
            )),
            Some(other) => Err(AIError::Provider(format!(
                "GRSAI unexpected gpt-image task status: {}",
                other
            ))),
        }
    }

    async fn poll_result_once(
        &self,
        task_id: &str,
        route: GrsaiRequestRoute,
    ) -> Result<ProviderTaskPollResult, AIError> {
        match route {
            GrsaiRequestRoute::Completions => self.poll_gpt_image_result_once(task_id).await,
            GrsaiRequestRoute::NanoBanana => self.poll_draw_result_once(task_id).await,
        }
    }

    async fn poll_result_until_complete(
        &self,
        task_id: &str,
        route: GrsaiRequestRoute,
    ) -> Result<String, AIError> {
        loop {
            match self.poll_result_once(task_id, route).await? {
                ProviderTaskPollResult::Running => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await
                }
                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                ProviderTaskPollResult::Failed(message) => {
                    return Err(AIError::TaskFailed(message))
                }
            }
        }
    }
}

impl Default for GrsaiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for GrsaiProvider {
    fn name(&self) -> &str {
        "grsai"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("grsai/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "grsai/nano-banana-2".to_string(),
            "grsai/nano-banana-pro".to_string(),
            "grsai/gpt-image-2-vip".to_string(),
            "grsai/gpt-image-2".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    fn should_use_task_resume(&self, request: &GenerateRequest) -> bool {
        let model = self.normalize_requested_model(request);
        matches!(
            Self::resolve_request_route(&model),
            GrsaiRequestRoute::NanoBanana | GrsaiRequestRoute::Completions
        )
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let model = self.normalize_requested_model(&request);
        let route = Self::resolve_request_route(&model);
        if route == GrsaiRequestRoute::Completions {
            let payload = self.request_draw(&request, model, true).await?;
            if let Some(url) = Self::extract_result_url(&payload) {
                return Ok(ProviderTaskSubmission::Succeeded(url));
            }

            match Self::extract_result_status(&payload).as_deref() {
                Some("running") => {
                    let task_id =
                        payload
                            .get("id")
                            .and_then(|raw| raw.as_str())
                            .ok_or_else(|| {
                                AIError::Provider(
                                    "GRSAI gpt-image response missing task id".to_string(),
                                )
                            })?;
                    return Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
                        task_id: task_id.to_string(),
                        metadata: Some(json!({ "route": "gpt-image" })),
                    }));
                }
                Some("failed") | Some("violation") => {
                    return Err(AIError::Provider(Self::extract_failure_reason(&payload)));
                }
                _ => {}
            }

            return Err(AIError::Provider(format!(
                "GRSAI gpt-image response missing image url or task id: {}",
                payload
            )));
        }
        let draw_response = self.request_draw(&request, model, true).await?;
        let payload = Self::resolve_task_payload(&draw_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(ProviderTaskSubmission::Succeeded(url));
        }

        let task_id = payload
            .get("id")
            .and_then(|raw| raw.as_str())
            .ok_or_else(|| AIError::Provider("GRSAI response missing task id".to_string()))?;
        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id: task_id.to_string(),
            metadata: Some(json!({
                "route": match route {
                    GrsaiRequestRoute::Completions => "gpt-image",
                    GrsaiRequestRoute::NanoBanana => "draw",
                }
            })),
        }))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let route = if Self::looks_like_gpt_image_task_id(handle.task_id.as_str()) {
            GrsaiRequestRoute::Completions
        } else {
            handle
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("route"))
                .and_then(Value::as_str)
                .map(|value| {
                    if value == "gpt-image" {
                        GrsaiRequestRoute::Completions
                    } else {
                        GrsaiRequestRoute::NanoBanana
                    }
                })
                .unwrap_or(GrsaiRequestRoute::NanoBanana)
        };
        self.poll_result_once(handle.task_id.as_str(), route).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = self.normalize_requested_model(&request);
        let route = Self::resolve_request_route(&model);
        info!(
            "[GRSAI Request] model: {}, size: {}, aspect_ratio: {}",
            model, request.size, request.aspect_ratio
        );

        let draw_response = self.request_draw(&request, model, false).await?;
        if route == GrsaiRequestRoute::Completions {
            if let Some(url) = Self::extract_result_url(&draw_response) {
                return Ok(url);
            }

            match Self::extract_result_status(&draw_response).as_deref() {
                Some("running") => {
                    let task_id = draw_response
                        .get("id")
                        .and_then(|raw| raw.as_str())
                        .ok_or_else(|| {
                            AIError::Provider(
                                "GRSAI gpt-image response missing task id".to_string(),
                            )
                        })?;
                    return self
                        .poll_result_until_complete(task_id, GrsaiRequestRoute::Completions)
                        .await;
                }
                Some("failed") | Some("violation") => {
                    return Err(AIError::Provider(Self::extract_failure_reason(
                        &draw_response,
                    )));
                }
                _ => {}
            }

            return Err(AIError::Provider(format!(
                "GRSAI gpt-image response missing image url or task id: {}",
                draw_response
            )));
        }
        let payload = Self::resolve_task_payload(&draw_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(url);
        }

        let task_id = payload
            .get("id")
            .and_then(|raw| raw.as_str())
            .ok_or_else(|| AIError::Provider("GRSAI response missing task id".to_string()))?;

        self.poll_result_until_complete(task_id, route).await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{GptImageGenerateRequestBody, GrsaiProvider};
    use crate::ai::{AIProvider, GenerateRequest};

    fn make_request(
        model: &str,
        size: &str,
        aspect_ratio: &str,
        quality: Option<&str>,
    ) -> GenerateRequest {
        let extra_params =
            quality.map(|value| HashMap::from([("quality".to_string(), json!(value))]));

        GenerateRequest {
            prompt: "test prompt".to_string(),
            model: model.to_string(),
            size: size.to_string(),
            aspect_ratio: aspect_ratio.to_string(),
            reference_images: None,
            extra_params,
        }
    }

    #[test]
    fn list_models_includes_documented_gpt_image_id() {
        let provider = GrsaiProvider::new();
        assert!(provider
            .list_models()
            .contains(&"grsai/gpt-image-2-vip".to_string()));
        assert!(provider
            .list_models()
            .contains(&"grsai/gpt-image-2".to_string()));
    }

    #[test]
    fn normalizes_gpt_image_aliases_to_vip_model() {
        let provider = GrsaiProvider::new();
        for model in [
            "grsai/gpt-image-2",
            "gpt-image-2",
            "gpt-image-2-vip",
            "grsai/gpt-image-2-vip",
        ] {
            let request = make_request(model, "2K", "16:9", None);
            assert_eq!(
                provider.normalize_requested_model(&request),
                "gpt-image-2-vip".to_string()
            );
        }
    }

    #[test]
    fn grsai_documented_async_models_use_resumable_submission() {
        let provider = GrsaiProvider::new();
        assert!(provider.should_use_task_resume(&make_request(
            "grsai/gpt-image-2-vip",
            "4K",
            "9:16",
            None
        )));
        assert!(provider.should_use_task_resume(&make_request(
            "grsai/nano-banana-pro",
            "2K",
            "16:9",
            None
        )));
    }

    #[test]
    fn serializes_gpt_image_generate_body_with_aspect_ratio_and_reply_type() {
        let body = GptImageGenerateRequestBody {
            model: "gpt-image-2-vip".to_string(),
            prompt: "prompt".to_string(),
            images: vec!["https://example.com/ref.png".to_string()],
            aspect_ratio: "2048x1152".to_string(),
            quality: "high".to_string(),
            reply_type: "async".to_string(),
        };

        let value = serde_json::to_value(body).expect("body should serialize");
        assert_eq!(
            value.get("model").and_then(|raw| raw.as_str()),
            Some("gpt-image-2-vip")
        );
        assert_eq!(
            value.get("aspectRatio").and_then(|raw| raw.as_str()),
            Some("2048x1152")
        );
        assert_eq!(
            value.get("quality").and_then(|raw| raw.as_str()),
            Some("high")
        );
        assert_eq!(
            value.get("replyType").and_then(|raw| raw.as_str()),
            Some("async")
        );
        assert_eq!(
            value
                .get("images")
                .and_then(|raw| raw.as_array())
                .map(Vec::len),
            Some(1)
        );
        assert!(value.get("image").is_none());
        assert!(value.get("urls").is_none());
        assert!(value.get("size").is_none());
        assert!(value.get("response_format").is_none());
        assert!(value.get("responseFormat").is_none());
    }

    #[test]
    fn resolves_common_vip_sizes() {
        assert_eq!(
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "1K",
                "1:1",
                None
            )),
            "1024x1024".to_string()
        );
        assert_eq!(
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "2K",
                "16:9",
                None
            )),
            "2048x1152".to_string()
        );
        assert_eq!(
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "4K",
                "9:16",
                None
            )),
            "2160x3840".to_string()
        );
    }

    #[test]
    fn normalizes_legacy_extreme_ratios_to_documented_bounds() {
        assert_eq!(
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "2K",
                "1:8",
                None
            )),
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "2K",
                "1:3",
                None
            ))
        );
        assert_eq!(
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "2K",
                "8:1",
                None
            )),
            GrsaiProvider::resolve_completions_aspect_ratio(&make_request(
                "gpt-image-2",
                "2K",
                "3:1",
                None
            ))
        );
    }

    #[test]
    fn defaults_quality_to_auto_and_preserves_explicit_values() {
        assert_eq!(
            GrsaiProvider::resolve_completions_quality(&make_request(
                "gpt-image-2",
                "2K",
                "16:9",
                None
            )),
            "auto".to_string()
        );
        assert_eq!(
            GrsaiProvider::resolve_completions_quality(&make_request(
                "gpt-image-2",
                "2K",
                "16:9",
                Some("medium")
            )),
            "medium".to_string()
        );
    }
}
