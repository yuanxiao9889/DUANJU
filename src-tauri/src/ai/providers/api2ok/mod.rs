use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

use super::newapi::NewApiProvider;

const STORYBOARD_MODEL_ID: &str = "api2ok/storyboard-experimental";
const API2OK_BASE_URL: &str = "https://api2ok.qalgoai.com";

#[derive(Debug, Clone, Default, Deserialize)]
struct Api2OkConfigPayload {
    #[serde(default)]
    api_format: String,
    #[serde(default)]
    request_model: String,
    #[serde(default)]
    display_name: String,
}

pub struct Api2OkProvider {
    inner: NewApiProvider,
}

impl Api2OkProvider {
    pub fn new() -> Self {
        Self {
            inner: NewApiProvider::new(),
        }
    }

    fn extract_payload(request: &GenerateRequest) -> Result<Api2OkConfigPayload, AIError> {
        let raw_value = request.extra_params.as_ref().and_then(|params| {
            params
                .get("api2ok_config")
                .cloned()
                .or_else(|| params.get("newapi_config").cloned())
        });

        match raw_value {
            Some(value) => Ok(serde_json::from_value(value)?),
            None => Ok(Api2OkConfigPayload::default()),
        }
    }

    fn strip_provider_prefix(model: &str) -> String {
        model
            .split_once('/')
            .map(|(_, bare)| bare.trim().to_string())
            .unwrap_or_default()
    }

    fn rewrite_message(message: String) -> String {
        message
            .replace("NewAPI", "XGJ API")
            .replace("newapi_config", "api2ok_config")
    }

    fn rewrite_error(error: AIError) -> AIError {
        match error {
            AIError::Provider(message) => AIError::Provider(Self::rewrite_message(message)),
            AIError::InvalidRequest(message) => {
                AIError::InvalidRequest(Self::rewrite_message(message))
            }
            AIError::TaskFailed(message) => AIError::TaskFailed(Self::rewrite_message(message)),
            other => other,
        }
    }

    fn inject_newapi_config(
        request: &mut GenerateRequest,
        payload: Api2OkConfigPayload,
    ) -> Result<(), AIError> {
        let request_model = payload.request_model.trim().to_string();
        let resolved_request_model = if request_model.is_empty() {
            Self::strip_provider_prefix(&request.model)
        } else {
            request_model
        };
        if resolved_request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "API2OK request model is required".to_string(),
            ));
        }

        let api_format = if payload.api_format.trim().is_empty() {
            "openai".to_string()
        } else {
            payload.api_format.trim().to_string()
        };
        let display_name = if payload.display_name.trim().is_empty() {
            resolved_request_model.clone()
        } else {
            payload.display_name.trim().to_string()
        };

        let extra_params = request
            .extra_params
            .get_or_insert_with(HashMap::<String, Value>::new);
        extra_params.insert(
            "newapi_config".to_string(),
            json!({
                "api_format": api_format,
                "endpoint_url": API2OK_BASE_URL,
                "request_model": resolved_request_model,
                "display_name": display_name,
            }),
        );
        Ok(())
    }
}

impl Default for Api2OkProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for Api2OkProvider {
    fn name(&self) -> &str {
        "api2ok"
    }

    fn supports_model(&self, model: &str) -> bool {
        model.starts_with("api2ok/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![STORYBOARD_MODEL_ID.to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        self.inner.set_api_key(api_key).await
    }

    async fn generate(&self, mut request: GenerateRequest) -> Result<String, AIError> {
        let payload = Self::extract_payload(&request)?;
        Self::inject_newapi_config(&mut request, payload)?;
        self.inner
            .generate(request)
            .await
            .map_err(Self::rewrite_error)
    }
}
