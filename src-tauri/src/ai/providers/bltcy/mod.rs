use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::Part;
use reqwest::Client;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://api.bltcy.ai";
const EDITS_ENDPOINT_PATH: &str = "/v1/images/edits";
const CHAT_COMPLETIONS_ENDPOINT_PATH: &str = "/v1/chat/completions";
const TASKS_ENDPOINT_PATH: &str = "/v1/images/tasks";
const POLL_INTERVAL_MS: u64 = 2000;
const MAX_POLL_RETRIES: u32 = 150;

const NANO_BANANA_2_4K_MODEL: &str = "nano-banana-2-4k";
const GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL: &str = "gemini-3.1-flash-image-preview-4k";
const SUPPORTED_MODELS: [&str; 2] = [
    NANO_BANANA_2_4K_MODEL,
    GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL,
];

const SUPPORTED_ASPECT_RATIOS: [&str; 14] = [
    "1:1",
    "1:4",
    "1:8",
    "2:3",
    "3:2",
    "3:4",
    "4:1",
    "4:3",
    "4:5",
    "5:4",
    "8:1",
    "9:16",
    "16:9",
    "21:9",
];

pub struct BltcyProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl BltcyProvider {
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

    fn is_gemini_preview_model(model: &str) -> bool {
        Self::sanitize_model(model) == GEMINI_FLASH_IMAGE_PREVIEW_4K_MODEL
    }

    fn validate_aspect_ratio(aspect_ratio: &str) -> bool {
        SUPPORTED_ASPECT_RATIOS.contains(&aspect_ratio)
    }

    fn resolve_image_size(model: &str, size: &str) -> Option<String> {
        let normalized_model = model.trim().to_ascii_lowercase();
        if normalized_model.ends_with("-4k") || normalized_model.ends_with("-2k") {
            return None;
        }

        match size.trim().to_ascii_uppercase().as_str() {
            "1K" | "2K" | "4K" => Some(size.trim().to_ascii_uppercase()),
            _ => None,
        }
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

    async fn source_to_bytes(source: &str) -> Result<Vec<u8>, AIError> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err(AIError::InvalidRequest("image source is empty".to_string()));
        }

