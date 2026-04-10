use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageFormat;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const STORYBOARD_MODEL_ID: &str = "newapi/storyboard-experimental";

#[derive(Debug, Clone, Deserialize)]
struct NewApiConfigPayload {
    #[serde(default)]
    api_format: String,
    endpoint_url: String,
    request_model: String,
    #[serde(default)]
    display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NewApiFormat {
    GeminiGenerateContent,
    OpenAiChat,
    OpenAiEdits,
}

#[derive(Debug, Clone)]
struct NewApiConfig {
    api_format: NewApiFormat,
    endpoint_url: String,
    request_model: String,
    display_name: String,
}

pub struct NewApiProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl NewApiProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn parse_api_format(input: &str) -> Result<NewApiFormat, AIError> {
        match input.trim() {
            "" => Ok(NewApiFormat::GeminiGenerateContent),
            "gemini-generate-content" => Ok(NewApiFormat::GeminiGenerateContent),
            "openai-chat" => Ok(NewApiFormat::OpenAiChat),
            "openai-edits" => Ok(NewApiFormat::OpenAiEdits),
            other => Err(AIError::InvalidRequest(format!(
                "Unsupported NewAPI format: {}",
                other
            ))),
        }
    }

    async fn get_api_key(&self) -> Result<String, AIError> {
        self.api_key
            .read()
            .await
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))
    }

    fn extract_config(request: &GenerateRequest) -> Result<NewApiConfig, AIError> {
        let raw_value = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config"))
            .cloned()
            .ok_or_else(|| {
                AIError::InvalidRequest("Missing newapi_config in request extra_params".to_string())
            })?;
        let payload: NewApiConfigPayload = serde_json::from_value(raw_value)?;
        let endpoint_url = payload.endpoint_url.trim().to_string();
        let request_model = payload.request_model.trim().to_string();
        if endpoint_url.is_empty() {
            return Err(AIError::InvalidRequest(
                "NewAPI endpoint URL is required".to_string(),
            ));
        }
        if request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "NewAPI request model is required".to_string(),
            ));
        }

        Ok(NewApiConfig {
            api_format: Self::parse_api_format(&payload.api_format)?,
            endpoint_url,
            request_model,
            display_name: payload.display_name.trim().to_string(),
        })
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
        Ok(std::fs::read(path)?)
    }

    async fn source_to_png_bytes(source: &str) -> Result<Vec<u8>, AIError> {
        let original_bytes = Self::source_to_bytes(source).await?;
        let image = image::load_from_memory(&original_bytes).map_err(|error| {
            AIError::InvalidRequest(format!(
                "Failed to decode reference image for NewAPI generateContent: {}",
                error
            ))
        })?;
        let mut buffer = Cursor::new(Vec::new());
        image
            .write_to(&mut buffer, ImageFormat::Png)
            .map_err(|error| {
                AIError::Provider(format!(
                    "Failed to re-encode reference image as PNG for NewAPI generateContent: {}",
                    error
                ))
            })?;
        Ok(buffer.into_inner())
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

    fn resolve_endpoint(endpoint_url: &str, request_model: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/images/generations"))
            .or_else(|| trimmed.strip_suffix("/images/edits"))
            .unwrap_or(trimmed)
            .trim_end_matches('/');
        if trimmed.ends_with(":generateContent") {
            return trimmed.to_string();
        }
        if trimmed.contains("/models/") {
            return format!("{}:generateContent", trimmed);
        }
        if trimmed.ends_with("/v1") || trimmed.ends_with("/v1beta") {
            return format!("{}/models/{}:generateContent", trimmed, request_model);
        }
        format!(
            "{}/v1beta/models/{}:generateContent",
            trimmed, request_model
        )
    }

    fn resolve_openai_endpoint(endpoint_url: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            return trimmed.to_string();
        }
        if trimmed.ends_with("/v1") {
            return format!("{}/chat/completions", trimmed);
        }
        format!("{}/v1/chat/completions", trimmed)
    }

    fn resolve_openai_edits_endpoint(endpoint_url: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        if trimmed.ends_with("/images/edits") {
            return trimmed.to_string();
        }
        if trimmed.ends_with("/v1") {
            return format!("{}/images/edits", trimmed);
        }
        format!("{}/v1/images/edits", trimmed)
    }

    fn resolve_gemini_image_size(request_model: &str, size: &str) -> Option<&'static str> {
        let lower_model = request_model.trim().to_ascii_lowercase();
        let supports_image_size = lower_model.contains("3.") || lower_model.contains("preview");
        if !supports_image_size {
            return None;
        }

        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1K"),
            "2K" => Some("2K"),
            "4K" => Some("4K"),
            _ => None,
        }
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

    fn resolve_openai_size(size: &str, aspect_ratio: &str) -> Option<String> {
        let normalized_size = size.trim().to_ascii_uppercase();
        let ratio = Self::parse_aspect_ratio(aspect_ratio).unwrap_or(1.0);
        let is_square = (ratio - 1.0).abs() < 0.12;

        let resolved = match normalized_size.as_str() {
            "1K" => {
                if is_square {
                    "1024x1024"
                } else if ratio > 1.0 {
                    "1536x1024"
                } else {
                    "1024x1536"
                }
            }
            "2K" => {
                if is_square {
                    "2048x2048"
                } else if ratio > 1.0 {
                    "2304x1536"
                } else {
                    "1536x2304"
                }
            }
            "4K" => {
                if is_square {
                    "4096x4096"
                } else if ratio > 1.0 {
                    "3072x2048"
                } else {
                    "2048x3072"
                }
            }
            _ => return None,
        };

        Some(resolved.to_string())
    }

    fn build_prompt_text(request: &GenerateRequest) -> String {
        let mut lines = vec![request.prompt.trim().to_string()];

        if !request.size.trim().is_empty() {
            lines.push(format!("Preferred size: {}.", request.size.trim()));
        }

        if !request.aspect_ratio.trim().is_empty() {
            lines.push(format!(
                "Preferred aspect ratio: {}.",
                request.aspect_ratio.trim()
            ));
        }

        lines
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect::<Vec<String>>()
            .join("\n\n")
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

    fn is_unexpected_end_json_error(message: &str) -> bool {
        message
            .trim()
            .to_ascii_lowercase()
            .contains("unexpected end of json input")
    }

    fn should_retry_openai_chat_with_generate_content(
        request: &GenerateRequest,
        config: &NewApiConfig,
    ) -> bool {
        let normalized_model = config.request_model.trim().to_ascii_lowercase();
        let has_reference_images = request
            .reference_images
            .as_ref()
            .map(|images| !images.is_empty())
            .unwrap_or(false);

        normalized_model.contains("gemini")
            && (has_reference_images
                || !request.size.trim().is_empty()
                || !request.aspect_ratio.trim().is_empty())
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
            "/choices/0/message/images/0/url",
            "/choices/0/message/image/url",
            "/choices/0/message/output/0/image_url/url",
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

        if let Some(parts) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            for part in parts {
                if let Some(uri) = part
                    .pointer("/fileData/fileUri")
                    .or_else(|| part.pointer("/file_data/file_uri"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(uri.to_string());
                }

                if let Some(data) = part
                    .pointer("/inlineData/data")
                    .or_else(|| part.pointer("/inline_data/data"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    let mime_type = part
                        .pointer("/inlineData/mimeType")
                        .or_else(|| part.pointer("/inline_data/mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image/png");
                    return Some(format!("data:{};base64,{}", mime_type, data));
                }
            }
        }

        None
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

        if let Some(parts) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            let text_parts = parts
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
            "/output_text",
            "/output/text",
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

    async fn send_json_request(
        &self,
        endpoint: &str,
        api_key: &str,
        body: Value,
    ) -> Result<Value, AIError> {
        let payload = serde_json::to_vec(&body).map_err(|error| {
            AIError::Provider(format!("Failed to serialize NewAPI request body: {}", error))
        })?;
        let response = self
            .client
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("X-API-Key", api_key)
            .header("Content-Type", "application/json")
            .body(payload)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[NewAPI] {} -> {}", endpoint, status);
        info!("[NewAPI] response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "NewAPI request failed {}: {}",
                status, response_text
            )));
        }

        Ok(serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse NewAPI response: {}. Response was: {}",
                error, response_text
            ))
        })?)
    }

    async fn send_multipart_request(
        &self,
        endpoint: &str,
        api_key: &str,
        form: Form,
    ) -> Result<Value, AIError> {
        let response = self
            .client
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("X-API-Key", api_key)
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[NewAPI] {} -> {}", endpoint, status);
        info!("[NewAPI] response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "NewAPI request failed {}: {}",
                status, response_text
            )));
        }

        Ok(serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse NewAPI response: {}. Response was: {}",
                error, response_text
            ))
        })?)
    }

    async fn run_generate_content(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let request_model = config.request_model.trim().to_string();
        let endpoint = Self::resolve_endpoint(&config.endpoint_url, &request_model);
        let mut parts = vec![json!({
            "text": request.prompt.clone(),
        })];

        if let Some(reference_images) = request.reference_images.as_ref() {
            for source in reference_images {
                let bytes = Self::source_to_png_bytes(source).await?;
                parts.push(json!({
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": STANDARD.encode(bytes),
                    }
                }));
            }
        }

        let mut image_config = json!({});
        if !request.aspect_ratio.trim().is_empty() {
            image_config["aspectRatio"] = Value::String(request.aspect_ratio.clone());
        }
        if let Some(image_size) = Self::resolve_gemini_image_size(&request_model, &request.size) {
            image_config["imageSize"] = Value::String(image_size.to_string());
        }

        let body = json!({
            "contents": [{
                "role": "user",
                "parts": parts,
            }],
            "generationConfig": {
                "topP": 0.95,
                "responseModalities": ["IMAGE"],
                "imageConfig": image_config,
            }
        });
        self.send_json_request(&endpoint, api_key, body).await
    }

    async fn run_openai_chat(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let request_model = config.request_model.trim().to_string();
        let endpoint = Self::resolve_openai_endpoint(&config.endpoint_url);
        let prompt_text = Self::build_prompt_text(request);

        let mut message_content = vec![json!({
            "type": "text",
            "text": prompt_text,
        })];

        if let Some(reference_images) = request.reference_images.as_ref() {
            for source in reference_images {
                let data_url = Self::source_to_data_url(source).await?;
                message_content.push(json!({
                    "type": "image_url",
                    "image_url": {
                        "url": data_url,
                    }
                }));
            }
        }

        let body = json!({
            "model": request_model,
            "messages": [{
                "role": "user",
                "content": message_content,
            }],
            "stream": false,
        });

        self.send_json_request(&endpoint, api_key, body).await
    }

    async fn run_openai_edits(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_edits_endpoint(&config.endpoint_url);
        let request_model = config.request_model.trim().to_string();
        let sources = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
            .ok_or_else(|| {
                AIError::InvalidRequest("OpenAI 编辑接口至少需要一张参考图".to_string())
            })?;

        let mut form = Form::new()
            .text("model", request_model)
            .text("prompt", request.prompt.clone())
            .text("response_format", "url".to_string());

        for (index, source) in sources.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await?;
            let extension = Self::file_extension_from_source(source);
            let image_part = Part::bytes(bytes)
                .file_name(format!("image-{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart image part: {}", error))
                })?;

            let field_name = if sources.len() > 1 { "image[]" } else { "image" };
            form = form.part(field_name.to_string(), image_part);
        }

        if let Some(size) = Self::resolve_openai_size(&request.size, &request.aspect_ratio) {
            form = form.text("size", size);
        }

        self.send_multipart_request(&endpoint, api_key, form).await
    }
}

