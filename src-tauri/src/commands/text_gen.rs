use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tracing::info;

use crate::ai::providers::build_default_providers;
use crate::ai::{GenerateRequest, ProviderRegistry};

static TEXT_REGISTRY: std::sync::OnceLock<ProviderRegistry> = std::sync::OnceLock::new();
static ACTIVE_TEXT_MODEL_STATUS: std::sync::OnceLock<Arc<RwLock<Option<ActiveTextModelStatus>>>> =
    std::sync::OnceLock::new();

fn get_text_registry() -> &'static ProviderRegistry {
    TEXT_REGISTRY.get_or_init(|| {
        let mut registry = ProviderRegistry::new();
        for provider in build_default_providers() {
            registry.register_provider(provider);
        }
        registry
    })
}

fn active_text_model_status() -> &'static Arc<RwLock<Option<ActiveTextModelStatus>>> {
    ACTIVE_TEXT_MODEL_STATUS.get_or_init(|| Arc::new(RwLock::new(None)))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TextGenerationRequestDto {
    pub prompt: String,
    pub model: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub reference_images: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TextGenerationResponseDto {
    pub text: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTextModelStatus {
    pub provider: String,
    pub model: String,
    pub switched_at_ms: i64,
    pub switch_cost_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActiveTextModelStatusDto {
    pub active: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub switched_at_ms: Option<i64>,
    pub switch_cost_ms: Option<u64>,
}

async fn update_active_text_model(provider: &str, model: &str, switch_started_at: Instant) {
    let status = ActiveTextModelStatus {
        provider: provider.to_string(),
        model: model.to_string(),
        switched_at_ms: now_ms(),
        switch_cost_ms: switch_started_at.elapsed().as_millis() as u64,
    };

    let mut guard = active_text_model_status().write().await;
    if let Some(previous) = guard.as_ref() {
        if previous.provider != status.provider || previous.model != status.model {
            info!(
                "[TextModelActivation] deactivate provider={}, model={}, switched_at_ms={}",
                previous.provider, previous.model, previous.switched_at_ms
            );
        }
    }
    info!(
        "[TextModelActivation] activate provider={}, model={}, switched_at_ms={}, switch_cost_ms={}",
        status.provider, status.model, status.switched_at_ms, status.switch_cost_ms
    );
    *guard = Some(status);
}

#[tauri::command]
pub async fn get_active_text_model_status() -> Result<ActiveTextModelStatusDto, String> {
    let guard = active_text_model_status().read().await;
    if let Some(status) = guard.as_ref() {
        Ok(ActiveTextModelStatusDto {
            active: true,
            provider: Some(status.provider.clone()),
            model: Some(status.model.clone()),
            switched_at_ms: Some(status.switched_at_ms),
            switch_cost_ms: Some(status.switch_cost_ms),
        })
    } else {
        Ok(ActiveTextModelStatusDto {
            active: false,
            provider: None,
            model: None,
            switched_at_ms: None,
            switch_cost_ms: None,
        })
    }
}

#[tauri::command]
pub async fn generate_text(
    request: TextGenerationRequestDto,
) -> Result<TextGenerationResponseDto, String> {
    let switch_started_at = Instant::now();
    info!("Generating text with model: {}", request.model);

    let registry = get_text_registry();
    let provider = if let Some(provider_id) = request
        .provider
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        registry
            .get_provider(provider_id)
            .ok_or_else(|| format!("Provider '{}' not found", provider_id))?
    } else {
        registry
            .resolve_provider_for_model(&request.model)
            .or_else(|| registry.get_default_provider())
            .ok_or_else(|| "Provider not found".to_string())?
    };

    let api_key = request
        .api_key
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key not set".to_string())?;

    provider
        .set_api_key(api_key)
        .await
        .map_err(|e| e.to_string())?;

    update_active_text_model(provider.name(), request.model.as_str(), switch_started_at).await;

    let prompt = format!(
        "你是专业的剧本编剧助手。请直接输出内容，不要添加任何前缀或解释。\n\n{}",
        request.prompt
    );

    let req = GenerateRequest {
        prompt,
        model: request.model.clone(),
        size: "".to_string(),
        aspect_ratio: "".to_string(),
        reference_images: request.reference_images.filter(|items| !items.is_empty()),
        extra_params: None,
    };

    let text_result = provider.generate(req).await.map_err(|e| e.to_string())?;

    Ok(TextGenerationResponseDto {
        text: text_result,
        model: request.model,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestConnectionRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestConnectionResponse {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn test_provider_connection(
    request: TestConnectionRequest,
) -> Result<TestConnectionResponse, String> {
    info!("Testing connection for provider: {}", request.provider);

    let registry = get_text_registry();

    // Find provider
    let provider = registry
        .get_provider(&request.provider)
        .ok_or_else(|| format!("Provider '{}' not found", request.provider))?;

    // Set API key
    provider
        .set_api_key(request.api_key.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Try a simple generation
    let test_req = GenerateRequest {
        prompt: "Hello".to_string(),
        model: request.model.clone(),
        size: "".to_string(),
        aspect_ratio: "".to_string(),
        reference_images: None,
        extra_params: None,
    };

    match provider.generate(test_req).await {
        Ok(_) => Ok(TestConnectionResponse {
            success: true,
            message: "连接成功".to_string(),
        }),
        Err(e) => Ok(TestConnectionResponse {
            success: false,
            message: format!("连接失败: {}", e),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn active_text_model_status_should_switch() {
        let started = Instant::now();
        update_active_text_model("alibaba", "qwen-plus", started).await;
        let first = get_active_text_model_status().await.unwrap();
        assert!(first.active);
        assert_eq!(first.provider.as_deref(), Some("alibaba"));
        assert_eq!(first.model.as_deref(), Some("qwen-plus"));

        let started2 = Instant::now();
        update_active_text_model("coding", "qwen3.5-plus", started2).await;
        let second = get_active_text_model_status().await.unwrap();
        assert!(second.active);
        assert_eq!(second.provider.as_deref(), Some("coding"));
        assert_eq!(second.model.as_deref(), Some("qwen3.5-plus"));
    }

    #[tokio::test]
    async fn active_text_model_status_should_handle_concurrent_switch() {
        let task1 = tokio::spawn(async {
            let started = Instant::now();
            update_active_text_model("alibaba", "qwen-turbo", started).await;
        });
        let task2 = tokio::spawn(async {
            let started = Instant::now();
            update_active_text_model("coding", "qwen3.5-plus", started).await;
        });
        let _ = tokio::join!(task1, task2);

        let status = get_active_text_model_status().await.unwrap();
        assert!(status.active);
        let provider = status.provider.unwrap_or_default();
        assert!(provider == "alibaba" || provider == "coding" || provider == "bltcy");
        assert!(status.switch_cost_ms.unwrap_or(0) < 10_000);
    }
}