        if let Some((meta, payload)) = trimmed.split_once(',') {
            if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
                return STANDARD.decode(payload).map_err(|error| {
                    AIError::InvalidRequest(format!("invalid base64 payload: {}", error))
                });
            }
        }

        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            return STANDARD.decode(trimmed).map_err(|error| {
                AIError::InvalidRequest(format!("invalid base64 payload: {}", error))
            });
        }

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            let response = reqwest::get(trimmed).await?;
            let bytes = response.bytes().await?;
            return Ok(bytes.to_vec());
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };
        std::fs::read(&path).map_err(|error| {
            AIError::InvalidRequest(format!(
                "failed to read path \"{}\": {}",
                path.to_string_lossy(),
                error
            ))
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

    async fn source_to_data_url(source: &str) -> Result<String, AIError> {
        let trimmed = source.trim();
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Ok(trimmed.to_string());
        }
        if trimmed.starts_with("data:") {
            return Ok(trimmed.to_string());
        }

        let extension = Self::file_extension_from_source(trimmed);
        let mime_type = Self::mime_type_from_extension(extension);
        let bytes = Self::source_to_bytes(trimmed).await?;
        Ok(format!(
            "data:{};base64,{}",
            mime_type,
            STANDARD.encode(bytes)
        ))
    }

    fn extract_error_message(payload: &Value) -> Option<String> {
        [
            "/error/message",
            "/error/status",
            "/message",
            "/detail",
            "/details",
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

    fn extract_markdown_link(text: &str, image_only: bool) -> Option<String> {
        let bytes = text.as_bytes();
        let mut index = 0usize;

        while index + 3 < bytes.len() {
            if bytes[index] == b'[' {
                let is_image = index > 0 && bytes[index - 1] == b'!';
                if image_only && !is_image {
                    index += 1;
                    continue;
                }

                if let Some(label_end_rel) = text[index..].find("](") {
                    let url_start = index + label_end_rel + 2;
                    if let Some(url_end_rel) = text[url_start..].find(')') {
                        let url = text[url_start..url_start + url_end_rel].trim();
                        if !url.is_empty()
                            && (url.starts_with("http://")
                                || url.starts_with("https://")
                                || url.starts_with("data:"))
                        {
                            return Some(url.to_string());
                        }
                    }
                }
            }

            index += 1;
        }

        None
    }

    fn extract_inline_url(text: &str) -> Option<String> {
        let markers = ["https://", "http://", "data:"];
        let start = markers
            .iter()
            .filter_map(|marker| text.find(marker))
            .min()?;
        let tail = &text[start..];
        let end = tail
            .find(|ch: char| ch.is_whitespace() || ch == ')' || ch == ']' || ch == '>' || ch == '"')
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ','].as_ref()).trim();
        if url.is_empty() {
            return None;
        }
        Some(url.to_string())
    }

    fn extract_image_source_from_text(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("data:")
        {
            return Some(trimmed.to_string());
        }

        Self::extract_markdown_link(trimmed, true)
            .or_else(|| Self::extract_markdown_link(trimmed, false))
            .or_else(|| Self::extract_inline_url(trimmed))
    }

    fn extract_first_image(payload: &Value) -> Option<String> {
        let direct_url_pointers = [
            "/data/0/url",
            "/data/data/0/url",
            "/data/data/data/0/url",
            "/choices/0/message/images/0/url",
            "/choices/0/message/image/url",
            "/choices/0/message/output/0/image_url/url",
            "/data/image_urls/0",
            "/image_urls/0",
            "/result/image_urls/0",
        ];
        if let Some(url) = direct_url_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }) {
            return Some(url);
        }

        let direct_b64_pointers = [
            "/data/0/b64_json",
            "/data/data/0/b64_json",
            "/data/data/data/0/b64_json",
            "/choices/0/message/images/0/b64_json",
            "/choices/0/message/image/b64_json",
        ];
        if let Some(data) = direct_b64_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }) {
            return Some(format!("data:image/png;base64,{}", data));
        }

        if let Some(message_content) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
        {
            if let Some(image_source) = Self::extract_image_source_from_text(message_content) {
                return Some(image_source);
            }
        }

        if let Some(content_parts) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_array)
        {
            for part in content_parts {
                if let Some(url) = part
                    .pointer("/image_url/url")
                    .or_else(|| part.pointer("/image_url"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(url.to_string());
                }
                if let Some(data) = part
                    .pointer("/b64_json")
                    .or_else(|| part.pointer("/image_base64"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(format!("data:image/png;base64,{}", data));
                }
                if let Some(text) = part
                    .pointer("/text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if let Some(image_source) = Self::extract_image_source_from_text(text) {
                        return Some(image_source);
                    }
                }
            }
        }

        None
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

    async fn send_chat_request(
        &self,
        api_key: &str,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<Value, AIError> {
        let endpoint = format!("{}{}", self.base_url, CHAT_COMPLETIONS_ENDPOINT_PATH);
        let mut content = vec![json!({
            "type": "text",
            "text": format!(
                "{}\n\nPreferred size: {}. Preferred aspect ratio: {}.",
                request.prompt.as_str(),
                request.size.as_str(),
                request.aspect_ratio.as_str()
            ),
        })];

        if let Some(reference_images) = request.reference_images.as_ref() {
            for source in reference_images {
                content.push(json!({
                    "type": "image_url",
                    "image_url": {
                        "url": Self::source_to_data_url(source).await?
                    }
                }));
            }
        }

        let body = json!({
            "model": model,
            "messages": [{
                "role": "user",
                "content": content,
            }],
            "stream": false,
            "modalities": ["text", "image"],
        });

        info!(
            "[柏拉图 AI API] Chat Completions URL: {}, model: {}, size: {}, aspect_ratio: {}, refs: {}",
            endpoint,
            model,
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
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
        let response_text = response.text().await?;
        info!("[柏拉图 AI API] Chat response status: {}", status);
        info!("[柏拉图 AI API] Chat response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "柏拉图 AI chat completions request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse 柏拉图 AI chat response: {}. Response was: {}",
                error, response_text
            ))
        })
    }

    async fn send_edit_request(
        &self,
        api_key: &str,
        request: &GenerateRequest,
        model: &str,
    ) -> Result<Value, AIError> {
        let endpoint = format!("{}{}", self.base_url, EDITS_ENDPOINT_PATH);
        let reference_images = request.reference_images.as_ref().ok_or_else(|| {
            AIError::InvalidRequest(
                "柏拉图 AI 香蕉Pro requires at least one reference image".to_string(),
            )
        })?;
        if reference_images.is_empty() {
            return Err(AIError::InvalidRequest(
                "柏拉图 AI 香蕉Pro requires at least one reference image".to_string(),
            ));
        }

        let mut form = reqwest::multipart::Form::new()
            .text("prompt", request.prompt.clone())
            .text("model", model.to_string())
            .text("response_format", "url".to_string());

        if let Some(image_size) = Self::resolve_image_size(model, &request.size) {
            form = form.text("image_size", image_size);
        }

        if !request.aspect_ratio.is_empty() && Self::validate_aspect_ratio(&request.aspect_ratio) {
            form = form.text("aspect_ratio", request.aspect_ratio.clone());
        }

        for (index, source) in reference_images.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await?;
            let extension = Self::file_extension_from_source(source);
            let part = Part::bytes(bytes)
                .file_name(format!("image_{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart image part: {}", error))
                })?;
            form = form.part("image", part);
        }

        info!(
            "[柏拉图 AI API] Image Edits URL: {}, model: {}, size: {}, aspect_ratio: {}, refs: {}",
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
        let response_text = response.text().await?;
        info!("[柏拉图 AI API] Edit response status: {}", status);
        info!("[柏拉图 AI API] Edit response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "柏拉图 AI image edits request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse 柏拉图 AI edit response: {}. Response was: {}",
                error, response_text
            ))
        })
    }

    async fn poll_task(&self, api_key: &str, task_id: &str) -> Result<Option<String>, AIError> {
        let endpoint = format!("{}{}/{}", self.base_url, TASKS_ENDPOINT_PATH, task_id);
        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[柏拉图 AI API] Task status response status: {}", status);
        info!("[柏拉图 AI API] Task status response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "柏拉图 AI task status request failed {}: {}",
                status, response_text
            )));
        }

        let payload = serde_json::from_str::<Value>(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse 柏拉图 AI task status response: {}. Response was: {}",
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
                        "柏拉图 AI task completed but response did not include image data"
                            .to_string(),
                    ));
                }
                "FAILURE" | "FAILED" | "ERROR" | "CANCELLED" => {
                    let message = Self::extract_error_message(&payload)
                        .unwrap_or_else(|| format!("柏拉图 AI task failed with status {}", task_status));
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

    async fn wait_for_task(&self, api_key: &str, task_id: &str) -> Result<String, AIError> {
        for _ in 0..MAX_POLL_RETRIES {
            match self.poll_task(api_key, task_id).await? {
                Some(image) => return Ok(image),
                None => sleep(Duration::from_millis(POLL_INTERVAL_MS)).await,
            }
        }

        Err(AIError::Provider(format!(
            "柏拉图 AI task timed out after {} retries",
            MAX_POLL_RETRIES
        )))
    }
}

impl Default for BltcyProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for BltcyProvider {
    fn name(&self) -> &str {
        "bltcy"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("bltcy/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "bltcy/nano-banana-2-4k".to_string(),
            "bltcy/gemini-3.1-flash-image-preview-4k".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;
        let model = Self::sanitize_model(&request.model);

        info!(
            "[柏拉图 AI Request] model: {}, size: {}, aspect_ratio: {}, refs: {}",
            model,
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
        );

        let payload = if Self::is_gemini_preview_model(&model) {
            self.send_chat_request(&api_key, &request, &model).await?
        } else {
            self.send_edit_request(&api_key, &request, &model).await?
        };

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        if let Some(image_source) = Self::extract_first_image(&payload) {
            return Ok(image_source);
        }

        if let Some(task_id) = Self::extract_task_id(&payload) {
            return self.wait_for_task(&api_key, &task_id).await;
        }

        Err(AIError::Provider(format!(
            "柏拉图 AI response did not include image data: {}",
            payload
        )))
    }
}
