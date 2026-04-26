use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

const DEFAULT_BASE_URL: &str = "https://www.runninghub.cn";
const QUERY_ENDPOINT_PATH: &str = "/openapi/v2/query";
const POLL_INTERVAL_MS: u64 = 5000;
const MAX_INLINE_IMAGE_BYTES: usize = 10 * 1024 * 1024;

const BANANA_PRO_MODEL: &str = "rhart-image-n-pro";
const BANANA_2_MODEL: &str = "rhart-image-n-g31-flash";

const BANANA_PRO_ENDPOINT: &str = "/openapi/v2/rhart-image-n-pro/edit";
const BANANA_2_ENDPOINT: &str = "/openapi/v2/rhart-image-n-g31-flash/image-to-image";

const SUPPORTED_MODELS: [&str; 2] = [BANANA_PRO_MODEL, BANANA_2_MODEL];

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
        };
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
    } else if trimmed.starts_with("asset://") || trimmed.starts_with("tauri://") {
        return Err(format!("Unsupported protocol in image source: {}. Expected file://, http://, https://, data:, or local path.", 
            &trimmed[..trimmed.len().min(50)]));
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
        };
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

fn mime_type_from_extension(extension: &str) -> &'static str {
    match extension.trim().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "avif" => "image/avif",
        _ => "image/png",
    }
}

fn extract_trimmed_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_response_error(payload: &Value) -> Option<String> {
    let error_code = extract_trimmed_string(payload, "errorCode").filter(|code| code != "0");
    let Some(error_code) = error_code else {
        return None;
    };

    let error_message = extract_trimmed_string(payload, "errorMessage")
        .unwrap_or_else(|| "Unknown error".to_string());
    Some(format!("{} (errorCode {})", error_message, error_code))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditRequestBody {
    image_urls: Vec<String>,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    resolution: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequestBody {
    task_id: String,
}

pub struct RunningHubProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl RunningHubProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    async fn upload_image(&self, _api_key: &str, source: &str) -> Result<String, AIError> {
        info!(
            "[RunningHub] upload_image called, source length: {}, prefix: {:?}",
            source.len(),
            if source.len() > 50 {
                &source[..50]
            } else {
                source
            }
        );

        let trimmed = source.trim().trim_matches('`').trim();

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            info!("[RunningHub] Source is already a public URL, returning as-is");
            return Ok(trimmed.to_string());
        }

        if trimmed.starts_with("data:image/") {
            info!("[RunningHub] Source is already a data URI, returning as-is");
            return Ok(trimmed.to_string());
        }

        let extension = file_extension_from_source(trimmed);
        let mime_type = mime_type_from_extension(&extension);
        info!(
            "[RunningHub] Detected extension: {}, mime: {}",
            extension, mime_type
        );

        let bytes = match source_to_bytes(trimmed) {
            Ok(b) => {
                info!("[RunningHub] Successfully read {} bytes", b.len());
                b
            }
            Err(err) => {
                info!("[RunningHub] Failed to read bytes: {}", err);
                return Err(AIError::InvalidRequest(format!(
                    "Failed to read reference image for RunningHub request: {}",
                    err
                )));
            }
        };

        if bytes.len() > MAX_INLINE_IMAGE_BYTES {
            return Err(AIError::InvalidRequest(format!(
                "RunningHub reference image exceeds 10MB limit: {} bytes",
                bytes.len()
            )));
        }

        let data_uri = format!("data:{};base64,{}", mime_type, STANDARD.encode(&bytes));
        info!(
            "[RunningHub] Prepared inline data URI for reference image, bytes: {}",
            bytes.len()
        );
        Ok(data_uri)
    }

    fn resolve_model_and_endpoint(&self, request: &GenerateRequest) -> (String, String) {
        let model_id = if let Some((_, id)) = request.model.split_once('/') {
            id.to_string()
        } else {
            request.model.clone()
        };

        let endpoint = if model_id == BANANA_2_MODEL {
            BANANA_2_ENDPOINT.to_string()
        } else {
            BANANA_PRO_ENDPOINT.to_string()
        };

        (model_id, endpoint)
    }

    async fn submit_edit_task(&self, request: &GenerateRequest) -> Result<Value, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let mut image_urls: Vec<String> = Vec::new();
        let mut upload_errors: Vec<String> = Vec::new();
        if let Some(images) = request.reference_images.as_ref() {
            info!("[RunningHub] Processing {} reference images", images.len());
            for (idx, image) in images.iter().take(10).enumerate() {
                info!(
                    "[RunningHub] Preparing image {}: {}...",
                    idx,
                    &image[..image.len().min(100)]
                );
                match self.upload_image(&api_key, image).await {
                    Ok(url) => {
                        info!("[RunningHub] Image {} prepared successfully", idx);
                        image_urls.push(url);
                    }
                    Err(e) => {
                        let err_msg = format!("Image {} prepare failed: {}", idx, e);
                        info!("[RunningHub] {}", err_msg);
                        upload_errors.push(err_msg);
                    }
                }
            }
        }

        if image_urls.is_empty() {
            let error_detail = if !upload_errors.is_empty() {
                format!(
                    "RunningHub API requires at least one reference image. Upload errors: {}",
                    upload_errors.join("; ")
                )
            } else {
                "RunningHub API requires at least one reference image. Please connect an image node to this node's input.".to_string()
            };
            return Err(AIError::InvalidRequest(error_detail));
        }

        let resolution = request.size.to_lowercase();
        let aspect_ratio = if request.aspect_ratio.is_empty() {
            None
        } else {
            Some(request.aspect_ratio.clone())
        };

        let body = EditRequestBody {
            image_urls,
            prompt: request.prompt.clone(),
            aspect_ratio,
            resolution,
        };

        let (_, endpoint_path) = self.resolve_model_and_endpoint(request);
        let edit_endpoint = format!("{}{}", self.base_url, endpoint_path);
        info!("[RunningHub] Submitting task to: {}", edit_endpoint);
        info!(
            "[RunningHub] Request body: {:?}",
            serde_json::to_string(&body).unwrap_or_default()
        );

        let response = self
            .client
            .post(&edit_endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(300))
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "RunningHub edit request failed {}: {}",
                status, error_text
            )));
        }

        let response_json = response.json::<Value>().await?;
        if let Some(error_message) = extract_response_error(&response_json) {
            return Err(AIError::Provider(format!(
                "RunningHub edit request error: {}",
                error_message
            )));
        }
        info!("[RunningHub] Task submission response: {:?}", response_json);
        Ok(response_json)
    }

    async fn query_task(&self, task_id: &str) -> Result<Value, AIError> {
        if task_id.trim().is_empty() {
            return Err(AIError::TaskFailed(
                "RunningHub task is missing taskId".to_string(),
            ));
        }

        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let query_endpoint = format!("{}{}", self.base_url, QUERY_ENDPOINT_PATH);
        let body = QueryRequestBody {
            task_id: task_id.to_string(),
        };

        let response = self
            .client
            .post(&query_endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "RunningHub query request failed {}: {}",
                status, error_text
            )));
        }

        let response_json = response.json::<Value>().await?;
        if let Some(error_message) = extract_response_error(&response_json) {
            return Err(AIError::TaskFailed(format!(
                "RunningHub query failed: {}",
                error_message
            )));
        }
        Ok(response_json)
    }

    fn extract_result_url(payload: &Value) -> Option<String> {
        payload
            .get("results")
            .and_then(|results| results.as_array())
            .and_then(|results| results.first())
            .and_then(|first| first.get("url"))
            .and_then(|url| url.as_str())
            .map(|url| url.trim().to_string())
            .filter(|url| !url.is_empty())
    }

    async fn poll_until_complete(&self, task_id: &str) -> Result<String, AIError> {
        loop {
            let query_result = self.query_task(task_id).await?;

            let status = query_result
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("UNKNOWN");

            info!("[RunningHub] Task {} status: {}", task_id, status);

            match status {
                "SUCCESS" => {
                    if let Some(url) = Self::extract_result_url(&query_result) {
                        return Ok(url);
                    }
                    return Err(AIError::Provider(
                        "RunningHub task succeeded but no result URL".to_string(),
                    ));
                }
                "FAILED" => {
                    let error_msg = query_result
                        .get("errorMessage")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    return Err(AIError::TaskFailed(error_msg.to_string()));
                }
                "RUNNING" | "QUEUED" => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                }
                _ => {
                    return Err(AIError::Provider(format!(
                        "RunningHub unknown status: {}",
                        status
                    )));
                }
            }
        }
    }
}

