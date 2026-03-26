pub struct AlibabaModelRegistry {
    models: Vec<String>,
}

impl AlibabaModelRegistry {
    pub fn new() -> Self {
        Self {
            models: vec![
                "qwen-turbo".to_string(),
                "qwen-plus".to_string(),
                "qwen-max".to_string(),
                "qwen-max-longcontext".to_string(),
                "qwen2.5-0.5b-instruct".to_string(),
                "qwen2.5-1.5b-instruct".to_string(),
                "qwen2.5-3b-instruct".to_string(),
                "qwen2.5-7b-instruct".to_string(),
                "qwen2.5-14b-instruct".to_string(),
                "qwen2.5-32b-instruct".to_string(),
                "qwen2.5-72b-instruct".to_string(),
                "qwen2.5-coder-1.5b-instruct".to_string(),
                "qwen2.5-coder-7b-instruct".to_string(),
                "qwen2.5-coder-32b-instruct".to_string(),
                "llama3-8b-instruct".to_string(),
                "llama3-70b-instruct".to_string(),
                "llama3.1-8b-instruct".to_string(),
                "llama3.1-70b-instruct".to_string(),
                "llama3.1-405b-instruct".to_string(),
                "glm-4-flash".to_string(),
                "glm-4-plus".to_string(),
                "glm-4-flashx".to_string(),
                "glm-4-long".to_string(),
            ],
        }
    }

    pub fn supports(&self, model: &str) -> bool {
        self.models.iter().any(|m| {
            m == model
                || model.starts_with("qwen")
                || model.starts_with("glm")
                || model.starts_with("llama")
        })
    }

    pub fn resolve(&self, model: &str) -> Option<String> {
        if self.models.contains(&model.to_string()) {
            Some(model.to_string())
        } else if model.starts_with("qwen") {
            Some(model.to_string())
        } else if model.starts_with("glm") {
            Some(model.to_string())
        } else if model.starts_with("llama") {
            Some(model.to_string())
        } else {
            None
        }
    }

    pub fn list_models(&self) -> Vec<String> {
        self.models.clone()
    }
}

impl Default for AlibabaModelRegistry {
    fn default() -> Self {
        Self::new()
    }
}
