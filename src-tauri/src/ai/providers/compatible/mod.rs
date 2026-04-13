use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const STORYBOARD_MODEL_ID: &str = "compatible/storyboard-experimental";

#[derive(Debug, Clone, Deserialize)]
struct CompatibleConfigPayload {
    api_format: String,
    endpoint_url: String,
    request_model: String,
    #[serde(default)]
    display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompatibleApiFormat {
    OpenAiGenerations,
    OpenAiEdits,
    OpenAiChat,
    GeminiGenerateContent,
}

#[derive(Debug, Clone)]
struct CompatibleConfig {
    api_format: CompatibleApiFormat,
    endpoint_url: String,
    request_model: String,
    display_name: String,
}

pub struct CompatibleProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl CompatibleApiFormat {
    fn parse(input: &str) -> Result<Self, AIError> {
        match input.trim() {
            "openai-generations" => Ok(Self::OpenAiGenerations),
            "openai-edits" => Ok(Self::OpenAiEdits),
            "openai-chat" => Ok(Self::OpenAiChat),
            "gemini-generate-content" => Ok(Self::GeminiGenerateContent),
            other => Err(AIError::InvalidRequest(format!(
                "Unsupported compatible API format: {}",
                other
            ))),
        }
    }
}

impl CompatibleProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
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

