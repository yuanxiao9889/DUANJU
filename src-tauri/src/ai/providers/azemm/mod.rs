use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde_json::{json, Value};
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::process::Command as TokioCommand;
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://api.azemm.top";
const CHAT_COMPLETIONS_ENDPOINT_PATH: &str = "/v1/chat/completions";
const BANANA_CLIENT_HEADER_VALUE: &str = "comfyui-banana-li";
const CHAT_COMPLETIONS_GEMINI_PREFIX: &str = "google/";
const GEMINI_PRO_IMAGE_PREVIEW_MODEL: &str = "gemini-3-pro-image-preview";
const GEMINI_FLASH_IMAGE_PREVIEW_MODEL: &str = "gemini-3.1-flash-image-preview";
const CURL_JSON_TRANSPORT_MIN_BYTES: usize = 64 * 1024;
const CURL_JSON_TRANSPORT_TIMEOUT_SECONDS: u64 = 240;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SUPPORTED_MODELS: [&str; 2] = [
    GEMINI_PRO_IMAGE_PREVIEW_MODEL,
    GEMINI_FLASH_IMAGE_PREVIEW_MODEL,
];
pub struct AzemmProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl AzemmProvider {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .http1_only()
                .build()
                .unwrap_or_else(|_| Client::new()),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
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

    fn sanitize_model(model: &str) -> String {
        model
            .trim()
            .strip_prefix("azemm/")
            .unwrap_or(model.trim())
            .to_string()
    }

    fn resolve_chat_model(model: &str) -> String {
        let sanitized = Self::sanitize_model(model);
        match sanitized.as_str() {
            GEMINI_PRO_IMAGE_PREVIEW_MODEL | GEMINI_FLASH_IMAGE_PREVIEW_MODEL => {
                format!("{}{}", CHAT_COMPLETIONS_GEMINI_PREFIX, sanitized)
            }
            _ => sanitized,
        }
    }

    fn is_pro_image_preview_model(model: &str) -> bool {
        Self::sanitize_model(model).eq_ignore_ascii_case(GEMINI_PRO_IMAGE_PREVIEW_MODEL)
    }

    fn wrap_selected_model_error(request: &GenerateRequest, error: AIError) -> AIError {
        if Self::has_image_intent(request) && Self::is_pro_image_preview_model(&request.model) {
            return AIError::Provider(format!(
                "Azemm could not complete the request with the selected model '{}' and did not auto-switch models. Original error: {}",
                Self::sanitize_model(&request.model),
                error
            ));
        }

        error
    }

    fn should_use_generate_content_for_model(model: &str) -> bool {
        let normalized = Self::sanitize_model(model);
        normalized.eq_ignore_ascii_case(GEMINI_FLASH_IMAGE_PREVIEW_MODEL)
            || normalized.eq_ignore_ascii_case(GEMINI_PRO_IMAGE_PREVIEW_MODEL)
    }

    fn has_image_intent(request: &GenerateRequest) -> bool {
        !request.size.trim().is_empty()
            || !request.aspect_ratio.trim().is_empty()
            || request
                .reference_images
                .as_ref()
                .map(|images| !images.is_empty())
                .unwrap_or(false)
    }

