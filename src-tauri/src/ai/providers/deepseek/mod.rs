use std::collections::HashMap;

use serde_json::{json, Value};

use super::compatible::CompatibleProvider;
use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

pub const DEEPSEEK_PROVIDER_ID: &str = "deepseek";
pub const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
pub const DEFAULT_DEEPSEEK_TEXT_MODEL: &str = "deepseek-v4-flash";
pub const DEEPSEEK_PRO_TEXT_MODEL: &str = "deepseek-v4-pro";
const DEEPSEEK_API_FORMAT: &str = "openai-chat";

pub struct DeepSeekProvider {
    compatible: CompatibleProvider,
}

impl DeepSeekProvider {
    pub fn new() -> Self {
        Self {
            compatible: CompatibleProvider::new(),
        }
    }

    fn has_compatible_config(request: &GenerateRequest) -> bool {
        request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .is_some()
    }

    fn strip_provider_prefix(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.trim().to_string())
            .unwrap_or_else(|| model.trim().to_string())
    }

    fn inject_compatible_config(request: &mut GenerateRequest) -> Result<(), AIError> {
        let request_model = Self::strip_provider_prefix(&request.model);
        if request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "DeepSeek request model is required".to_string(),
            ));
        }

        let extra_params = request
            .extra_params
            .get_or_insert_with(HashMap::<String, Value>::new);
        extra_params.insert(
            "compatible_config".to_string(),
            json!({
                "api_format": DEEPSEEK_API_FORMAT,
                "endpoint_url": DEEPSEEK_BASE_URL,
                "request_model": request_model,
                "display_name": request_model,
            }),
        );

        Ok(())
    }
}

impl Default for DeepSeekProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for DeepSeekProvider {
    fn name(&self) -> &str {
        DEEPSEEK_PROVIDER_ID
    }

    fn supports_model(&self, model: &str) -> bool {
        let trimmed = model.trim();
        trimmed.eq_ignore_ascii_case(DEFAULT_DEEPSEEK_TEXT_MODEL)
            || trimmed.eq_ignore_ascii_case(DEEPSEEK_PRO_TEXT_MODEL)
            || trimmed.starts_with("deepseek/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            DEFAULT_DEEPSEEK_TEXT_MODEL.to_string(),
            DEEPSEEK_PRO_TEXT_MODEL.to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        self.compatible.set_api_key(api_key).await
    }

    async fn generate(&self, mut request: GenerateRequest) -> Result<String, AIError> {
        if !Self::has_compatible_config(&request) {
            Self::inject_compatible_config(&mut request)?;
        }

        self.compatible.generate(request).await
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{
        DeepSeekProvider, DEEPSEEK_BASE_URL, DEEPSEEK_PROVIDER_ID, DEEPSEEK_PRO_TEXT_MODEL,
        DEFAULT_DEEPSEEK_TEXT_MODEL,
    };
    use crate::ai::AIProvider;
    use crate::ai::GenerateRequest;

    #[test]
    fn exposes_expected_provider_identity() {
        let provider = DeepSeekProvider::new();
        assert_eq!(provider.name(), DEEPSEEK_PROVIDER_ID);
        assert_eq!(
            provider.list_models(),
            vec![
                DEFAULT_DEEPSEEK_TEXT_MODEL.to_string(),
                DEEPSEEK_PRO_TEXT_MODEL.to_string(),
            ]
        );
    }

    #[test]
    fn supports_built_in_and_prefixed_custom_models() {
        let provider = DeepSeekProvider::new();
        assert!(provider.supports_model(DEFAULT_DEEPSEEK_TEXT_MODEL));
        assert!(provider.supports_model(DEEPSEEK_PRO_TEXT_MODEL));
        assert!(provider.supports_model("deepseek/deepseek-r1"));
        assert!(!provider.supports_model("compatible/storyboard-experimental"));
    }

    #[test]
    fn injects_official_compatible_payload_when_missing() {
        let mut request = GenerateRequest {
            prompt: "test".to_string(),
            model: "deepseek/deepseek-r1".to_string(),
            size: String::new(),
            aspect_ratio: String::new(),
            reference_images: None,
            extra_params: None,
        };

        DeepSeekProvider::inject_compatible_config(&mut request).unwrap();
        let payload = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .cloned()
            .unwrap();

        assert_eq!(
            payload,
            json!({
                "api_format": "openai-chat",
                "endpoint_url": DEEPSEEK_BASE_URL,
                "request_model": "deepseek-r1",
                "display_name": "deepseek-r1",
            })
        );
    }

    #[test]
    fn keeps_existing_compatible_payload_when_present() {
        let request = GenerateRequest {
            prompt: "test".to_string(),
            model: DEFAULT_DEEPSEEK_TEXT_MODEL.to_string(),
            size: String::new(),
            aspect_ratio: String::new(),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "compatible_config".to_string(),
                json!({
                    "api_format": "openai-chat",
                    "endpoint_url": "https://custom.example.com",
                    "request_model": "custom-model",
                    "display_name": "Custom",
                }),
            )])),
        };

        assert!(DeepSeekProvider::has_compatible_config(&request));
    }
}
