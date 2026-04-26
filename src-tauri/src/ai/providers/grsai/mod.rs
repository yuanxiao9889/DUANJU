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
const COMPLETIONS_ENDPOINT_PATH: &str = "/v1/draw/completions";
const RESULT_ENDPOINT_PATH: &str = "/v1/draw/result";
const UPLOAD_TOKEN_ENDPOINT_PATH: &str = "/client/resource/newUploadTokenZH";
const DEFAULT_BASE_URL: &str = "https://grsai.dakka.com.cn";
const DEFAULT_PRO_MODEL: &str = "nano-banana-pro";
const DEFAULT_GPT_IMAGE_MODEL: &str = "gpt-image-2";
const POLL_INTERVAL_MS: u64 = 2000;

const SUPPORTED_MODELS: [&str; 9] = [
    "nano-banana-2",
    "nano-banana-fast",
    "nano-banana",
    "nano-banana-pro",
    "nano-banana-pro-vt",
    "nano-banana-pro-cl",
    "nano-banana-pro-vip",
    "nano-banana-pro-4k-vip",
    "gpt-image-2",
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
struct CompletionsRequestBody {
    model: String,
    prompt: String,
    size: String,
    urls: Vec<String>,
    #[serde(rename = "webHook")]
    web_hook: String,
    shut_progress: bool,
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
            return requested;
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
        if trimmed.is_empty() {
            return DEFAULT_GPT_IMAGE_MODEL.to_string();
        }
        trimmed
    }

    fn resolve_completions_size(request: &GenerateRequest) -> String {
        let aspect_ratio = request.aspect_ratio.trim();
        if !aspect_ratio.is_empty() {
            return aspect_ratio.to_string();
        }

        "auto".to_string()
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

    fn extract_result_url(payload: &Value) -> Option<String> {
        payload
            .get("results")
            .and_then(|results| results.as_array())
            .and_then(|results| results.first())
            .and_then(|first| first.get("url"))
            .or_else(|| payload.get("url"))
            .and_then(|url| url.as_str())
            .map(|url| url.trim().trim_matches('`').trim().to_string())
            .filter(|url| !url.is_empty())
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

        let upload_response = self
            .client
            .post(upload_url)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await?;

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
            .timeout(std::time::Duration::from_secs(300))
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
        info!("[GRSAI API] Response: {}", response_text);
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
    ) -> Result<Value, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;
        let route = Self::resolve_request_route(&model);

        if route == GrsaiRequestRoute::Completions {
            let body = CompletionsRequestBody {
                model: Self::resolve_completions_model(&model),
                prompt: request.prompt.clone(),
                size: Self::resolve_completions_size(request),
                urls: self.prepare_reference_urls(&api_key, request, false).await?,
                web_hook: "-1".to_string(),
                shut_progress: true,
            };
            let endpoint = format!("{}{}", self.base_url, COMPLETIONS_ENDPOINT_PATH);
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
            web_hook: String::new(),
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
                web_hook: String::new(),
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

    async fn poll_result_once(&self, task_id: &str) -> Result<ProviderTaskPollResult, AIError> {
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

    async fn poll_result_until_complete(&self, task_id: &str) -> Result<String, AIError> {
        loop {
            match self.poll_result_once(task_id).await? {
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

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let model = self.normalize_requested_model(&request);
        let draw_response = self.request_draw(&request, model).await?;
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
            metadata: None,
        }))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        self.poll_result_once(handle.task_id.as_str()).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = self.normalize_requested_model(&request);
        info!(
            "[GRSAI Request] model: {}, size: {}, aspect_ratio: {}",
            model, request.size, request.aspect_ratio
        );

        let draw_response = self.request_draw(&request, model).await?;
        let payload = Self::resolve_task_payload(&draw_response)?;

        if let Some(url) = Self::extract_result_url(payload) {
            return Ok(url);
        }

        let task_id = payload
            .get("id")
            .and_then(|raw| raw.as_str())
            .ok_or_else(|| AIError::Provider("GRSAI response missing task id".to_string()))?;

        self.poll_result_until_complete(task_id).await
    }
}