impl Default for NewApiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for NewApiProvider {
    fn name(&self) -> &str {
        "newapi"
    }

    fn supports_model(&self, model: &str) -> bool {
        model.starts_with("newapi/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![STORYBOARD_MODEL_ID.to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self.get_api_key().await?;
        let config = Self::extract_config(&request)?;
        info!(
            "[NewAPI Request] display_name: {}, format: {:?}, endpoint: {}, request_model: {}, refs: {}",
            config.display_name,
            config.api_format,
            config.endpoint_url,
            config.request_model,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
        );

        let payload = match config.api_format {
            NewApiFormat::GeminiGenerateContent => {
                self.run_generate_content(&request, &config, &api_key).await?
            }
            NewApiFormat::OpenAiChat => {
                match self.run_openai_chat(&request, &config, &api_key).await {
                    Ok(payload)
                        if Self::extract_error_message(&payload)
                            .map(|message| Self::is_unexpected_end_json_error(&message))
                            .unwrap_or(false)
                            && Self::should_retry_openai_chat_with_generate_content(
                                &request, &config
                            ) =>
                    {
                        info!(
                            "[NewAPI] openai-chat returned unexpected-end JSON error, retrying with Gemini generateContent"
                        );
                        self.run_generate_content(&request, &config, &api_key).await?
                    }
                    Err(AIError::Provider(message))
                        if Self::is_unexpected_end_json_error(&message)
                            && Self::should_retry_openai_chat_with_generate_content(
                                &request, &config
                            ) =>
                    {
                        info!(
                            "[NewAPI] openai-chat provider error matched unexpected-end JSON error, retrying with Gemini generateContent"
                        );
                        self.run_generate_content(&request, &config, &api_key).await?
                    }
                    Ok(payload) => payload,
                    Err(error) => return Err(error),
                }
            }
            NewApiFormat::OpenAiEdits => self.run_openai_edits(&request, &config, &api_key).await?,
        };

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        if let Some(image_source) = Self::extract_first_image(&payload) {
            return Ok(image_source);
        }

        if let Some(text) = Self::extract_text(&payload) {
            return Ok(text);
        }

        Err(AIError::Provider(format!(
            "NewAPI response did not include image or text data: {}",
            payload
        )))
    }
}