impl Default for RunningHubProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for RunningHubProvider {
    fn name(&self) -> &str {
        "runninghub"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("runninghub/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "runninghub/rhart-image-n-pro".to_string(),
            "runninghub/rhart-image-n-g31-flash".to_string(),
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
        let response = self.submit_edit_task(&request).await?;

        let status = response
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN");

        if status == "SUCCESS" {
            if let Some(url) = Self::extract_result_url(&response) {
                return Ok(ProviderTaskSubmission::Succeeded(url));
            }
        }

        let task_id = extract_trimmed_string(&response, "taskId")
            .ok_or_else(|| AIError::Provider("RunningHub response missing taskId".to_string()))?;

        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id,
            metadata: None,
        }))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let query_result = self.query_task(&handle.task_id).await?;

        let status = query_result
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN");

        match status {
            "SUCCESS" => {
                if let Some(url) = Self::extract_result_url(&query_result) {
                    return Ok(ProviderTaskPollResult::Succeeded(url));
                }
                Err(AIError::Provider(
                    "RunningHub task succeeded but no result URL".to_string(),
                ))
            }
            "FAILED" => {
                let error_msg = query_result
                    .get("errorMessage")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                Ok(ProviderTaskPollResult::Failed(error_msg.to_string()))
            }
            "RUNNING" | "QUEUED" => Ok(ProviderTaskPollResult::Running),
            _ => Err(AIError::Provider(format!(
                "RunningHub unknown status: {}",
                status
            ))),
        }
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let response = self.submit_edit_task(&request).await?;

        let status = response
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN");

        if status == "SUCCESS" {
            if let Some(url) = Self::extract_result_url(&response) {
                return Ok(url);
            }
        }

        let task_id = extract_trimmed_string(&response, "taskId")
            .ok_or_else(|| AIError::Provider("RunningHub response missing taskId".to_string()))?;

        self.poll_until_complete(task_id.as_str()).await
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_response_error, extract_trimmed_string};
    use serde_json::json;

    #[test]
    fn extract_trimmed_string_rejects_blank_values() {
        let payload = json!({
            "taskId": "   ",
            "status": " SUCCESS ",
        });

        assert_eq!(extract_trimmed_string(&payload, "taskId"), None);
        assert_eq!(
            extract_trimmed_string(&payload, "status"),
            Some("SUCCESS".to_string())
        );
    }

    #[test]
    fn extract_response_error_ignores_success_code() {
        let payload = json!({
            "errorCode": "0",
            "errorMessage": "ok",
        });

        assert_eq!(extract_response_error(&payload), None);
    }

    #[test]
    fn extract_response_error_formats_non_zero_error_code() {
        let payload = json!({
            "errorCode": "1007",
            "errorMessage": "must not be null",
        });

        assert_eq!(
            extract_response_error(&payload),
            Some("must not be null (errorCode 1007)".to_string())
        );
    }
}
