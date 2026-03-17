use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const DEFAULT_BASE_URL: &str = "https://ai.t8star.cn";
const GENERATIONS_ENDPOINT_PATH: &str = "/v1/images/generations";

const SUPPORTED_MODELS: [&str; 2] = ["nano-banana", "nano-banana-hd"];

const SUPPORTED_ASPECT_RATIOS: [&str; 10] = [
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
];

#[derive(Debug, Serialize)]
struct GenerationsRequestBody {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct GenerationsResponse {
    data: Option<Vec<ImageData>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct ImageData {
    url: Option<String>,
    b64_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: String,
}

pub struct ZhenzhenProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl ZhenzhenProvider {
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

    fn source_to_data_url(source: &str) -> Result<String, String> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err("source is empty".to_string());
        }

        if trimmed.starts_with("data:") {
            return Ok(trimmed.to_string());
        }

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Ok(trimmed.to_string());
        }

        if let Some((meta, payload)) = trimmed.split_once(',') {
            if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            STANDARD
                .decode(trimmed)
                .map_err(|err| format!("invalid base64 payload: {}", err))?;
            return Ok(format!("data:image/png;base64,{}", trimmed));
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };
        let bytes = std::fs::read(&path).map_err(|err| {
            format!(
                "failed to read path \"{}\": {}",
                path.to_string_lossy(),
                err
            )
        })?;
        let base64 = STANDARD.encode(&bytes);
        Ok(format!("data:image/png;base64,{}", base64))
    }

    fn validate_aspect_ratio(aspect_ratio: &str) -> bool {
        SUPPORTED_ASPECT_RATIOS.contains(&aspect_ratio)
    }

    async fn request_generation(
        &self,
        request: &GenerateRequest,
        model: String,
    ) -> Result<GenerationsResponse, AIError> {
        let endpoint = format!("{}{}", self.base_url, GENERATIONS_ENDPOINT_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let reference_images = request.reference_images.as_ref().map(|images| {
            images
                .iter()
                .filter_map(|source| Self::source_to_data_url(source).ok())
                .collect::<Vec<_>>()
        }).filter(|images| !images.is_empty());

        let body = GenerationsRequestBody {
            model: model.clone(),
            prompt: request.prompt.clone(),
            response_format: Some("url".to_string()),
            aspect_ratio: if !request.aspect_ratio.is_empty() && Self::validate_aspect_ratio(&request.aspect_ratio) {
                Some(request.aspect_ratio.clone())
            } else {
                None
            },
            image: reference_images,
        };

        info!("[Zhenzhen API] URL: {}", endpoint);
        info!("[Zhenzhen API] Model: {}, AspectRatio: {}", model, request.aspect_ratio);

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await.map_err(AIError::from)?;
        info!("[Zhenzhen API] Response status: {}", status);
        info!("[Zhenzhen API] Response: {}", response_text);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Zhenzhen request failed {}: {}",
                status, response_text
            )));
        }

        serde_json::from_str(&response_text).map_err(|e| {
            AIError::Provider(format!(
                "Failed to parse Zhenzhen response: {}. Response was: {}",
                e, response_text
            ))
        })
    }
}

impl Default for ZhenzhenProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for ZhenzhenProvider {
    fn name(&self) -> &str {
        "zhenzhen"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("zhenzhen/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "zhenzhen/nano-banana".to_string(),
            "zhenzhen/nano-banana-hd".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let model = Self::sanitize_model(&request.model);
        info!(
            "[Zhenzhen Request] model: {}, aspect_ratio: {}, refs: {}",
            model,
            request.aspect_ratio,
            request.reference_images.as_ref().map(|v| v.len()).unwrap_or(0)
        );

        let response = self.request_generation(&request, model).await?;

        if let Some(error) = response.error {
            return Err(AIError::Provider(format!(
                "Zhenzhen API error: {}",
                error.message
            )));
        }

        let data = response
            .data
            .ok_or_else(|| AIError::Provider("Zhenzhen response missing data field".to_string()))?;

        let first_image = data
            .first()
            .ok_or_else(|| AIError::Provider("Zhenzhen response has empty data array".to_string()))?;

        if let Some(url) = &first_image.url {
            return Ok(url.clone());
        }

        if let Some(b64_json) = &first_image.b64_json {
            return Ok(format!("data:image/png;base64,{}", b64_json));
        }

        Err(AIError::Provider(
            "Zhenzhen response missing both url and b64_json".to_string(),
        ))
    }
}
