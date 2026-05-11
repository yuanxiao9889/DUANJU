mod registry;

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

pub struct CodingProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
    model_registry: registry::CodingModelRegistry,
}

#[derive(Debug, Serialize, Deserialize)]
struct CodingRequest {
    model: String,
    messages: Vec<CodingMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    stream: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CodingMessage {
    role: String,
    content: Value,
}

// OpenAI compatible response format
#[derive(Debug, Deserialize)]
struct CodingResponse {
    #[serde(rename = "choices")]
    choices: Option<Vec<CodingChoice>>,
    #[allow(dead_code)]
    #[serde(rename = "usage")]
    usage: Option<CodingUsage>,
    #[allow(dead_code)]
    #[serde(rename = "id")]
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodingChoice {
    #[serde(rename = "message")]
    message: Option<CodingMessage>,
    #[serde(rename = "delta")]
    delta: Option<CodingDelta>,
    #[allow(dead_code)]
    #[serde(rename = "finish_reason")]
    finish_reason: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "index")]
    index: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CodingDelta {
    #[serde(rename = "content")]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodingUsage {
    #[allow(dead_code)]
    #[serde(rename = "prompt_tokens")]
    prompt_tokens: Option<u32>,
    #[allow(dead_code)]
    #[serde(rename = "completion_tokens")]
    completion_tokens: Option<u32>,
    #[allow(dead_code)]
    #[serde(rename = "total_tokens")]
    total_tokens: Option<u32>,
}

impl CodingProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: "https://coding.dashscope.aliyuncs.com".to_string(),
            model_registry: registry::CodingModelRegistry::new(),
        }
    }

    pub async fn set_api_key(&self, api_key: String) {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
    }

    pub async fn get_api_key(&self) -> Option<String> {
        let key = self.api_key.read().await;
        key.clone()
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

    async fn build_message_content(request: &GenerateRequest) -> Result<Value, AIError> {
        let Some(reference_images) = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
        else {
            return Ok(Value::String(request.prompt.clone()));
        };

        let mut content = vec![json!({
            "type": "text",
            "text": request.prompt.clone(),
        })];
        for source in reference_images {
            content.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": Self::source_to_data_url(source).await?,
                },
            }));
        }

        Ok(Value::Array(content))
    }

    pub fn get_endpoint(&self, model: &str) -> String {
        let default_endpoint = format!(
            "{}/v1/chat/completions",
            self.base_url.trim_end_matches('/')
        );
        if model.starts_with("qwen") || model.starts_with("glm") || model.starts_with("kimi") {
            // For Coding Plan, use the specific endpoint
            // Documentation: https://help.aliyun.com/zh/model-studio/coding-plan-quickstart
            default_endpoint
        } else if model.starts_with("MiniMax") {
            "https://api.minimaxi.com/v1/chat/completions".to_string()
        } else if model.starts_with("ep-") {
            "https://ark.cn-beijing.volces.com/api/v3/chat/completions".to_string()
        } else {
            // Default fallback
            default_endpoint
        }
    }
}

impl Default for CodingProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for CodingProvider {
    fn name(&self) -> &str {
        "coding"
    }

    fn supports_model(&self, model: &str) -> bool {
        self.model_registry.supports(model)
    }

    fn list_models(&self) -> Vec<String> {
        self.model_registry.list_models()
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        CodingProvider::set_api_key(self, api_key).await;
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let key = self.api_key.read().await;
        let api_key = key
            .as_ref()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let model = self
            .model_registry
            .resolve(&request.model)
            .ok_or_else(|| AIError::ModelNotSupported(request.model.clone()))?;
        let message_content = Self::build_message_content(&request).await?;

        let req = CodingRequest {
            model: model.to_string(),
            messages: vec![CodingMessage {
                role: "user".to_string(),
                content: message_content,
            }],
            temperature: Some(0.7),
            max_tokens: Some(2048),
            stream: Some(false),
        };

        // Determine endpoint based on model
        let endpoint = self.get_endpoint(&model);

        info!("[Coding Request] model: {}, url: {}", model, endpoint);
        info!(
            "[Coding Request] api_key prefix: {}...",
            &api_key[..std::cmp::min(10, api_key.len())]
        );

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Accept", "application/json")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .json(&req)
            .send()
            .await?;

        info!("[Coding Response] status: {}", response.status());

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "Coding API error {}: {}",
                status, error_text
            )));
        }

        let result: CodingResponse = response.json().await?;

        let text = result
            .choices
            .as_ref()
            .and_then(|choices| choices.first())
            .and_then(|c| {
                // Try message first (non-streaming)
                c.message
                    .as_ref()
                    .and_then(|m| {
                        if m.role == "assistant" || m.role == "model" {
                            m.content.as_str().map(ToString::to_string)
                        } else {
                            None
                        }
                    })
                    .or_else(|| {
                        // Try delta (streaming format)
                        c.delta.as_ref().and_then(|d| d.content.clone())
                    })
            })
            .ok_or_else(|| AIError::Provider("No text in response".to_string()))?;

        info!("Generated text: {} chars", text.len());
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_endpoint() {
        let provider = CodingProvider::new();

        // Qwen
        assert_eq!(
            provider.get_endpoint("qwen-plus"),
            "https://coding.dashscope.aliyuncs.com/v1/chat/completions"
        );

        // MiniMax
        assert_eq!(
            provider.get_endpoint("MiniMax-M2.5"),
            "https://api.minimaxi.com/v1/chat/completions"
        );

        // Doubao (ep-xxx)
        assert_eq!(
            provider.get_endpoint("ep-123456"),
            "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
        );

        // Fallback
        assert_eq!(
            provider.get_endpoint("unknown-model"),
            "https://coding.dashscope.aliyuncs.com/v1/chat/completions"
        );
    }
}
