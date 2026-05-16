use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use super::compatible::CompatibleProvider;
use super::newapi::NewApiProvider;
use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

pub const OOPII_PROVIDER_ID: &str = "oopii";
pub const DEFAULT_OOPII_TEXT_MODEL: &str = "all-5.4";
pub const OOPII_ALT_TEXT_MODEL: &str = "all-5.5";
pub const OOPII_STORYBOARD_BASE_URL: &str = "https://www.oopii.cc/";
const OOPII_STORYBOARD_DEFAULT_API_FORMAT: &str = "openai";
const OOPII_STORYBOARD_OPENAI_IMAGES_API_FORMAT: &str = "openai-images";
const OOPII_STORYBOARD_GEMINI_API_FORMAT: &str = "gemini";
const OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL: &str = "all-image-2";
const OOPII_STORYBOARD_MONKEY_PRO_REQUEST_MODEL: &str = "monkey-image-pro";
const OOPII_STORYBOARD_MONKEY_FLASH_2_REQUEST_MODEL: &str = "monkey-image-flash 2";

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

    fn normalize_oopii_model_alias(model: &str) -> String {
        match model.trim().to_ascii_lowercase().as_str() {
            "gpt-5.4" => DEFAULT_OOPII_TEXT_MODEL.to_string(),
            "gpt-5.5" => OOPII_ALT_TEXT_MODEL.to_string(),
            "gpt-image-2" => OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL.to_string(),
            "gemini-3-pro-image-preview" => OOPII_STORYBOARD_MONKEY_PRO_REQUEST_MODEL.to_string(),
            "gemini-3.1-flash-image-preview" => {
                OOPII_STORYBOARD_MONKEY_FLASH_2_REQUEST_MODEL.to_string()
            }
            _ => model.trim().to_string(),
        }
    }

    fn strip_provider_prefix(model: &str) -> String {
        let stripped = model
            .split_once('/')
            .map(|(_, bare)| bare.trim().to_string())
            .unwrap_or_else(|| model.trim().to_string());
        Self::normalize_oopii_model_alias(&stripped)
    }

    fn infer_storyboard_api_format(request_model: &str) -> &'static str {
        let normalized = request_model.trim().to_ascii_lowercase();
        if Self::is_storyboard_gpt_image_2_request_model(&normalized) {
            OOPII_STORYBOARD_OPENAI_IMAGES_API_FORMAT
        } else if normalized.contains("gemini")
            || normalized.contains("imagen")
            || normalized.contains("monkey-image")
        {
            OOPII_STORYBOARD_GEMINI_API_FORMAT
        } else {
            OOPII_STORYBOARD_DEFAULT_API_FORMAT
        }
    }

    fn resolve_storyboard_api_format(
        payload_api_format: &str,
        request_model: &str,
    ) -> &'static str {
        let is_gpt_image_2 = Self::is_storyboard_gpt_image_2_request_model(request_model);
        match payload_api_format.trim() {
            "gemini" | "gemini-generate-content" => OOPII_STORYBOARD_GEMINI_API_FORMAT,
            "openai-images" => OOPII_STORYBOARD_OPENAI_IMAGES_API_FORMAT,
            "openai" | "openai-chat" | "openai-edits" if is_gpt_image_2 => {
                OOPII_STORYBOARD_OPENAI_IMAGES_API_FORMAT
            }
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

    fn is_storyboard_gpt_image_2_request_model(request_model: &str) -> bool {
        let normalized = Self::strip_provider_prefix(request_model).to_ascii_lowercase();
        normalized.starts_with(OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL)
    }

    fn resolve_storyboard_request_model(request_model: &str) -> String {
        let normalized = Self::strip_provider_prefix(request_model);
        if normalized.is_empty() {
            return String::new();
        }

        if Self::is_storyboard_gpt_image_2_request_model(&normalized) {
            OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL.to_string()
        } else {
            normalized
        }
    }

    fn resolve_storyboard_display_name(payload_display_name: &str, request_model: &str) -> String {
        let trimmed = payload_display_name.trim();
        if !trimmed.is_empty() {
            return Self::normalize_oopii_model_alias(trimmed);
        }

        if Self::is_storyboard_gpt_image_2_request_model(request_model) {
            return OOPII_STORYBOARD_GPT_IMAGE_2_REQUEST_MODEL.to_string();
        }

        match request_model.trim() {
            OOPII_STORYBOARD_MONKEY_PRO_REQUEST_MODEL => "monkey-pro".to_string(),
            OOPII_STORYBOARD_MONKEY_FLASH_2_REQUEST_MODEL => "monkey-2".to_string(),
            _ => request_model.trim().to_string(),
        }
    }

    fn inject_newapi_config(request: &mut GenerateRequest) -> Result<(), AIError> {
        let payload = Self::extract_storyboard_payload(request)?;
        let base_request_model = if payload.request_model.trim().is_empty() {
            Self::strip_provider_prefix(&request.model)
        } else {
            Self::normalize_oopii_model_alias(payload.request_model.trim())
        };
        if base_request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "OOpii request model is required".to_string(),
            ));
        }
        let resolved_request_model = Self::resolve_storyboard_request_model(&base_request_model);

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
        let normalized = Self::normalize_oopii_model_alias(model);
        normalized.eq_ignore_ascii_case(DEFAULT_OOPII_TEXT_MODEL)
            || normalized.eq_ignore_ascii_case(OOPII_ALT_TEXT_MODEL)
            || model.trim().starts_with("oopii/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            DEFAULT_OOPII_TEXT_MODEL.to_string(),
            OOPII_ALT_TEXT_MODEL.to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        self.compatible.set_api_key(api_key.clone()).await?;
        self.newapi.set_api_key(api_key).await
    }

    fn should_use_task_resume(&self, request: &GenerateRequest) -> bool {
        if !Self::is_storyboard_request(request) {
            return false;
        }

        let mut delegated_request = request.clone();
        Self::inject_newapi_config(&mut delegated_request)
            .map(|_| self.newapi.should_use_task_resume(&delegated_request))
            .unwrap_or(false)
    }

    async fn submit_task(
        &self,
        mut request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        if Self::is_storyboard_request(&request) {
            Self::inject_newapi_config(&mut request)?;
            return self.newapi.submit_task(request).await;
        }

        let image_source = self.compatible.generate(request).await?;
        Ok(ProviderTaskSubmission::Succeeded(image_source))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        self.newapi.poll_task(handle).await
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
        OopiiProvider, DEFAULT_OOPII_TEXT_MODEL, OOPII_ALT_TEXT_MODEL, OOPII_PROVIDER_ID,
        OOPII_STORYBOARD_BASE_URL,
    };
    use crate::ai::AIProvider;
    use crate::ai::GenerateRequest;

    #[test]
    fn exposes_expected_provider_identity() {
        let provider = OopiiProvider::new();
        assert_eq!(provider.name(), OOPII_PROVIDER_ID);
        assert_eq!(
            provider.list_models(),
            vec![
                DEFAULT_OOPII_TEXT_MODEL.to_string(),
                OOPII_ALT_TEXT_MODEL.to_string()
            ]
        );
    }

    #[test]
    fn supports_default_legacy_and_prefixed_models() {
        let provider = OopiiProvider::new();
        assert!(provider.supports_model(DEFAULT_OOPII_TEXT_MODEL));
        assert!(provider.supports_model(OOPII_ALT_TEXT_MODEL));
        assert!(provider.supports_model("gpt-5.4"));
        assert!(provider.supports_model("gpt-5.5"));
        assert!(provider.supports_model("oopii/custom-model"));
        assert!(!provider.supports_model("compatible/storyboard-experimental"));
    }

    #[test]
    fn detects_storyboard_requests_from_prefixed_models() {
        let request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/all-image-2".to_string(),
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
            model: "oopii/monkey-image-pro".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "newapi_config".to_string(),
                json!({
                    "request_model": "monkey-image-pro",
                    "display_name": "monkey-pro",
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
                "request_model": "monkey-image-pro",
                "display_name": "monkey-pro",
            })
        );
    }

    #[test]
    fn injects_openai_payload_for_all_image_2_storyboard_generation() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/all-image-2".to_string(),
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
                "api_format": "openai-images",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "all-image-2",
                "display_name": "all-image-2",
            })
        );
    }

    #[test]
    fn upgrades_legacy_openai_format_for_all_image_2_to_openai_images() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/all-image-2".to_string(),
            size: "1K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "newapi_config".to_string(),
                json!({
                    "api_format": "openai",
                    "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                    "request_model": "all-image-2",
                    "display_name": "all-image-2",
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
                "api_format": "openai-images",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "all-image-2",
                "display_name": "all-image-2",
            })
        );
    }

    #[test]
    fn normalizes_legacy_storyboard_aliases() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/gemini-3-pro-image-preview".to_string(),
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
                "api_format": "gemini",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "monkey-image-pro",
                "display_name": "monkey-pro",
            })
        );
    }

    #[test]
    fn normalizes_legacy_all_image_2_aliases_back_to_base_model() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/all-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "newapi_config".to_string(),
                json!({
                    "request_model": "gpt-image-2-4k-high",
                    "display_name": "all-image-2",
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
                "api_format": "openai-images",
                "endpoint_url": OOPII_STORYBOARD_BASE_URL,
                "request_model": "all-image-2",
                "display_name": "all-image-2",
            })
        );
    }

    #[test]
    fn storyboard_all_image_2_uses_sync_newapi_image_requests() {
        let provider = OopiiProvider::new();
        let request = GenerateRequest {
            prompt: "test".to_string(),
            model: "oopii/all-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: None,
        };

        assert!(!provider.should_use_task_resume(&request));
    }
}
