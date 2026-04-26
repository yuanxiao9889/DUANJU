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
const OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL: &str = "gpt-image-2";

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
            .unwrap_or_else(|| model.trim().to_string())
    }

    fn infer_storyboard_api_format(request_model: &str) -> &'static str {
        let normalized = request_model.trim().to_ascii_lowercase();
        if normalized.contains("gemini") || normalized.contains("imagen") {
            OOPII_STORYBOARD_GEMINI_API_FORMAT
        } else {
            OOPII_STORYBOARD_DEFAULT_API_FORMAT
        }
    }

    fn resolve_storyboard_api_format(
        payload_api_format: &str,
        request_model: &str,
    ) -> &'static str {
        match payload_api_format.trim() {
            "gemini" | "gemini-generate-content" => OOPII_STORYBOARD_GEMINI_API_FORMAT,
            "openai" | "openai-chat" | "openai-edits" => OOPII_STORYBOARD_DEFAULT_API_FORMAT,
            _ => Self::infer_storyboard_api_format(request_model),
        }
    }

    fn extract_storyboard_payload(
        request: &GenerateRequest,
    ) -> Result<OopiiStoryboardPayload, AIError> {
        let raw_value = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config").cloned());

        match raw_value {
            Some(value) => Ok(serde_json::from_value(value)?),
            None => Ok(OopiiStoryboardPayload::default()),
        }
    }

    fn normalize_storyboard_resolution(size: &str) -> Option<&'static str> {
        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1K"),
            "2K" => Some("2K"),
            "4K" => Some("4K"),
            _ => None,
        }
    }

    fn is_storyboard_gpt_image_2_request_model(request_model: &str) -> bool {
        let normalized = Self::strip_provider_prefix(request_model).to_ascii_lowercase();
        normalized.starts_with(OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL)
    }

    fn resolve_storyboard_gpt_image_2_quality(request: &GenerateRequest) -> &'static str {
        let quality = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_else(|| "medium".to_string());

        match quality.as_str() {
            "low" => "low",
            "high" => "high",
            _ => "medium",
        }
    }

    fn resolve_storyboard_request_model(request: &GenerateRequest, request_model: &str) -> String {
        let normalized = Self::strip_provider_prefix(request_model);
        if normalized.is_empty() {
            return String::new();
        }

        if !Self::is_storyboard_gpt_image_2_request_model(&normalized) {
            return normalized;
        }

        match Self::normalize_storyboard_resolution(&request.size) {
            Some("2K") => format!(
                "{OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL}-2k-{}",
                Self::resolve_storyboard_gpt_image_2_quality(request)
            ),
            Some("4K") => format!(
                "{OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL}-4k-{}",
                Self::resolve_storyboard_gpt_image_2_quality(request)
            ),
            _ => OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL.to_string(),
        }
    }

    fn resolve_storyboard_display_name(payload_display_name: &str, request_model: &str) -> String {
        let trimmed = payload_display_name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }

        if Self::is_storyboard_gpt_image_2_request_model(request_model) {
            return OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL.to_string();
        }

        request_model.trim().to_string()
    }

    fn inject_newapi_config(request: &mut GenerateRequest) -> Result<(), AIError> {
        let payload = Self::extract_storyboard_payload(request)?;
        let base_request_model = if payload.request_model.trim().is_empty() {
            Self::strip_provider_prefix(&request.model)
        } else {
            payload.request_model.trim().to_string()
        };
        if base_request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "OOpii request model is required".to_string(),
            ));
        }
        let resolved_request_model =
            Self::resolve_storyboard_request_model(request, &base_request_model);

        let display_name =
            Self::resolve_storyboard_display_name(&payload.display_name, &resolved_request_model);
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
        assert_eq!(
            provider.list_models(),
            vec![DEFAULT_OOPII_TEXT_MODEL.to_string()]
        );
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
            size: "1K".to_string(),
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

    #[test]
    fn injects_2k_medium_alias_for_gpt_image_2_when_quality_missing() {
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
                "request_model": "gpt-image-2-2k-medium",
                "display_name": "gpt-image-2",
            })
        );
    }

    #[test]
    fn injects_4k_quality_alias_for_gpt_image_2() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "9:16".to_string(),
            reference_images: None,
            extra_params: Some(HashMap::from([("quality".to_string(), json!("high"))])),
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
                "request_model": "gpt-image-2-4k-high",
                "display_name": "gpt-image-2",
            })
        );
    }
}
