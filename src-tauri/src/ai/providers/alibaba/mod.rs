mod models;
mod registry;

pub use registry::*;

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

pub struct AlibabaProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
    model_registry: registry::AlibabaModelRegistry,
}

#[derive(Debug, Serialize, Deserialize)]
struct AlibabaRequest {
    model: String,
    input: AlibabaInput,
    parameters: AlibabaParameters,
}

#[derive(Debug, Serialize, Deserialize)]
struct AlibabaInput {
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AlibabaParameters {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result_format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlibabaResponse {
    output: AlibabaOutput,
    #[allow(dead_code)]
    usage: Option<AlibabaUsage>,
    #[allow(dead_code)]
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlibabaOutput {
    text: Option<String>,
    choices: Option<Vec<AlibabaChoice>>,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AlibabaChoice {
    message: AlibabaMessage,
}

#[derive(Debug, Deserialize)]
struct AlibabaMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct AlibabaUsage {
    #[allow(dead_code)]
    input_tokens: Option<u32>,
    #[allow(dead_code)]
    output_tokens: Option<u32>,
    #[allow(dead_code)]
    total_tokens: Option<u32>,
}

impl AlibabaProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: "https://dashscope.aliyuncs.com".to_string(),
            model_registry: registry::AlibabaModelRegistry::new(),
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
}

impl Default for AlibabaProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for AlibabaProvider {
    fn name(&self) -> &str {
        "alibaba"
    }

    fn supports_model(&self, model: &str) -> bool {
        self.model_registry.supports(model)
    }

    fn list_models(&self) -> Vec<String> {
        self.model_registry.list_models()
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        AlibabaProvider::set_api_key(self, api_key).await;
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

        let normalized_images = if let Some(reference_images) = request.reference_images.as_ref() {
            let mut normalized = Vec::with_capacity(reference_images.len());
            for source in reference_images {
                normalized.push(Self::source_to_data_url(source).await?);
            }
            Some(normalized)
        } else {
            None
        };

        let req = AlibabaRequest {
            model: model.clone(),
            input: AlibabaInput {
                prompt: request.prompt.clone(),
                images: normalized_images,
            },
            parameters: AlibabaParameters {
                temperature: Some(0.7),
                max_tokens: Some(2048),
                result_format: Some("message".to_string()),
            },
        };

        let endpoint = format!(
            "{}/api/v1/services/aigc/text-generation/generation",
            self.base_url
        );

        info!("[Alibaba Request] model: {}, url: {}", model, endpoint);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .header("X-DashScope-Async", "disable")
            .json(&req)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "Alibaba API error {}: {}",
                status, error_text
            )));
        }

        let result: AlibabaResponse = response.json().await?;

        if let Some(text) = result.output.text {
            info!("Generated text: {} chars", text.len());
            Ok(text)
        } else if let Some(choices) = result.output.choices {
            if let Some(choice) = choices.first() {
                let text = &choice.message.content;
                info!("Generated text (from choices): {} chars", text.len());
                Ok(text.clone())
            } else {
                Err(AIError::Provider("Empty choices in response".to_string()))
            }
        } else {
            Err(AIError::Provider("No text in response".to_string()))
        }
    }
}
