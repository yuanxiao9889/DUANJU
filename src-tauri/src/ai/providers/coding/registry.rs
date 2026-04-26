pub struct CodingModelRegistry {
    models: Vec<String>,
}

impl CodingModelRegistry {
    pub fn new() -> Self {
        Self {
            models: vec![
                "qwen3.5-plus".to_string(),
                "qwen3-max-2026-01-23".to_string(),
                "qwen3-coder-next".to_string(),
                "qwen3-coder-plus".to_string(),
                "glm-5".to_string(),
                "glm-4.7".to_string(),
                "kimi-k2.5".to_string(),
                "MiniMax-M2.5".to_string(),
            ],
        }
    }

    pub fn supports(&self, model: &str) -> bool {
        self.models.iter().any(|m| {
            m == model
                || model.starts_with("qwen3")
                || model.starts_with("glm")
                || model.starts_with("kimi")
                || model.starts_with("MiniMax")
                || model.starts_with("ep-")
        })
    }

    pub fn resolve(&self, model: &str) -> Option<String> {
        if self.models.contains(&model.to_string()) {
            Some(model.to_string())
        } else if model.starts_with("qwen3")
            || model.starts_with("glm")
            || model.starts_with("kimi")
            || model.starts_with("MiniMax")
            || model.starts_with("ep-")
        {
            Some(model.to_string())
        } else {
            None
        }
    }

    pub fn list_models(&self) -> Vec<String> {
        self.models.clone()
    }
}

impl Default for CodingModelRegistry {
    fn default() -> Self {
        Self::new()
    }
}
