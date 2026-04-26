use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use super::compatible::CompatibleProvider;
use super::newapi::NewApiProvider;
use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

pub const OOPII_PROVIDER_ID: &str = "oopii";
pub const DEFAULT_OOPII_TEXT_MODEL: &str = "gpt-5.4";
pub const OOPII_STORYBOARD_BASE_URL: &str = "https://www.oopii.cn/";
const OOPII_STORYBOARD_DEFAULT_API_FORMAT: &str = "openai";
const OOPII_STORYBOARD_GEMINI_API_FORMAT: &str = "gemini";

#[derive(Debug, Clone, Default, Deserialize)]
struct OopiiStoryboardPayload {
    #[serde(default)]
    api_format: String,
    #[serde(default)]
    request_model: String,
    #[serde(default)]
    display_name: String,
}

pub struct OopiiProvider {
    compatible: CompatibleProvider,
    newapi: NewApiProvider,
}

impl OopiiProvider {
    pub fn new() -> Self {
        Self {
            compatible: CompatibleProvider::new(),
            newapi: NewApiProvider::new(),
        }
    }

    fn has_param(request: &GenerateRequest, key: &str) -> bool {
        request
            .extra_params
            .as_ref()
            .and_then(|params| params.get(key))
            .is_some()
    }

    fn is_storyboard_request(request: &GenerateRequest) -> bool {
        Self::has_param(request, "newapi_config")
            || (!Self::has_param(request, "compatible_config")
                && request.model.trim().starts_with("oopii/"))
    }

    fn strip_provider_prefix(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.trim().to_string())
            .unwrap_or_default()
    }

    fn infer_storyboard_api_format(request_model: &str) -> &'static str {
        let normalized = request_model.trim().to_ascii_lowercase();
        if normalized.contains("gemini") || normalized.contains("imagen") {
            OOPII_STORYBOARD_GEMINI_API_FORMAT
        } else {
            OOPII_STORYBOARD_DEFAULT_API_FORMAT
        }
    }

    fn resolve_storyboard_api_format(payload_api_format: &str, request_model: &str) -> &'static str {
        match payload_api_format.trim() {
            "gemini" | "gemini-generate-content" => OOPII_STORYBOARD_GEMINI_API_FORMAT,
            "openai" | "openai-chat" | "openai-edits" => OOPII_STORYBOARD_DEFAULT_API_FORMAT,
            _ => Self::infer_storyboard_api_format(request_model),
        }
    }

    fn extract_storyboard_payload(request: &GenerateRequest) -> Result<OopiiStoryboardPayload, AIError> {
        let raw_value = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config").cloned());

        match raw_value {
            Some(value) => Ok(serde_json::from_value(value)?),
            None => Ok(OopiiStoryboardPayload::default()),
        }
    }

    fn inject_newapi_config(request: &mut GenerateRequest) -> Result<(), AIError> {
        let payload = Self::extract_storyboard_payload(request)?;
        let resolved_request_model = if payload.request_model.trim().is_empty() {
            Self::strip_provider_prefix(&request.model)
        } else {
            payload.request_model.trim().to_string()
        };
        if resolved_request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "OOpii request model is required".to_string(),
            ));
        }

        let display_name = if payload.display_name.trim().is_empty() {
            resolved_request_model.clone()
        } else {
            payload.display_name.trim().to_string()
        };
        let api_format =
            Self::resolve_storyboard_api_format(&payload.api_format, &resolved_request_model);

        let extra_params = request
            .extra_params
            .get_or_insert_with(HashMap::<String, Value>::new);
        extra_params.insert(
            "newapi_config".to_string(),
            json!({
                "api_format": api_format,
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": resolved_request_model,
                "display_name": display_name,
            }),
        );

        Ok(())
    }
}

impl Default for OopiiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for OopiiProvider {
    fn name(&self) -> &str {
        OOPII_PROVIDER_ID
    }

    fn supports_model(&self, model: &str) -> bool {
        let trimmed = model.trim();
        trimmed.eq_ignore_ascii_case(DEFAULT_OOPII_TEXT_MODEL) || trimmed.starts_with("oopii/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![DEFAULT_OOPII_TEXT_MODEL.to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        self.compatible.set_api_key(api_key.clone()).await?;
        self.newapi.set_api_key(api_key).await
    }

    async fn generate(&self, mut request: GenerateRequest) -> Result<String, AIError> {
        if Self::is_storyboard_request(&request) {
            Self::inject_newapi_config(&mut request)?;
            return self.newapi.generate(request).await;
        }

        self.compatible.generate(request).await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        OopiiProvider, DEFAULT_OOPII_TEXT_MODEL, OOPII_PROVIDER_ID, OOPII_STORYBOARD_BASE_URL,
    };
    use crate::ai::AIProvider;
    use crate::ai::GenerateRequest;

    #[test]
    fn exposes_expected_provider_identity() {
        let provider = OopiiProvider::new();
        assert_eq!(provider.name(), OOPII_PROVIDER_ID);
        assert_eq!(provider.list_models(), vec![DEFAULT_OOPII_TEXT_MODEL.to_string()]);
    }

    #[test]
    fn supports_default_and_prefixed_models() {
        let provider = OopiiProvider::new();
        assert!(provider.supports_model(DEFAULT_OOPII_TEXT_MODEL));
        assert!(provider.supports_model("oopii/custom-model"));
        assert!(!provider.supports_model("compatible/storyboard-experimental"));
    }

    #[test]
    fn detects_storyboard_requests_from_prefixed_models() {
        let request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/gpt-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: None,
        };

        assert!(OopiiProvider::is_storyboard_request(&request));
    }

    #[test]
    fn injects_fixed_newapi_payload_for_storyboard_generation() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/gemini-3-pro-image-preview".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "newapi_config".to_string(),
                json!({
                    "request_model": "gemini-3-pro-image-preview",
                    "display_name": "香蕉Pro",
                }),
            )])),
        };

        OopiiProvider::inject_newapi_config(&mut request).unwrap();
        let payload = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config"))
            .cloned()
            .unwrap();

        assert_eq!(
            payload,
            json!({
                "api_format": "gemini",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "gemini-3-pro-image-preview",
                "display_name": "香蕉Pro",
            })
        );
    }

    #[test]
    fn injects_openai_payload_for_gpt_image_2_storyboard_generation() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/gpt-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: None,
        };

        OopiiProvider::inject_newapi_config(&mut request).unwrap();
        let payload = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config"))
            .cloned()
            .unwrap();

        assert_eq!(
            payload,
            json!({
                "api_format": "openai",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "gpt-image-2",
                "display_name": "gpt-image-2",
            })
        );
    }
}
