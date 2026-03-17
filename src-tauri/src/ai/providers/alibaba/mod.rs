mod models;
mod registry;

pub use registry::*;

use reqwest::Client;
use serde::{Deserialize, Serialize};
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

        let req = AlibabaRequest {
            model: model.clone(),
            input: AlibabaInput {
                prompt: request.prompt.clone(),
                images: request.reference_images.clone(),
            },
            parameters: AlibabaParameters {
                temperature: Some(0.7),
                max_tokens: Some(2048),
                result_format: Some("message".to_string()),
            },
        };

        let endpoint = format!("{}/api/v1/services/aigc/text-generation/generation", self.base_url);

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