    fn resolve_chat_size(size: &str) -> Option<&'static str> {
        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1k"),
            "2K" => Some("2k"),
            "4K" => Some("4k"),
            _ => None,
        }
    }

    fn resolve_gemini_image_size(size: &str) -> Option<&'static str> {
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

    fn build_generate_content_prompt(
        request: &GenerateRequest,
        include_preferences: bool,
    ) -> String {
        if include_preferences {
            return Self::build_prompt_text(request);
        }

        request.prompt.trim().to_string()
    }

    fn build_chat_extra_body(
        request: &GenerateRequest,
        include_aspect_ratio: bool,
        include_image_size: bool,
    ) -> Option<Value> {
        let mut image_config = serde_json::Map::new();
        if include_aspect_ratio && !request.aspect_ratio.trim().is_empty() {
            image_config.insert(
                "aspect_ratio".to_string(),
                Value::String(request.aspect_ratio.trim().to_string()),
            );
        }
        if include_image_size {
            if let Some(image_size) = Self::resolve_gemini_image_size(&request.size) {
                image_config.insert(
                    "image_size".to_string(),
                    Value::String(image_size.to_string()),
                );
            }
        }

        if image_config.is_empty() {
            return None;
        }

        Some(json!({
            "google": {
                "image_config": Value::Object(image_config),
            }
        }))
    }

    fn resolve_gemini_endpoint(&self, request_model: &str) -> String {
        let trimmed = self.base_url.trim().trim_end_matches('/');
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

    fn is_retryable_json_decode_error(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        normalized.contains("unexpected end of json input")
            || normalized.contains("eof while parsing")
            || normalized.contains("unterminated string")
            || normalized.contains("json decode error")
            || normalized.contains("json_invalid")
            || normalized.contains("failed to parse azemm generatecontent response")
    }

    fn should_retry_generate_content_payload(payload: &Value) -> bool {
        Self::extract_error_message(payload)
            .map(|message| Self::is_retryable_json_decode_error(&message))
            .unwrap_or(false)
    }

    fn should_use_curl_json_transport(request_kind: &str, payload_len: usize) -> bool {
        payload_len >= CURL_JSON_TRANSPORT_MIN_BYTES
            && (request_kind.starts_with("chat-") || request_kind.starts_with("generateContent"))
    }

    fn should_continue_chat_completion_attempt(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        Self::is_retryable_json_decode_error(message)
            || (normalized.contains("modalities") && normalized.contains("unsupported"))
            || (normalized.contains("image_url") && normalized.contains("invalid"))
            || (normalized.contains("invalid") && normalized.contains("image"))
            || (normalized.contains("extra_body") && normalized.contains("invalid"))
            || (normalized.contains("aspect_ratio") && normalized.contains("invalid"))
            || (normalized.contains("image_size") && normalized.contains("invalid"))
    }

    fn should_retry_chat_completion_payload(payload: &Value) -> bool {
        Self::extract_error_message(payload)
            .map(|message| Self::should_continue_chat_completion_attempt(&message))
            .unwrap_or(false)
    }

    async fn build_generate_content_body(
        &self,
        request: &GenerateRequest,
        include_aspect_ratio: bool,
        include_prompt_preferences: bool,
        include_image_size: bool,
    ) -> Result<Value, AIError> {
        let mut parts = vec![json!({
            "text": Self::build_generate_content_prompt(request, include_prompt_preferences),
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

        let mut image_config = serde_json::Map::new();
        if include_aspect_ratio && !request.aspect_ratio.trim().is_empty() {
            image_config.insert(
                "aspectRatio".to_string(),
                Value::String(request.aspect_ratio.clone()),
            );
        }
        if include_image_size {
            if let Some(image_size) = Self::resolve_gemini_image_size(&request.size) {
                image_config.insert(
                    "imageSize".to_string(),
                    Value::String(image_size.to_string()),
                );
            }
        }

        let mut generation_config = serde_json::Map::new();
        generation_config.insert("responseModalities".to_string(), json!(["IMAGE"]));
        if !image_config.is_empty() {
            generation_config.insert("imageConfig".to_string(), Value::Object(image_config));
        }

        Ok(json!({
            "contents": [{
                "role": "user",
                "parts": parts,
            }],
            "generationConfig": Value::Object(generation_config),
        }))
    }

    async fn send_json_request(
        &self,
        endpoint: &str,
        api_key: &str,
        body: Value,
        request_kind: &str,
    ) -> Result<Value, AIError> {
        let request_body = serde_json::to_vec(&body).map_err(|error| {
            AIError::Provider(format!(
                "Failed to serialize Azemm {} request body: {}",
                request_kind, error
            ))
        })?;

        info!(
            "[Azemm] {} request body bytes: {}",
            request_kind,
            request_body.len()
        );

        if Self::should_use_curl_json_transport(request_kind, request_body.len()) {
            match Self::send_json_request_with_curl(
                endpoint.to_string(),
                api_key.to_string(),
                request_body.clone(),
                request_kind.to_string(),
            )
            .await
            {
                Ok((status, response_text)) => {
                    info!("[Azemm] {} {} -> {} (curl)", request_kind, endpoint, status);
                    info!(
                        "[Azemm] {} response (curl): {}",
                        request_kind, response_text
                    );

                    let payload =
                        serde_json::from_str::<Value>(&response_text).map_err(|error| {
                            AIError::Provider(format!(
                                "Failed to parse Azemm {} curl response: {}. Response was: {}",
                                request_kind, error, response_text
                            ))
                        })?;

                    if !status.is_success() {
                        if let Some(message) = Self::extract_error_message(&payload) {
                            return Err(AIError::Provider(message));
                        }
                        return Err(AIError::Provider(format!(
                            "Azemm {} curl request failed {}: {}",
                            request_kind, status, response_text
                        )));
                    }

                    return Ok(payload);
                }
                Err(error) => {
                    info!(
                        "[Azemm] {} curl transport unavailable, falling back to reqwest: {}",
                        request_kind, error
                    );
                }
            }
        }

        let response = self
            .client
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("X-API-Key", api_key)
            .header("X-Banana-Client", BANANA_CLIENT_HEADER_VALUE)
            .header("Content-Type", "application/json")
            .body(request_body)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[Azemm] {} -> {}", endpoint, status);
        info!("[Azemm] {} response: {}", request_kind, response_text);

        let payload = serde_json::from_str::<Value>(&response_text);

        if !status.is_success() {
            if let Ok(payload) = &payload {
                if let Some(message) = Self::extract_error_message(payload) {
                    return Err(AIError::Provider(message));
                }
            }

            return Err(AIError::Provider(format!(
                "Azemm {} request failed {}: {}",
                request_kind, status, response_text
            )));
        }

        payload.map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Azemm {} response: {}. Response was: {}",
                request_kind, error, response_text
            ))
        })
    }

    async fn send_json_request_with_curl(
        endpoint: String,
        api_key: String,
        payload: Vec<u8>,
        request_kind: String,
    ) -> Result<(reqwest::StatusCode, String), AIError> {
        let request_kind_for_join = request_kind.clone();
        tokio::task::spawn_blocking(move || {
            let request_file_path = std::env::temp_dir()
                .join(format!("storyboard-azemm-request-{}.json", Uuid::new_v4()));
            let response_file_path = std::env::temp_dir()
                .join(format!("storyboard-azemm-response-{}.txt", Uuid::new_v4()));

            let result = (|| {
                fs::write(&request_file_path, &payload).map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to persist Azemm {} curl payload: {}",
                        request_kind, error
                    ))
                })?;

                let curl_binary = if cfg!(target_os = "windows") {
                    "curl.exe"
                } else {
                    "curl"
                };
                let mut command = Command::new(curl_binary);
                #[cfg(target_os = "windows")]
                command.creation_flags(CREATE_NO_WINDOW);
                let output = command
                    .arg("-sS")
                    .arg("--http1.1")
                    .arg("--connect-timeout")
                    .arg("30")
                    .arg("--max-time")
                    .arg(CURL_JSON_TRANSPORT_TIMEOUT_SECONDS.to_string())
                    .arg("-X")
                    .arg("POST")
                    .arg(&endpoint)
                    .arg("-H")
                    .arg(format!("Authorization: Bearer {}", api_key))
                    .arg("-H")
                    .arg(format!("X-API-Key: {}", api_key))
                    .arg("-H")
                    .arg(format!("X-Banana-Client: {}", BANANA_CLIENT_HEADER_VALUE))
                    .arg("-H")
                    .arg("Accept: application/json")
                    .arg("-H")
                    .arg("Content-Type: application/json")
                    .arg("--data-binary")
                    .arg(format!("@{}", request_file_path.display()))
                    .arg("-o")
                    .arg(&response_file_path)
                    .arg("-w")
                    .arg("%{http_code}")
                    .output()
                    .map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to execute curl for Azemm {} request: {}",
                            request_kind, error
                        ))
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(AIError::Provider(format!(
                        "curl transport failed for Azemm {} request: {}",
                        request_kind,
                        if stderr.is_empty() {
                            format!("exit status {}", output.status)
                        } else {
                            stderr
                        }
                    )));
                }

                let status_code = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<u16>()
                    .map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to parse curl HTTP status for Azemm {} request: {}",
                            request_kind, error
                        ))
                    })?;
                let response_bytes = fs::read(&response_file_path).map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to read curl response for Azemm {} request: {}",
                        request_kind, error
                    ))
                })?;
                let response_text = String::from_utf8_lossy(&response_bytes).into_owned();
                let status = reqwest::StatusCode::from_u16(status_code).map_err(|error| {
                    AIError::Provider(format!(
                        "Invalid curl HTTP status for Azemm {} request: {}",
                        request_kind, error
                    ))
                })?;

                Ok((status, response_text))
            })();

            let _ = fs::remove_file(&request_file_path);
            let _ = fs::remove_file(&response_file_path);
            result
        })
        .await
        .map_err(|error| {
            AIError::Provider(format!(
                "curl transport join error for Azemm {} request: {}",
                request_kind_for_join, error
            ))
        })?
    }

    #[cfg(target_os = "windows")]
    async fn send_json_request_via_powershell(
        &self,
        endpoint: &str,
        api_key: &str,
        body: &Value,
        request_kind: &str,
    ) -> Result<Value, AIError> {
        let body_path =
            std::env::temp_dir().join(format!("storyboard-azemm-{}.json", Uuid::new_v4()));
        let body_text = serde_json::to_string(body).map_err(|error| {
            AIError::Provider(format!(
                "Failed to serialize Azemm {} request body for PowerShell fallback: {}",
                request_kind, error
            ))
        })?;
        std::fs::write(&body_path, body_text.as_bytes())?;

        let script = r#"
$ErrorActionPreference = 'Stop'
$headers = @{
  Authorization = "Bearer $env:AZEMM_API_KEY"
  'X-API-Key' = $env:AZEMM_API_KEY
  'X-Banana-Client' = 'comfyui-banana-li'
  Accept = 'application/json'
  'Content-Type' = 'application/json'
}
$body = [System.IO.File]::ReadAllText($env:AZEMM_BODY_PATH, [System.Text.Encoding]::UTF8)
try {
  $response = Invoke-WebRequest -Method Post -Uri $env:AZEMM_ENDPOINT -Headers $headers -Body $body -UseBasicParsing
  [Console]::Out.Write($response.Content)
  exit 0
} catch {
  if ($_.Exception.Response) {
    $stream = $_.Exception.Response.GetResponseStream()
    if ($stream) {
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
      if ($content) {
        [Console]::Out.Write($content)
      }
    }
  }
  if ($_.Exception.Message) {
    [Console]::Error.Write($_.Exception.Message)
  }
  exit 1
}
"#;

        let output = TokioCommand::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .env("AZEMM_API_KEY", api_key)
            .env("AZEMM_ENDPOINT", endpoint)
            .env("AZEMM_BODY_PATH", &body_path)
            .output()
            .await?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = std::fs::remove_file(&body_path);

        if stdout.is_empty() {
            return Err(AIError::Provider(format!(
                "Azemm {} PowerShell fallback returned no JSON body. stderr: {}",
                request_kind, stderr
            )));
        }

        let payload = serde_json::from_str::<Value>(&stdout).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse Azemm {} PowerShell fallback response: {}. Response was: {}",
                request_kind, error, stdout
            ))
        })?;

        if !output.status.success() {
            if let Some(message) = Self::extract_error_message(&payload) {
                return Err(AIError::Provider(message));
            }

            return Err(AIError::Provider(format!(
                "Azemm {} PowerShell fallback failed: {}",
                request_kind,
                if stderr.is_empty() { stdout } else { stderr }
            )));
        }

        Ok(payload)
    }

    async fn build_chat_completion_body(
        &self,
        request: &GenerateRequest,
        include_prompt_preferences: bool,
        include_modalities: bool,
        include_size: bool,
        include_aspect_ratio: bool,
        include_image_size: bool,
        include_extra_body: bool,
        include_extra_body_aspect_ratio: bool,
        include_extra_body_image_size: bool,
    ) -> Result<Value, AIError> {
        let prompt_text = Self::build_generate_content_prompt(request, include_prompt_preferences);
        let message_content = if let Some(reference_images) = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
        {
            let mut content_parts = vec![json!({
                "type": "text",
                "text": prompt_text,
            })];

            for source in reference_images {
                content_parts.push(json!({
                    "type": "image_url",
                    "image_url": {
                        "url": Self::source_to_data_url(source).await?,
                    }
                }));
            }

            Value::Array(content_parts)
        } else {
            Value::String(prompt_text)
        };

        let image_intent = Self::has_image_intent(request);
        let mut body = serde_json::Map::new();
        body.insert(
            "model".to_string(),
            Value::String(Self::resolve_chat_model(&request.model)),
        );
        body.insert(
            "messages".to_string(),
            json!([{
                "role": "user",
                "content": message_content,
            }]),
        );
        body.insert("stream".to_string(), Value::Bool(false));

        if image_intent && include_modalities {
            body.insert("modalities".to_string(), json!(["text", "image"]));
        }
        if image_intent && include_size {
            if let Some(size) = Self::resolve_chat_size(&request.size) {
                body.insert("size".to_string(), Value::String(size.to_string()));
            }
        }
        if image_intent && include_aspect_ratio && !request.aspect_ratio.trim().is_empty() {
            body.insert(
                "aspect_ratio".to_string(),
                Value::String(request.aspect_ratio.trim().to_string()),
            );
        }
        if image_intent && include_image_size {
            if let Some(image_size) = Self::resolve_gemini_image_size(&request.size) {
                body.insert(
                    "image_size".to_string(),
                    Value::String(image_size.to_string()),
                );
            }
        }
        if image_intent && include_extra_body {
            if let Some(extra_body) = Self::build_chat_extra_body(
                request,
                include_extra_body_aspect_ratio,
                include_extra_body_image_size,
            ) {
                body.insert("extra_body".to_string(), extra_body);
            }
        }

        Ok(Value::Object(body))
    }

    async fn request_chat_completion(&self, request: &GenerateRequest) -> Result<Value, AIError> {
        let endpoint = format!("{}{}", self.base_url, CHAT_COMPLETIONS_ENDPOINT_PATH);
        let api_key = self.get_api_key().await?;

        info!(
            "[Azemm] chat request model: {}, size: {}, aspect_ratio: {}, refs: {}",
            Self::resolve_chat_model(&request.model),
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
        );

        let attempts = [
            (
                false,
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                "chat-doc-google-extra-body",
            ),
            (
                false,
                false,
                false,
                true,
                true,
                false,
                false,
                false,
                "chat-direct-image-config",
            ),
            (
                false,
                false,
                true,
                true,
                true,
                false,
                false,
                false,
                "chat-direct-image-config-with-size",
            ),
            (
                true,
                true,
                true,
                true,
                true,
                false,
                false,
                false,
                "chat-openai-compatible-fallback",
            ),
            (
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                "chat-minimal",
            ),
        ];

        let mut last_retryable_error: Option<AIError> = None;
        for (index, attempt) in attempts.iter().enumerate() {
            let (
                include_prompt_preferences,
                include_modalities,
                include_size,
                include_aspect_ratio,
                include_image_size,
                include_extra_body,
                include_extra_body_aspect_ratio,
                include_extra_body_image_size,
                request_kind,
            ) = *attempt;
            let body = self
                .build_chat_completion_body(
                    request,
                    include_prompt_preferences,
                    include_modalities,
                    include_size,
                    include_aspect_ratio,
                    include_image_size,
                    include_extra_body,
                    include_extra_body_aspect_ratio,
                    include_extra_body_image_size,
                )
                .await?;
            let has_more_attempts = index + 1 < attempts.len();

            match self
                .send_json_request(&endpoint, &api_key, body, request_kind)
                .await
            {
                Ok(payload)
                    if has_more_attempts
                        && Self::should_retry_chat_completion_payload(&payload) =>
                {
                    let message = Self::extract_error_message(&payload)
                        .unwrap_or_else(|| "retryable upstream chat error".to_string());
                    info!(
                        "[Azemm] {} returned retryable chat error payload ({}), retrying with {}",
                        request_kind,
                        message,
                        attempts[index + 1].8
                    );
                    last_retryable_error = Some(AIError::Provider(message));
                }
                Err(AIError::Provider(message))
                    if has_more_attempts
                        && Self::should_continue_chat_completion_attempt(&message) =>
                {
                    info!(
                        "[Azemm] {} provider error matched chat fallback criteria ({}), retrying with {}",
                        request_kind, message, attempts[index + 1].8
                    );
                    last_retryable_error = Some(AIError::Provider(message));
                }
                Ok(payload) => return Ok(payload),
                Err(error) => return Err(error),
            }
        }

        Err(last_retryable_error.unwrap_or_else(|| {
            AIError::Provider(
                "Azemm chat/completions attempts exhausted without a result".to_string(),
            )
        }))
    }

    async fn request_generate_content(&self, request: &GenerateRequest) -> Result<Value, AIError> {
        let request_model = Self::sanitize_model(&request.model);
        let endpoint = self.resolve_gemini_endpoint(&request_model);
        let api_key = self.get_api_key().await?;

        info!(
            "[Azemm] generateContent model: {}, endpoint: {}, size: {}, aspect_ratio: {}, refs: {}",
            request_model,
            endpoint,
            request.size,
            request.aspect_ratio,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
        );

        let mut attempts = vec![
            (true, true, true, "generateContent-doc-image-config"),
            (false, false, true, "generateContent-doc-no-aspect"),
        ];
        if request.size.trim().is_empty() {
            attempts.push((false, false, false, "generateContent-minimal"));
        }
        let mut exhausted_retryable_error = false;

        for (index, attempt) in attempts.iter().enumerate() {
            let (
                include_aspect_ratio,
                include_prompt_preferences,
                include_image_size,
                request_kind,
            ) = *attempt;
            let body = self
                .build_generate_content_body(
                    request,
                    include_aspect_ratio,
                    include_prompt_preferences,
                    include_image_size,
                )
                .await?;
            let has_more_attempts = index + 1 < attempts.len();
            match self
                .send_json_request(&endpoint, &api_key, body.clone(), request_kind)
                .await
            {
                Ok(payload)
                    if Self::should_retry_generate_content_payload(&payload)
                        && has_more_attempts =>
                {
                    info!(
                        "[Azemm] {} returned retryable JSON decode error payload, retrying with {}",
                        request_kind,
                        attempts[index + 1].3
                    );
                }
                Err(AIError::Provider(message))
                    if Self::is_retryable_json_decode_error(&message) && has_more_attempts =>
                {
                    #[cfg(target_os = "windows")]
                    {
                        match self
                            .send_json_request_via_powershell(
                                &endpoint,
                                &api_key,
                                &body,
                                request_kind,
                            )
                            .await
                        {
                            Ok(payload) => {
                                info!(
                                    "[Azemm] {} PowerShell fallback succeeded after reqwest retryable JSON decode error",
                                    request_kind
                                );
                                return Ok(payload);
                            }
                            Err(power_shell_error) => {
                                info!(
                                    "[Azemm] {} PowerShell fallback also failed after reqwest retryable JSON decode error: {}",
                                    request_kind, power_shell_error
                                );
                            }
                        }
                    }
                    info!(
                        "[Azemm] {} provider error matched retryable JSON decode criteria, retrying with {}",
                        request_kind, attempts[index + 1].3
                    );
                }
                Ok(payload) if Self::should_retry_generate_content_payload(&payload) => {
                    exhausted_retryable_error = true;
                    break;
                }
                Err(AIError::Provider(message))
                    if Self::is_retryable_json_decode_error(&message) =>
                {
                    exhausted_retryable_error = true;
                    break;
                }
                Err(AIError::Network(error)) => return Err(AIError::Network(error)),
                Ok(payload) => return Ok(payload),
                Err(error) => return Err(error),
            }
        }

        if exhausted_retryable_error {
            return Err(AIError::Provider(
                "Azemm generateContent attempts exhausted with retryable upstream JSON decode errors"
                    .to_string(),
            ));
        }

        Err(AIError::Provider(
            "Azemm generateContent attempts exhausted without a result".to_string(),
        ))
    }

    async fn generate_once(&self, request: &GenerateRequest) -> Result<String, AIError> {
        let image_intent = Self::has_image_intent(request);
        let request_model = Self::sanitize_model(&request.model);
        let use_generate_content =
            image_intent && Self::should_use_generate_content_for_model(&request_model);
        let payload = if use_generate_content {
            info!(
                "[Azemm] routing image request model '{}' via generateContent",
                request_model
            );
            self.request_generate_content(request).await?
        } else {
            if image_intent {
                info!(
                    "[Azemm] routing image request model '{}' via chat/completions",
                    request_model
                );
            }
            self.request_chat_completion(request).await?
        };

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        if image_intent {
            if let Some(image_source) = Self::extract_first_image(&payload) {
                return Ok(image_source);
            }

            if let Some(text) = Self::extract_text(&payload) {
                return Err(AIError::Provider(format!(
                    "Azemm image response did not include image data: {}",
                    text
                )));
            }

            return Err(AIError::Provider(format!(
                "Azemm image response did not include image data: {}",
                payload
            )));
        }

        if let Some(text) = Self::extract_text(&payload) {
            return Ok(text);
        }

        if let Some(image_source) = Self::extract_first_image(&payload) {
            return Ok(image_source);
        }

        Err(AIError::Provider(format!(
            "Azemm chat response did not include text or image data: {}",
            payload
        )))
    }
}

impl Default for AzemmProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for AzemmProvider {
    fn name(&self) -> &str {
        "azemm"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("azemm/") {
            return true;
        }

        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "azemm/gemini-3-pro-image-preview".to_string(),
            "azemm/gemini-3.1-flash-image-preview".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        self.generate_once(&request)
            .await
            .map_err(|error| Self::wrap_selected_model_error(&request, error))
    }
}