    fn extract_config(request: &GenerateRequest) -> Result<CompatibleConfig, AIError> {
        let raw_value = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .cloned()
            .ok_or_else(|| {
                AIError::InvalidRequest(
                    "Missing compatible_config in request extra_params".to_string(),
                )
            })?;
        let payload: CompatibleConfigPayload = serde_json::from_value(raw_value)?;
        let endpoint_url = payload.endpoint_url.trim().to_string();
        let request_model = payload.request_model.trim().to_string();
        if endpoint_url.is_empty() {
            return Err(AIError::InvalidRequest(
                "Compatible endpoint URL is required".to_string(),
            ));
        }
        if request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "Compatible request model is required".to_string(),
            ));
        }

        Ok(CompatibleConfig {
            api_format: CompatibleApiFormat::parse(&payload.api_format)?,
            endpoint_url,
            request_model,
            display_name: payload.display_name.trim().to_string(),
        })
    }

    fn sanitize_model(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn openai_generations_requires_reference_image(request_model: &str) -> bool {
        let normalized = Self::sanitize_model(request_model).to_ascii_lowercase();
        normalized.contains("flux-kontext-dev")
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

    fn resolve_chat_size(size: &str) -> Option<&'static str> {
        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1k"),
            "2K" => Some("2k"),
            "4K" => Some("4k"),
            _ => None,
        }
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

    fn resolve_openai_endpoint(endpoint_url: &str, mode: CompatibleApiFormat) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let path = match mode {
            CompatibleApiFormat::OpenAiGenerations => "/images/generations",
            CompatibleApiFormat::OpenAiEdits => "/images/edits",
            CompatibleApiFormat::OpenAiChat => "/chat/completions",
            CompatibleApiFormat::GeminiGenerateContent => "",
        };

        if trimmed.ends_with(path) {
            return trimmed.to_string();
        }
        if trimmed.ends_with("/v1") {
            return format!("{}{}", trimmed, path);
        }
        format!("{}/v1{}", trimmed, path)
    }

    fn resolve_gemini_endpoint(endpoint_url: &str, request_model: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
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

    fn resolve_gemini_image_size(request_model: &str, size: &str) -> Option<&'static str> {
        let lower_model = request_model.trim().to_ascii_lowercase();
        let supports_image_size = lower_model.contains("nano-banana-pro")
            || lower_model.contains("3.")
            || lower_model.contains("preview");
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
        api_format: CompatibleApiFormat,
    ) -> Result<Value, AIError> {
        let mut request = self.client.post(endpoint);
        request = match api_format {
            CompatibleApiFormat::GeminiGenerateContent => request.header("x-goog-api-key", api_key),
            _ => request.header("Authorization", format!("Bearer {}", api_key)),
        };

        let response = request
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[Compatible API] {} -> {}", endpoint, status);
        info!("[Compatible API] response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Compatible API request failed {}: {}",
                status, response_text
            )));
        }

        Ok(serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse compatible response: {}. Response was: {}",
                error, response_text
            ))
        })?)
    }

    async fn send_openai_edits_request(
        &self,
        endpoint: &str,
        api_key: &str,
        request: &GenerateRequest,
        request_model: &str,
    ) -> Result<Value, AIError> {
        let size = Self::resolve_openai_size(&request.size, &request.aspect_ratio);
        let mut form = Form::new()
            .text("model", request_model.to_string())
            .text("prompt", request.prompt.clone())
            .text("response_format", "url".to_string());
        if let Some(size) = size {
            form = form.text("size", size);
        }
        if let Some(image_size) =
            Self::resolve_gemini_image_size(request_model, &request.size)
        {
            form = form.text("image_size", image_size.to_string());
            if !request.aspect_ratio.trim().is_empty() {
                form = form.text("aspect_ratio", request.aspect_ratio.trim().to_string());
            }
        }

        let reference_images = request.reference_images.as_ref().ok_or_else(|| {
            AIError::InvalidRequest(
                "OpenAI Edits mode requires at least one reference image".to_string(),
            )
        })?;
        for (index, source) in reference_images.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await?;
            let extension = Self::file_extension_from_source(source);
            let part = Part::bytes(bytes)
                .file_name(format!("image_{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart image part: {}", error))
                })?;
            form = form.part("image[]", part);
        }

        let response = self
            .client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[Compatible API] {} -> {}", endpoint, status);
        info!("[Compatible API] response: {}", response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Compatible API request failed {}: {}",
                status, response_text
            )));
        }

        Ok(serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse compatible response: {}. Response was: {}",
                error, response_text
            ))
        })?)
    }

    async fn run_openai_generations(
        &self,
        request: &GenerateRequest,
        config: &CompatibleConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_endpoint(
            &config.endpoint_url,
            CompatibleApiFormat::OpenAiGenerations,
        );
        let size = Self::resolve_openai_size(&request.size, &request.aspect_ratio);
        if Self::openai_generations_requires_reference_image(&config.request_model)
            && request
                .reference_images
                .as_ref()
                .map(|images| images.is_empty())
                .unwrap_or(true)
        {
            return Err(AIError::InvalidRequest(
                "This compatible model requires at least one reference image".to_string(),
            ));
        }
        let image_inputs = match request.reference_images.as_ref() {
            Some(images) if !images.is_empty() => {
                let mut normalized = Vec::with_capacity(images.len());
                for source in images {
                    normalized.push(Self::source_to_data_url(source).await?);
                }
                Some(normalized)
            }
            _ => None,
        };

        let mut body = json!({
            "model": Self::sanitize_model(&config.request_model),
            "prompt": request.prompt.clone(),
            "response_format": "url",
        });
        if let Some(size) = size {
            body["size"] = Value::String(size);
        }
        if let Some(image_size) =
            Self::resolve_gemini_image_size(&config.request_model, &request.size)
        {
            body["image_size"] = Value::String(image_size.to_string());
            if !request.aspect_ratio.trim().is_empty() {
                body["aspect_ratio"] = Value::String(request.aspect_ratio.trim().to_string());
            }
        }
        if let Some(image_inputs) = image_inputs {
            body["image"] = if image_inputs.len() == 1 {
                Value::String(image_inputs[0].clone())
            } else {
                Value::Array(
                    image_inputs
                        .into_iter()
                        .map(Value::String)
                        .collect::<Vec<Value>>(),
                )
            };
        }
        self.send_json_request(
            &endpoint,
            api_key,
            body,
            CompatibleApiFormat::OpenAiGenerations,
        )
        .await
    }

    async fn run_openai_edits(
        &self,
        request: &GenerateRequest,
        config: &CompatibleConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint =
            Self::resolve_openai_endpoint(&config.endpoint_url, CompatibleApiFormat::OpenAiEdits);
        self.send_openai_edits_request(
            &endpoint,
            api_key,
            request,
            &Self::sanitize_model(&config.request_model),
        )
        .await
    }

    async fn run_openai_chat(
        &self,
        request: &GenerateRequest,
        config: &CompatibleConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint =
            Self::resolve_openai_endpoint(&config.endpoint_url, CompatibleApiFormat::OpenAiChat);
        let mut content = vec![json!({
            "type": "text",
            "text": Self::build_prompt_text(request),
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

        let mut body = json!({
            "model": Self::sanitize_model(&config.request_model),
            "messages": [{
                "role": "user",
                "content": content
            }],
            "stream": false,
            "modalities": ["text", "image"],
        });
        if let Some(size) = Self::resolve_chat_size(&request.size) {
            body["size"] = Value::String(size.to_string());
        }
        if let Some(image_size) =
            Self::resolve_gemini_image_size(&config.request_model, &request.size)
        {
            body["image_size"] = Value::String(image_size.to_string());
            if !request.aspect_ratio.trim().is_empty() {
                body["aspect_ratio"] = Value::String(request.aspect_ratio.trim().to_string());
            }
        }
        self.send_json_request(&endpoint, api_key, body, CompatibleApiFormat::OpenAiChat)
            .await
    }

    async fn run_gemini_generate_content(
        &self,
        request: &GenerateRequest,
        config: &CompatibleConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let request_model = Self::sanitize_model(&config.request_model);
        let endpoint = Self::resolve_gemini_endpoint(&config.endpoint_url, &request_model);
        let mut parts = vec![json!({
            "text": request.prompt.clone(),
        })];

        if let Some(reference_images) = request.reference_images.as_ref() {
            for source in reference_images {
                let bytes = Self::source_to_bytes(source).await?;
                let extension = Self::file_extension_from_source(source);
                let mime_type = Self::mime_type_from_extension(extension);
                parts.push(json!({
                    "inlineData": {
                        "mimeType": mime_type,
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
                "responseModalities": ["IMAGE"],
                "imageConfig": image_config,
            }
        });
        self.send_json_request(
            &endpoint,
            api_key,
            body,
            CompatibleApiFormat::GeminiGenerateContent,
        )
        .await
    }
}

impl Default for CompatibleProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for CompatibleProvider {
    fn name(&self) -> &str {
        "compatible"
    }

    fn supports_model(&self, model: &str) -> bool {
        model.starts_with("compatible/")
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
            "[Compatible Request] display_name: {}, format: {:?}, endpoint: {}, request_model: {}, refs: {}",
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
            CompatibleApiFormat::OpenAiGenerations => {
                self.run_openai_generations(&request, &config, &api_key)
                    .await?
            }
            CompatibleApiFormat::OpenAiEdits => {
                self.run_openai_edits(&request, &config, &api_key).await?
            }
            CompatibleApiFormat::OpenAiChat => {
                self.run_openai_chat(&request, &config, &api_key).await?
            }
            CompatibleApiFormat::GeminiGenerateContent => {
                self.run_gemini_generate_content(&request, &config, &api_key)
                    .await?
            }
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
            "Compatible API response did not include image or text data: {}",
            payload
        )))
    }
}
