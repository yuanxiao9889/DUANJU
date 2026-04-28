use base64::{engine::general_purpose::STANDARD, Engine};
use image::imageops::FilterType;
use image::ImageFormat;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::Cursor;
use std::net::IpAddr;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::ai::error::AIError;
use crate::ai::{AIProvider, GenerateRequest};

const STORYBOARD_MODEL_ID: &str = "newapi/storyboard-experimental";
const BANANA_CLIENT_HEADER_VALUE: &str = "comfyui-banana-li";
const JSON_REQUEST_MAX_ATTEMPTS: usize = 2;
const JSON_REQUEST_RETRY_DELAY_MS: u64 = 2_000;
const CURL_JSON_TRANSPORT_MIN_BYTES: usize = 64 * 1024;
const CURL_JSON_TRANSPORT_TIMEOUT_SECONDS: u64 = 1_000;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const FLOW2API_IMAGE_ASPECT_SUFFIXES: [&str; 5] = [
    "-landscape",
    "-portrait",
    "-square",
    "-four-three",
    "-three-four",
];

#[derive(Debug, Clone, Deserialize)]
struct NewApiConfigPayload {
    #[serde(default)]
    api_format: String,
    endpoint_url: String,
    request_model: String,
    #[serde(default)]
    display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NewApiFormat {
    GeminiGenerateContent,
    OpenAiCompatible,
    OpenAiImages,
}

#[derive(Debug, Clone)]
struct NewApiConfig {
    api_format: NewApiFormat,
    endpoint_url: String,
    request_model: String,
    display_name: String,
}

#[derive(Debug, Clone, Copy)]
struct GenerateContentAttempt {
    request_kind: &'static str,
    include_aspect_ratio: bool,
    include_prompt_preferences: bool,
    include_top_p: bool,
    force_png_reference_images: bool,
    resize_reference_images_to_max_dimension: Option<u32>,
    image_size_override: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
struct OpenAiRequestFields {
    request_model: String,
    size: Option<String>,
    aspect_ratio: Option<String>,
    image_size: Option<String>,
    image_backend: Option<String>,
    extra_body: Option<Value>,
    gpt2api_image_size: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenAiImageRoute {
    Generations,
    Edits,
}

pub struct NewApiProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl NewApiProvider {
    pub fn new() -> Self {
        let client = Client::builder()
            .http1_only()
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            client,
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn parse_api_format(input: &str) -> Result<NewApiFormat, AIError> {
        match input.trim() {
            "" => Ok(NewApiFormat::OpenAiCompatible),
            "openai" => Ok(NewApiFormat::OpenAiCompatible),
            "openai-images" => Ok(NewApiFormat::OpenAiImages),
            "gemini" => Ok(NewApiFormat::GeminiGenerateContent),
            "gemini-generate-content" => Ok(NewApiFormat::GeminiGenerateContent),
            "openai-chat" => Ok(NewApiFormat::OpenAiCompatible),
            "openai-edits" => Ok(NewApiFormat::OpenAiCompatible),
            other => Err(AIError::InvalidRequest(format!(
                "Unsupported NewAPI format: {}",
                other
            ))),
        }
    }

    async fn get_api_key(&self) -> Result<String, AIError> {
        self.api_key
            .read()
            .await
            .clone()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))
    }

    fn extract_config(request: &GenerateRequest) -> Result<NewApiConfig, AIError> {
        let raw_value = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("newapi_config"))
            .cloned()
            .ok_or_else(|| {
                AIError::InvalidRequest("Missing newapi_config in request extra_params".to_string())
            })?;
        let payload: NewApiConfigPayload = serde_json::from_value(raw_value)?;
        let endpoint_url = payload.endpoint_url.trim().to_string();
        let request_model = payload.request_model.trim().to_string();
        if endpoint_url.is_empty() {
            return Err(AIError::InvalidRequest(
                "NewAPI endpoint URL is required".to_string(),
            ));
        }
        if request_model.is_empty() {
            return Err(AIError::InvalidRequest(
                "NewAPI request model is required".to_string(),
            ));
        }

        Ok(NewApiConfig {
            api_format: Self::parse_api_format(&payload.api_format)?,
            endpoint_url,
            request_model,
            display_name: payload.display_name.trim().to_string(),
        })
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

    async fn source_to_bytes(source: &str) -> Result<Vec<u8>, AIError> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err(AIError::InvalidRequest("image source is empty".to_string()));
        }

        if let Some((meta, payload)) = trimmed.split_once(',') {
            if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
                return STANDARD.decode(payload).map_err(|error| {
                    AIError::InvalidRequest(format!("invalid base64 payload: {}", error))
                });
            }
        }

        let likely_base64 = trimmed.len() > 256
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
        if likely_base64 {
            return STANDARD.decode(trimmed).map_err(|error| {
                AIError::InvalidRequest(format!("invalid base64 payload: {}", error))
            });
        }

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            let response = reqwest::get(trimmed).await?;
            let bytes = response.bytes().await?;
            return Ok(bytes.to_vec());
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };
        Ok(std::fs::read(path)?)
    }

    async fn source_to_png_bytes(source: &str) -> Result<Vec<u8>, AIError> {
        let original_bytes = Self::source_to_bytes(source).await?;
        let image = image::load_from_memory(&original_bytes).map_err(|error| {
            AIError::InvalidRequest(format!(
                "Failed to decode reference image for NewAPI generateContent: {}",
                error
            ))
        })?;
        let rgb_image = image.to_rgb8();
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(rgb_image)
            .write_to(&mut buffer, ImageFormat::Png)
            .map_err(|error| {
                AIError::Provider(format!(
                    "Failed to re-encode reference image as PNG for NewAPI generateContent: {}",
                    error
                ))
            })?;
        Ok(buffer.into_inner())
    }

    async fn source_to_resized_png_bytes(
        source: &str,
        max_dimension: u32,
    ) -> Result<Vec<u8>, AIError> {
        let original_bytes = Self::source_to_bytes(source).await?;
        let image = image::load_from_memory(&original_bytes).map_err(|error| {
            AIError::InvalidRequest(format!(
                "Failed to decode reference image for NewAPI generateContent: {}",
                error
            ))
        })?;
        let resized = if image.width() > max_dimension || image.height() > max_dimension {
            image.resize(max_dimension, max_dimension, FilterType::Lanczos3)
        } else {
            image
        };
        let rgb_image = resized.to_rgb8();
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(rgb_image)
            .write_to(&mut buffer, ImageFormat::Png)
            .map_err(|error| {
                AIError::Provider(format!(
                    "Failed to re-encode resized reference image as PNG for NewAPI generateContent: {}",
                    error
                ))
            })?;
        Ok(buffer.into_inner())
    }

    fn file_extension_from_source(source: &str) -> &'static str {
        let trimmed = source.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("data:image/jpeg") || lower.starts_with("data:image/jpg") {
            return "jpg";
        }
        if lower.starts_with("data:image/webp") {
            return "webp";
        }
        if lower.starts_with("data:image/gif") {
            return "gif";
        }
        if lower.starts_with("data:image/bmp") {
            return "bmp";
        }
        if lower.starts_with("data:image/avif") {
            return "avif";
        }
        if lower.starts_with("data:image/png") {
            return "png";
        }

        let path = if trimmed.starts_with("file://") {
            PathBuf::from(Self::decode_file_url_path(trimmed))
        } else {
            PathBuf::from(trimmed)
        };

        path.extension()
            .and_then(|raw| raw.to_str())
            .map(|raw| raw.trim().to_ascii_lowercase())
            .filter(|raw| !raw.is_empty())
            .and_then(|raw| match raw.as_str() {
                "jpg" | "jpeg" => Some("jpg"),
                "png" => Some("png"),
                "webp" => Some("webp"),
                "gif" => Some("gif"),
                "bmp" => Some("bmp"),
                "avif" => Some("avif"),
                _ => None,
            })
            .unwrap_or("png")
    }

    fn mime_type_from_extension(extension: &str) -> &'static str {
        match extension {
            "jpg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "avif" => "image/avif",
            _ => "image/png",
        }
    }

    fn resolve_endpoint(endpoint_url: &str, request_model: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/images/generations"))
            .or_else(|| trimmed.strip_suffix("/images/edits"))
            .unwrap_or(trimmed)
            .trim_end_matches('/');
        let encoded_model = urlencoding::encode(request_model.trim()).into_owned();
        if trimmed.ends_with(":generateContent") {
            return trimmed.to_string();
        }
        if trimmed.contains("/models/") {
            return format!("{}:generateContent", trimmed);
        }
        if trimmed.ends_with("/v1beta") {
            return format!("{}/models/{}:generateContent", trimmed, encoded_model);
        }
        if let Some(base_url) = trimmed.strip_suffix("/v1") {
            return format!(
                "{}/v1beta/models/{}:generateContent",
                base_url.trim_end_matches('/'),
                encoded_model
            );
        }
        format!(
            "{}/v1beta/models/{}:generateContent",
            trimmed, encoded_model
        )
    }

    fn resolve_openai_endpoint(endpoint_url: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/images/generations"))
            .or_else(|| trimmed.strip_suffix("/images/edits"))
            .unwrap_or(trimmed)
            .trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            return trimmed.to_string();
        }
        if trimmed.ends_with("/v1") {
            return format!("{}/chat/completions", trimmed);
        }
        format!("{}/v1/chat/completions", trimmed)
    }

    fn resolve_openai_generations_endpoint(endpoint_url: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/images/generations"))
            .or_else(|| trimmed.strip_suffix("/images/edits"))
            .unwrap_or(trimmed)
            .trim_end_matches('/');
        if trimmed.ends_with("/v1") {
            return format!("{}/images/generations", trimmed);
        }
        format!("{}/v1/images/generations", trimmed)
    }

    fn resolve_openai_edits_endpoint(endpoint_url: &str) -> String {
        let trimmed = endpoint_url.trim().trim_end_matches('/');
        let trimmed = trimmed
            .strip_suffix("/chat/completions")
            .or_else(|| trimmed.strip_suffix("/images/generations"))
            .or_else(|| trimmed.strip_suffix("/images/edits"))
            .unwrap_or(trimmed)
            .trim_end_matches('/');
        if trimmed.ends_with("/images/edits") {
            return trimmed.to_string();
        }
        if trimmed.ends_with("/v1") {
            return format!("{}/images/edits", trimmed);
        }
        format!("{}/v1/images/edits", trimmed)
    }

    fn is_internal_result_host(host: &str) -> bool {
        let trimmed = host.trim().trim_matches(['[', ']']);
        if trimmed.is_empty() {
            return false;
        }

        if trimmed.eq_ignore_ascii_case("localhost") {
            return true;
        }

        if let Ok(address) = trimmed.parse::<IpAddr>() {
            return match address {
                IpAddr::V4(ipv4) => {
                    ipv4.is_private()
                        || ipv4.is_loopback()
                        || ipv4.is_link_local()
                        || ipv4.is_unspecified()
                }
                IpAddr::V6(ipv6) => {
                    ipv6.is_loopback()
                        || ipv6.is_unspecified()
                        || ipv6.is_unicast_link_local()
                        || ipv6.is_unique_local()
                }
            };
        }

        trimmed.ends_with(".local") || trimmed.ends_with(".internal") || !trimmed.contains('.')
    }

    fn normalize_image_source(image_source: String, endpoint_url: &str) -> String {
        let trimmed = image_source.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("data:")
            || !(trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        {
            return image_source;
        }

        let source_url = match reqwest::Url::parse(trimmed) {
            Ok(url) => url,
            Err(_) => return image_source,
        };
        let host = match source_url.host_str() {
            Some(host) if Self::is_internal_result_host(host) => host,
            _ => return image_source,
        };

        let mut endpoint_origin = match reqwest::Url::parse(endpoint_url.trim()) {
            Ok(url) => url,
            Err(_) => return image_source,
        };
        endpoint_origin.set_path("/");
        endpoint_origin.set_query(None);
        endpoint_origin.set_fragment(None);

        let mut rewritten = endpoint_origin;
        rewritten.set_path(source_url.path());
        rewritten.set_query(source_url.query());
        rewritten.set_fragment(source_url.fragment());

        let normalized = rewritten.to_string();
        info!(
            "[NewAPI Result] rewrote internal image host {} -> {}",
            host, normalized
        );
        normalized
    }

    fn normalize_flow2api_image_request_model(request_model: &str) -> String {
        let trimmed = request_model.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        let lower = trimmed.to_ascii_lowercase();
        let looks_like_google_image_model = lower.contains("imagen")
            || (lower.contains("gemini") && (lower.contains("image") || lower.contains("preview")));
        if !looks_like_google_image_model {
            return trimmed.to_string();
        }

        let without_size = lower
            .strip_suffix("-1k")
            .or_else(|| lower.strip_suffix("-2k"))
            .or_else(|| lower.strip_suffix("-4k"))
            .unwrap_or(lower.as_str());

        for suffix in FLOW2API_IMAGE_ASPECT_SUFFIXES {
            if let Some(normalized) = without_size.strip_suffix(suffix) {
                return normalized.to_string();
            }
        }

        without_size.to_string()
    }

    fn resolve_gemini_image_size(request_model: &str, size: &str) -> Option<&'static str> {
        let lower_model = request_model.trim().to_ascii_lowercase();
        let supports_image_size = lower_model.contains("nano-banana-pro")
            || lower_model.contains("3.")
            || lower_model.contains("preview");
        if !supports_image_size {
            return None;
        }

        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1K"),
            "2K" => Some("2K"),
            "4K" => Some("4K"),
            _ => None,
        }
    }

    fn parse_aspect_ratio(value: &str) -> Option<f32> {
        let (raw_w, raw_h) = value.split_once(':')?;
        let width = raw_w.trim().parse::<f32>().ok()?;
        let height = raw_h.trim().parse::<f32>().ok()?;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }
        Some(width / height)
    }

    fn resolve_openai_size(size: &str, aspect_ratio: &str) -> Option<String> {
        let normalized_size = size.trim().to_ascii_uppercase();
        let ratio = Self::parse_aspect_ratio(aspect_ratio).unwrap_or(1.0);
        let is_square = (ratio - 1.0).abs() < 0.12;

        let resolved = match normalized_size.as_str() {
            "1K" => {
                if is_square {
                    "1024x1024"
                } else if ratio > 1.0 {
                    "1536x1024"
                } else {
                    "1024x1536"
                }
            }
            "2K" => {
                if is_square {
                    "2048x2048"
                } else if ratio > 1.0 {
                    "2304x1536"
                } else {
                    "1536x2304"
                }
            }
            "4K" => {
                if is_square {
                    "4096x4096"
                } else if ratio > 1.0 {
                    "3072x2048"
                } else {
                    "2048x3072"
                }
            }
            _ => return None,
        };

        Some(resolved.to_string())
    }

    fn is_gpt2api_image_request_model_alias(request_model: &str) -> bool {
        let normalized = request_model.trim().to_ascii_lowercase();
        matches!(
            normalized.as_str(),
            "gpt-image-2-2k-low"
                | "gpt-image-2-2k-medium"
                | "gpt-image-2-2k-high"
                | "gpt-image-2-4k-low"
                | "gpt-image-2-4k-medium"
                | "gpt-image-2-4k-high"
        )
    }

    fn resolve_gpt2api_resolution(request_model: &str, size: &str) -> Option<&'static str> {
        match size.trim().to_ascii_uppercase().as_str() {
            "1K" => Some("1K"),
            "2K" => Some("2K"),
            "4K" => Some("4K"),
            _ => {
                let normalized = request_model.trim().to_ascii_lowercase();
                if normalized.starts_with("gpt-image-2-2k-") {
                    Some("2K")
                } else if normalized.starts_with("gpt-image-2-4k-") {
                    Some("4K")
                } else if normalized == "gpt-image-2" || normalized.starts_with("gpt-image-2-1k-") {
                    Some("1K")
                } else {
                    None
                }
            }
        }
    }

    fn resolve_gpt2api_image_size(
        request_model: &str,
        size: &str,
        aspect_ratio: &str,
    ) -> Option<&'static str> {
        let resolution = Self::resolve_gpt2api_resolution(request_model, size)?;
        let normalized_aspect_ratio = aspect_ratio.trim();

        match (resolution, normalized_aspect_ratio) {
            ("1K", "1:1") => Some("1024x1024"),
            ("1K", "5:4") => Some("1120x896"),
            ("1K", "9:16") => Some("720x1280"),
            ("1K", "21:9") => Some("1456x624"),
            ("1K", "16:9") => Some("1280x720"),
            ("1K", "4:3") => Some("1152x864"),
            ("1K", "3:2") => Some("1248x832"),
            ("1K", "4:5") => Some("896x1120"),
            ("1K", "3:4") => Some("864x1152"),
            ("1K", "2:3") => Some("832x1248"),
            ("2K", "1:1") => Some("2048x2048"),
            ("2K", "5:4") => Some("2240x1792"),
            ("2K", "9:16") => Some("1440x2560"),
            ("2K", "21:9") => Some("3024x1296"),
            ("2K", "16:9") => Some("2560x1440"),
            ("2K", "4:3") => Some("2304x1728"),
            ("2K", "3:2") => Some("2496x1664"),
            ("2K", "4:5") => Some("1792x2240"),
            ("2K", "3:4") => Some("1728x2304"),
            ("2K", "2:3") => Some("1664x2496"),
            ("4K", "1:1") => Some("2880x2880"),
            ("4K", "5:4") => Some("3200x2560"),
            ("4K", "9:16") => Some("2160x3840"),
            ("4K", "21:9") => Some("3696x1584"),
            ("4K", "16:9") => Some("3840x2160"),
            ("4K", "4:3") => Some("3264x2448"),
            ("4K", "3:2") => Some("3504x2336"),
            ("4K", "4:5") => Some("2560x3200"),
            ("4K", "3:4") => Some("2448x3264"),
            ("4K", "2:3") => Some("2336x3504"),
            _ => None,
        }
    }

    fn build_gpt2api_prompt_text(prompt: &str, image_size: &str) -> String {
        let size_tag = format!("[__gpt2api_image_size={}__]", image_size);
        let trimmed_prompt = prompt.trim();
        if trimmed_prompt.is_empty() {
            return size_tag;
        }

        format!("{trimmed_prompt}\n\n{size_tag}")
    }

    fn resolve_openai_request_fields(
        request: &GenerateRequest,
        config_request_model: &str,
    ) -> Result<OpenAiRequestFields, AIError> {
        if Self::is_gpt2api_image_request_model_alias(config_request_model) {
            let image_size = Self::resolve_gpt2api_image_size(
                config_request_model,
                &request.size,
                &request.aspect_ratio,
            )
            .ok_or_else(|| {
                AIError::InvalidRequest(format!(
                    "Unsupported gpt-image-2 size/aspect combination: size={}, aspect_ratio={}",
                    request.size.trim(),
                    request.aspect_ratio.trim()
                ))
            })?;

            return Ok(OpenAiRequestFields {
                request_model: config_request_model.trim().to_string(),
                size: None,
                aspect_ratio: None,
                image_size: None,
                image_backend: Some("auto".to_string()),
                extra_body: None,
                gpt2api_image_size: Some(image_size.to_string()),
            });
        }

        let request_model = Self::normalize_flow2api_image_request_model(config_request_model);
        let is_flow2api_image_model = Self::is_flow2api_image_request_model(&request_model);

        Ok(OpenAiRequestFields {
            request_model: request_model.clone(),
            size: if is_flow2api_image_model {
                None
            } else {
                Self::resolve_openai_size(&request.size, &request.aspect_ratio)
            },
            aspect_ratio: if is_flow2api_image_model || request.aspect_ratio.trim().is_empty() {
                None
            } else {
                Some(request.aspect_ratio.trim().to_string())
            },
            image_size: if is_flow2api_image_model {
                None
            } else {
                Self::resolve_gemini_image_size(&request_model, &request.size)
                    .map(|value| value.to_string())
            },
            image_backend: None,
            extra_body: Self::build_flow2api_openai_extra_body(request, &request_model),
            gpt2api_image_size: None,
        })
    }

    fn build_flow2api_openai_extra_body(
        request: &GenerateRequest,
        request_model: &str,
    ) -> Option<Value> {
        if !Self::is_flow2api_image_request_model(request_model) {
            return None;
        }

        let mut image_config = serde_json::Map::new();
        if !request.aspect_ratio.trim().is_empty() {
            image_config.insert(
                "aspect_ratio".to_string(),
                Value::String(request.aspect_ratio.trim().to_string()),
            );
        }
        if let Some(image_size) = Self::resolve_gemini_image_size(request_model, &request.size) {
            image_config.insert(
                "image_size".to_string(),
                Value::String(image_size.to_string()),
            );
        }

        if image_config.is_empty() {
            return None;
        }

        Some(json!({
            "google": {
                "image_config": Value::Object(image_config),
            }
        }))
    }

    fn has_reference_images(request: &GenerateRequest) -> bool {
        request
            .reference_images
            .as_ref()
            .map(|images| !images.is_empty())
            .unwrap_or(false)
    }

    fn resolve_openai_images_route(reference_image_count: usize) -> OpenAiImageRoute {
        if reference_image_count > 0 {
            OpenAiImageRoute::Edits
        } else {
            OpenAiImageRoute::Generations
        }
    }

    fn build_prompt_text(request: &GenerateRequest) -> String {
        let mut lines = vec![request.prompt.trim().to_string()];

        if !request.size.trim().is_empty() {
            lines.push(format!("Preferred size: {}.", request.size.trim()));
        }

        if !request.aspect_ratio.trim().is_empty() {
            lines.push(format!(
                "Preferred aspect ratio: {}.",
                request.aspect_ratio.trim()
            ));
        }

        lines
            .into_iter()
            .filter(|line| !line.is_empty())
            .collect::<Vec<String>>()
            .join("\n\n")
    }

    fn build_openai_chat_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> String {
        if let Some(image_size) = fields.gpt2api_image_size.as_deref() {
            return Self::build_gpt2api_prompt_text(&request.prompt, image_size);
        }

        Self::build_prompt_text(request)
    }

    fn build_openai_edits_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> String {
        if let Some(image_size) = fields.gpt2api_image_size.as_deref() {
            return Self::build_gpt2api_prompt_text(&request.prompt, image_size);
        }

        request.prompt.clone()
    }

    fn build_openai_generations_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> String {
        if let Some(image_size) = fields.gpt2api_image_size.as_deref() {
            return Self::build_gpt2api_prompt_text(&request.prompt, image_size);
        }

        request.prompt.trim().to_string()
    }

    fn build_openai_chat_body(
        fields: &OpenAiRequestFields,
        message_content: Value,
    ) -> serde_json::Map<String, Value> {
        let mut body = serde_json::Map::new();
        body.insert(
            "model".to_string(),
            Value::String(fields.request_model.clone()),
        );
        body.insert(
            "messages".to_string(),
            json!([{
                "role": "user",
                "content": message_content,
            }]),
        );
        body.insert("stream".to_string(), Value::Bool(false));

        if let Some(size) = fields.size.as_ref() {
            body.insert("size".to_string(), Value::String(size.clone()));
        }
        if let Some(aspect_ratio) = fields.aspect_ratio.as_ref() {
            body.insert(
                "aspect_ratio".to_string(),
                Value::String(aspect_ratio.clone()),
            );
        }
        if let Some(image_size) = fields.image_size.as_ref() {
            body.insert("image_size".to_string(), Value::String(image_size.clone()));
        }
        if let Some(image_backend) = fields.image_backend.as_ref() {
            body.insert(
                "image_backend".to_string(),
                Value::String(image_backend.clone()),
            );
        }
        if let Some(extra_body) = fields.extra_body.as_ref() {
            body.insert("extra_body".to_string(), extra_body.clone());
        }

        body
    }

    fn build_openai_generations_body(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> serde_json::Map<String, Value> {
        let mut body = serde_json::Map::new();
        body.insert(
            "model".to_string(),
            Value::String(fields.request_model.clone()),
        );
        body.insert(
            "prompt".to_string(),
            Value::String(Self::build_openai_generations_prompt_text(request, fields)),
        );
        body.insert("n".to_string(), json!(1));

        if let Some(size) = fields.size.as_ref() {
            body.insert("size".to_string(), Value::String(size.clone()));
        }
        if let Some(aspect_ratio) = fields.aspect_ratio.as_ref() {
            body.insert(
                "aspect_ratio".to_string(),
                Value::String(aspect_ratio.clone()),
            );
        }
        if let Some(image_size) = fields.image_size.as_ref() {
            body.insert("image_size".to_string(), Value::String(image_size.clone()));
        }
        if let Some(image_backend) = fields.image_backend.as_ref() {
            body.insert(
                "image_backend".to_string(),
                Value::String(image_backend.clone()),
            );
        }
        if let Some(extra_body) = fields.extra_body.as_ref() {
            body.insert("extra_body".to_string(), extra_body.clone());
        }

        body
    }

    fn build_openai_images_edits_text_fields(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> Vec<(String, String)> {
        let mut text_fields = vec![
            ("model".to_string(), fields.request_model.clone()),
            (
                "prompt".to_string(),
                Self::build_openai_edits_prompt_text(request, fields),
            ),
            ("n".to_string(), "1".to_string()),
        ];

        if let Some(size) = fields.size.as_ref() {
            text_fields.push(("size".to_string(), size.clone()));
        }
        if let Some(image_size) = fields.image_size.as_ref() {
            text_fields.push(("image_size".to_string(), image_size.clone()));
        }
        if let Some(aspect_ratio) = fields.aspect_ratio.as_ref() {
            text_fields.push(("aspect_ratio".to_string(), aspect_ratio.clone()));
        }
        if let Some(image_backend) = fields.image_backend.as_ref() {
            text_fields.push(("image_backend".to_string(), image_backend.clone()));
        }

        text_fields
    }

    fn build_openai_images_edits_image_field_names(
        reference_image_count: usize,
    ) -> Vec<&'static str> {
        vec!["image"; reference_image_count]
    }

    fn build_generate_content_prompt(
        request: &GenerateRequest,
        include_preferences: bool,
    ) -> String {
        let prompt = request.prompt.trim();
        if !include_preferences {
            return prompt.to_string();
        }

        let mut suffix_parts = Vec::new();
        if !request.size.trim().is_empty() {
            suffix_parts.push(format!("size: {}", request.size.trim()));
        }
        if !request.aspect_ratio.trim().is_empty() {
            suffix_parts.push(format!("aspect ratio: {}", request.aspect_ratio.trim()));
        }

        if suffix_parts.is_empty() {
            return prompt.to_string();
        }
        if prompt.is_empty() {
            return format!("[{}]", suffix_parts.join(", "));
        }

        format!("{} [{}]", prompt, suffix_parts.join(", "))
    }

    async fn source_to_data_url(source: &str) -> Result<String, AIError> {
        let trimmed = source.trim();
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Ok(trimmed.to_string());
        }
        if trimmed.starts_with("data:") {
            return Ok(trimmed.to_string());
        }

        let extension = Self::file_extension_from_source(trimmed);
        let mime_type = Self::mime_type_from_extension(extension);
        let bytes = Self::source_to_bytes(trimmed).await?;
        Ok(format!(
            "data:{};base64,{}",
            mime_type,
            STANDARD.encode(bytes)
        ))
    }

    fn extract_error_message(payload: &Value) -> Option<String> {
        [
            "/error/message",
            "/error/status",
            "/message",
            "/detail",
            "/details",
            "/msg",
            "/choices/0/message/refusal",
        ]
        .iter()
        .find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn is_json_parse_error(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        normalized.contains("unexpected end of json input")
            || normalized.contains("unterminated string starting at")
            || normalized.contains("json decode error")
            || normalized.contains("json_invalid")
            || normalized.contains("eof while parsing")
    }

    fn is_timeout_message(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        normalized.contains("gateway time-out")
            || normalized.contains("gateway timeout")
            || normalized.contains("request timeout")
            || normalized.contains("operation timed out")
            || normalized.contains("timed out")
            || normalized.contains("deadline exceeded")
            || normalized.contains("context deadline exceeded")
    }

    fn should_continue_generate_content_attempt(message: &str) -> bool {
        if Self::is_timeout_message(message) {
            return false;
        }

        let normalized = message.trim().to_ascii_lowercase();
        Self::is_json_parse_error(message)
            || normalized.contains("failed to extract image from upstream response")
            || normalized.contains("upstream_error")
            || (normalized.contains("400 bad request")
                && (normalized.contains("<html>") || normalized.contains("nginx")))
    }

    fn should_retry_openai_chat_with_openai_edits(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        Self::is_json_parse_error(message)
            || (normalized.contains("image_url") && normalized.contains("invalid"))
            || (normalized.contains("unsupported") && normalized.contains("image"))
            || (normalized.contains("invalid") && normalized.contains("image"))
    }

    fn should_retry_openai_request_with_generate_content(message: &str) -> bool {
        let normalized = message.trim().to_ascii_lowercase();
        Self::is_json_parse_error(message)
            || normalized.contains("invalid json payload received")
            || normalized.contains("unable to parse number")
            || (normalized.contains("multipart") && normalized.contains("invalid"))
            || (normalized.contains("multipart") && normalized.contains("unsupported"))
            || (normalized.contains("form-data") && normalized.contains("unsupported"))
            || (normalized.contains("content-type") && normalized.contains("unsupported"))
            || (normalized.contains("upstream_error")
                && (normalized.contains("invalid json")
                    || normalized.contains("unable to parse")
                    || normalized.contains("multipart")
                    || normalized.contains("form-data")))
    }

    fn is_flow2api_image_request_model(request_model: &str) -> bool {
        let normalized = Self::normalize_flow2api_image_request_model(request_model);
        let lower = normalized.to_ascii_lowercase();
        lower.contains("imagen")
            || (lower.contains("gemini") && (lower.contains("image") || lower.contains("preview")))
    }

    fn should_retry_generate_content_payload(payload: &Value) -> bool {
        Self::extract_error_message(payload)
            .map(|message| Self::should_continue_generate_content_attempt(&message))
            .unwrap_or(false)
    }

    fn is_retryable_http_status(status: reqwest::StatusCode) -> bool {
        matches!(
            status.as_u16(),
            408 | 409 | 425 | 429 | 500 | 502 | 503 | 504
        )
    }

    fn is_timeout_http_status(status: reqwest::StatusCode) -> bool {
        matches!(status.as_u16(), 408 | 504)
    }

    fn should_retry_http_status(status: reqwest::StatusCode) -> bool {
        Self::is_retryable_http_status(status) && !Self::is_timeout_http_status(status)
    }

    fn should_retry_transport_error(error: &reqwest::Error) -> bool {
        error.is_connect() && !error.is_timeout()
    }

    fn extract_markdown_link(text: &str, image_only: bool) -> Option<String> {
        let bytes = text.as_bytes();
        let mut index = 0usize;

        while index + 3 < bytes.len() {
            if bytes[index] == b'[' {
                let is_image = index > 0 && bytes[index - 1] == b'!';
                if image_only && !is_image {
                    index += 1;
                    continue;
                }

                if let Some(label_end_rel) = text[index..].find("](") {
                    let url_start = index + label_end_rel + 2;
                    if let Some(url_end_rel) = text[url_start..].find(')') {
                        let url = text[url_start..url_start + url_end_rel].trim();
                        if !url.is_empty()
                            && (url.starts_with("http://")
                                || url.starts_with("https://")
                                || url.starts_with("data:"))
                        {
                            return Some(url.to_string());
                        }
                    }
                }
            }

            index += 1;
        }

        None
    }

    fn extract_inline_url(text: &str) -> Option<String> {
        let markers = ["https://", "http://", "data:"];
        let start = markers
            .iter()
            .filter_map(|marker| text.find(marker))
            .min()?;
        let tail = &text[start..];
        let end = tail
            .find(|ch: char| ch.is_whitespace() || ch == ')' || ch == ']' || ch == '>' || ch == '"')
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ','].as_ref()).trim();
        if url.is_empty() {
            return None;
        }
        Some(url.to_string())
    }

    fn extract_image_source_from_text(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("data:")
        {
            return Some(trimmed.to_string());
        }

        Self::extract_markdown_link(trimmed, true)
            .or_else(|| Self::extract_markdown_link(trimmed, false))
            .or_else(|| Self::extract_inline_url(trimmed))
    }

    fn extract_first_image(payload: &Value) -> Option<String> {
        let direct_url_pointers = [
            "/generated_assets/upscaled_image/local_url",
            "/generated_assets/upscaled_image/url",
            "/generated_assets/final_image_url",
            "/url",
            "/result/url",
            "/data/0/url",
            "/choices/0/message/images/0/url",
            "/choices/0/message/image/url",
            "/choices/0/message/output/0/image_url/url",
        ];
        if let Some(url) = direct_url_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }) {
            return Some(url);
        }

        let direct_b64_pointers = [
            "/data/0/b64_json",
            "/choices/0/message/images/0/b64_json",
            "/choices/0/message/image/b64_json",
        ];
        if let Some(data) = direct_b64_pointers.iter().find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        }) {
            return Some(format!("data:image/png;base64,{}", data));
        }

        if let Some(message_content) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
        {
            if let Some(image_source) = Self::extract_image_source_from_text(message_content) {
                return Some(image_source);
            }
        }

        if let Some(content_parts) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_array)
        {
            for part in content_parts {
                if let Some(url) = part
                    .pointer("/image_url/url")
                    .or_else(|| part.pointer("/image_url"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(url.to_string());
                }
                if let Some(data) = part
                    .pointer("/b64_json")
                    .or_else(|| part.pointer("/image_base64"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(format!("data:image/png;base64,{}", data));
                }
                if let Some(text) = part
                    .pointer("/text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if let Some(image_source) = Self::extract_image_source_from_text(text) {
                        return Some(image_source);
                    }
                }
            }
        }

        if let Some(parts) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            for part in parts {
                if let Some(uri) = part
                    .pointer("/fileData/fileUri")
                    .or_else(|| part.pointer("/file_data/file_uri"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Some(uri.to_string());
                }

                if let Some(data) = part
                    .pointer("/inlineData/data")
                    .or_else(|| part.pointer("/inline_data/data"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    let mime_type = part
                        .pointer("/inlineData/mimeType")
                        .or_else(|| part.pointer("/inline_data/mime_type"))
                        .and_then(Value::as_str)
                        .unwrap_or("image/png");
                    return Some(format!("data:{};base64,{}", mime_type, data));
                }

                if let Some(text) = part
                    .pointer("/text")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    if let Some(image_source) = Self::extract_image_source_from_text(text) {
                        return Some(image_source);
                    }
                }
            }
        }

        None
    }

    fn extract_text(payload: &Value) -> Option<String> {
        if let Some(content) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(content.to_string());
        }

        if let Some(content_parts) = payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_array)
        {
            let text_parts = content_parts
                .iter()
                .filter_map(|part| {
                    part.pointer("/text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<String>>();

            if !text_parts.is_empty() {
                return Some(text_parts.join("\n"));
            }
        }

        if let Some(parts) = payload
            .pointer("/candidates/0/content/parts")
            .and_then(Value::as_array)
        {
            let text_parts = parts
                .iter()
                .filter_map(|part| {
                    part.pointer("/text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<String>>();

            if !text_parts.is_empty() {
                return Some(text_parts.join("\n"));
            }
        }

        [
            "/choices/0/text",
            "/output_text",
            "/output/text",
            "/text",
            "/response/text",
            "/data/text",
        ]
        .iter()
        .find_map(|pointer| {
            payload
                .pointer(pointer)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn should_use_curl_json_transport(request_kind: &str, payload_len: usize) -> bool {
        payload_len >= CURL_JSON_TRANSPORT_MIN_BYTES
            && (request_kind.starts_with("openai-chat")
                || request_kind.starts_with("generateContent"))
    }

    async fn send_json_request_with_curl(
        endpoint: String,
        api_key: String,
        payload: Vec<u8>,
        request_kind: String,
    ) -> Result<(reqwest::StatusCode, String), AIError> {
        let request_kind_for_join = request_kind.clone();
        tokio::task::spawn_blocking(move || {
            let request_file_path = std::env::temp_dir().join(format!(
                "storyboard-copilot-newapi-request-{}.json",
                uuid::Uuid::new_v4()
            ));
            let response_file_path = std::env::temp_dir().join(format!(
                "storyboard-copilot-newapi-response-{}.txt",
                uuid::Uuid::new_v4()
            ));

            let result = (|| {
                fs::write(&request_file_path, &payload).map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to persist NewAPI {} curl payload: {}",
                        request_kind, error
                    ))
                })?;

                let curl_binary = if cfg!(target_os = "windows") {
                    "curl.exe"
                } else {
                    "curl"
                };
                let mut command = Command::new(curl_binary);
                #[cfg(target_os = "windows")]
                command.creation_flags(CREATE_NO_WINDOW);
                let output = command
                    .arg("-sS")
                    .arg("--http1.1")
                    .arg("--connect-timeout")
                    .arg("30")
                    .arg("--max-time")
                    .arg(CURL_JSON_TRANSPORT_TIMEOUT_SECONDS.to_string())
                    .arg("-X")
                    .arg("POST")
                    .arg(&endpoint)
                    .arg("-H")
                    .arg(format!("Authorization: Bearer {}", api_key))
                    .arg("-H")
                    .arg("Content-Type: application/json")
                    .arg("--data-binary")
                    .arg(format!("@{}", request_file_path.display()))
                    .arg("-o")
                    .arg(&response_file_path)
                    .arg("-w")
                    .arg("%{http_code}")
                    .output()
                    .map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to execute curl for NewAPI {} request: {}",
                            request_kind, error
                        ))
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return Err(AIError::Provider(format!(
                        "curl transport failed for NewAPI {} request: {}",
                        request_kind,
                        if stderr.is_empty() {
                            format!("exit status {}", output.status)
                        } else {
                            stderr
                        }
                    )));
                }

                let status_code = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<u16>()
                    .map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to parse curl HTTP status for NewAPI {} request: {}",
                            request_kind, error
                        ))
                    })?;
                let response_bytes = fs::read(&response_file_path).map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to read curl response for NewAPI {} request: {}",
                        request_kind, error
                    ))
                })?;
                let response_text = String::from_utf8_lossy(&response_bytes).into_owned();
                let status = reqwest::StatusCode::from_u16(status_code).map_err(|error| {
                    AIError::Provider(format!(
                        "Invalid curl HTTP status for NewAPI {} request: {}",
                        request_kind, error
                    ))
                })?;

                Ok((status, response_text))
            })();

            let _ = fs::remove_file(&request_file_path);
            let _ = fs::remove_file(&response_file_path);
            result
        })
        .await
        .map_err(|error| {
            AIError::Provider(format!(
                "curl transport join error for NewAPI {} request: {}",
                request_kind_for_join, error
            ))
        })?
    }

    async fn send_json_request(
        &self,
        endpoint: &str,
        api_key: &str,
        body: Value,
        request_kind: &str,
    ) -> Result<Value, AIError> {
        let payload = serde_json::to_vec(&body).map_err(|error| {
            AIError::Provider(format!(
                "Failed to serialize NewAPI {} request body: {}",
                request_kind, error
            ))
        })?;
        info!(
            "[NewAPI] {} request body bytes: {}",
            request_kind,
            payload.len()
        );
        let use_curl_transport = Self::should_use_curl_json_transport(request_kind, payload.len());
        if use_curl_transport {
            info!(
                "[NewAPI] {} request body exceeded {} bytes, preferring curl transport",
                request_kind, CURL_JSON_TRANSPORT_MIN_BYTES
            );
        }
        for attempt in 1..=JSON_REQUEST_MAX_ATTEMPTS {
            if use_curl_transport {
                match Self::send_json_request_with_curl(
                    endpoint.to_string(),
                    api_key.to_string(),
                    payload.clone(),
                    request_kind.to_string(),
                )
                .await
                {
                    Ok((status, response_text)) => {
                        info!(
                            "[NewAPI] {} attempt {}/{} {} -> {} (curl)",
                            request_kind, attempt, JSON_REQUEST_MAX_ATTEMPTS, endpoint, status
                        );
                        info!(
                            "[NewAPI] {} attempt {}/{} response (curl): {}",
                            request_kind, attempt, JSON_REQUEST_MAX_ATTEMPTS, response_text
                        );
                        if !status.is_success() {
                            if attempt < JSON_REQUEST_MAX_ATTEMPTS
                                && Self::should_retry_http_status(status)
                            {
                                warn!(
                                    "[NewAPI] {} attempt {}/{} hit retryable status {} via curl. Retrying after {}ms.",
                                    request_kind,
                                    attempt,
                                    JSON_REQUEST_MAX_ATTEMPTS,
                                    status,
                                    JSON_REQUEST_RETRY_DELAY_MS
                                );
                                sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                                continue;
                            }
                            return Err(AIError::Provider(format!(
                                "NewAPI {} request failed {}: {}",
                                request_kind, status, response_text
                            )));
                        }

                        return serde_json::from_str(&response_text).map_err(|error| {
                            AIError::Provider(format!(
                                "Failed to parse NewAPI {} response: {}. Response was: {}",
                                request_kind, error, response_text
                            ))
                        });
                    }
                    Err(error) => {
                        if matches!(&error, AIError::Provider(message) if Self::is_timeout_message(message))
                        {
                            warn!(
                                "[NewAPI] {} attempt {}/{} curl transport hit a timeout-like failure. Not falling back to reqwest to avoid duplicate submissions: {}",
                                request_kind,
                                attempt,
                                JSON_REQUEST_MAX_ATTEMPTS,
                                error
                            );
                            return Err(error);
                        }
                        warn!(
                            "[NewAPI] {} attempt {}/{} curl transport unavailable, falling back to reqwest: {}",
                            request_kind, attempt, JSON_REQUEST_MAX_ATTEMPTS, error
                        );
                    }
                }
            }

            let response = self
                .client
                .post(endpoint)
                .version(reqwest::Version::HTTP_11)
                .header("Accept", "application/json")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("X-API-Key", api_key)
                .header("X-Banana-Client", BANANA_CLIENT_HEADER_VALUE)
                .header("Content-Type", "application/json")
                .body(payload.clone())
                .send()
                .await;

            match response {
                Ok(response) => {
                    let status = response.status();
                    let response_text = response.text().await?;
                    info!(
                        "[NewAPI] {} attempt {}/{} {} -> {}",
                        request_kind, attempt, JSON_REQUEST_MAX_ATTEMPTS, endpoint, status
                    );
                    info!(
                        "[NewAPI] {} attempt {}/{} response: {}",
                        request_kind, attempt, JSON_REQUEST_MAX_ATTEMPTS, response_text
                    );
                    if !status.is_success() {
                        if attempt < JSON_REQUEST_MAX_ATTEMPTS
                            && Self::should_retry_http_status(status)
                        {
                            warn!(
                                "[NewAPI] {} attempt {}/{} hit retryable status {}. Retrying after {}ms.",
                                request_kind,
                                attempt,
                                JSON_REQUEST_MAX_ATTEMPTS,
                                status,
                                JSON_REQUEST_RETRY_DELAY_MS
                            );
                            sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                            continue;
                        }
                        return Err(AIError::Provider(format!(
                            "NewAPI {} request failed {}: {}",
                            request_kind, status, response_text
                        )));
                    }

                    return serde_json::from_str(&response_text).map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to parse NewAPI {} response: {}. Response was: {}",
                            request_kind, error, response_text
                        ))
                    });
                }
                Err(error)
                    if attempt < JSON_REQUEST_MAX_ATTEMPTS
                        && Self::should_retry_transport_error(&error) =>
                {
                    warn!(
                        "[NewAPI] {} attempt {}/{} hit retryable transport error: {}. Retrying after {}ms.",
                        request_kind,
                        attempt,
                        JSON_REQUEST_MAX_ATTEMPTS,
                        error,
                        JSON_REQUEST_RETRY_DELAY_MS
                    );
                    sleep(Duration::from_millis(JSON_REQUEST_RETRY_DELAY_MS)).await;
                }
                Err(error) => return Err(error.into()),
            }
        }

        Err(AIError::Provider(format!(
            "NewAPI {} request exhausted {} attempts without a response",
            request_kind, JSON_REQUEST_MAX_ATTEMPTS
        )))
    }

    async fn send_multipart_request(
        &self,
        endpoint: &str,
        api_key: &str,
        form: Form,
        request_kind: &str,
    ) -> Result<Value, AIError> {
        let response = self
            .client
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("X-API-Key", api_key)
            .header("X-Banana-Client", BANANA_CLIENT_HEADER_VALUE)
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let response_text = response.text().await?;
        info!("[NewAPI] {} {} -> {}", request_kind, endpoint, status);
        info!("[NewAPI] {} response: {}", request_kind, response_text);
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "NewAPI {} request failed {}: {}",
                request_kind, status, response_text
            )));
        }

        Ok(serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse NewAPI {} response: {}. Response was: {}",
                request_kind, error, response_text
            ))
        })?)
    }

    async fn build_generate_content_image_part(
        source: &str,
        force_png_reference_images: bool,
        resize_reference_images_to_max_dimension: Option<u32>,
    ) -> Result<Value, AIError> {
        let (bytes, mime_type) =
            if let Some(max_dimension) = resize_reference_images_to_max_dimension {
                (
                    Self::source_to_resized_png_bytes(source, max_dimension).await?,
                    "image/png",
                )
            } else if force_png_reference_images {
                (Self::source_to_png_bytes(source).await?, "image/png")
            } else {
                let extension = Self::file_extension_from_source(source);
                (
                    Self::source_to_bytes(source).await?,
                    Self::mime_type_from_extension(extension),
                )
            };

        Ok(json!({
            "inlineData": {
                "mimeType": mime_type,
                "data": STANDARD.encode(bytes),
            }
        }))
    }

    async fn build_generate_content_body(
        &self,
        request: &GenerateRequest,
        request_model: &str,
        attempt: GenerateContentAttempt,
    ) -> Result<Value, AIError> {
        let mut parts = Vec::new();
        let prompt_text =
            Self::build_generate_content_prompt(request, attempt.include_prompt_preferences);
        if !prompt_text.is_empty() {
            parts.push(json!({
                "text": prompt_text,
            }));
        }

        if let Some(reference_images) = request.reference_images.as_ref() {
            for source in reference_images {
                parts.push(
                    Self::build_generate_content_image_part(
                        source,
                        attempt.force_png_reference_images,
                        attempt.resize_reference_images_to_max_dimension,
                    )
                    .await?,
                );
            }
        }

        let mut image_config = serde_json::Map::new();
        if attempt.include_aspect_ratio && !request.aspect_ratio.trim().is_empty() {
            image_config.insert(
                "aspectRatio".to_string(),
                Value::String(request.aspect_ratio.clone()),
            );
        }
        let resolved_image_size = attempt
            .image_size_override
            .or_else(|| Self::resolve_gemini_image_size(request_model, &request.size));
        if let Some(image_size) = resolved_image_size {
            image_config.insert(
                "imageSize".to_string(),
                Value::String(image_size.to_string()),
            );
        }

        let mut generation_config = serde_json::Map::new();
        if attempt.include_top_p {
            generation_config.insert("topP".to_string(), json!(0.95));
        }
        generation_config.insert("responseModalities".to_string(), json!(["IMAGE"]));
        if !image_config.is_empty() {
            generation_config.insert("imageConfig".to_string(), Value::Object(image_config));
        }

        Ok(json!({
            "contents": [{
                "role": "user",
                "parts": parts,
            }],
            "generationConfig": Value::Object(generation_config),
        }))
    }

    async fn run_generate_content(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let request_model = Self::normalize_flow2api_image_request_model(&config.request_model);
        let endpoint = Self::resolve_endpoint(&config.endpoint_url, &request_model);
        let mut attempts = vec![
            GenerateContentAttempt {
                request_kind: "generateContent-banana",
                include_aspect_ratio: true,
                include_prompt_preferences: true,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: None,
                image_size_override: None,
            },
            GenerateContentAttempt {
                request_kind: "generateContent-banana-no-aspect",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: None,
                image_size_override: None,
            },
        ];
        if Self::has_reference_images(request) {
            attempts.push(GenerateContentAttempt {
                request_kind: "generateContent-resized-image-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: Some(1536),
                image_size_override: None,
            });
            attempts.push(GenerateContentAttempt {
                request_kind: "generateContent-resized-2k-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: Some(1536),
                image_size_override: Some("2K"),
            });
            attempts.push(GenerateContentAttempt {
                request_kind: "generateContent-resized-1k-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: Some(1024),
                image_size_override: Some("1K"),
            });
            attempts.push(GenerateContentAttempt {
                request_kind: "generateContent-image-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: false,
                resize_reference_images_to_max_dimension: None,
                image_size_override: None,
            });
        }

        for (index, attempt) in attempts.iter().copied().enumerate() {
            let body = self
                .build_generate_content_body(request, &request_model, attempt)
                .await?;
            let has_more_attempts = index + 1 < attempts.len();
            match self
                .send_json_request(&endpoint, api_key, body, attempt.request_kind)
                .await
            {
                Ok(payload)
                    if has_more_attempts
                        && Self::should_retry_generate_content_payload(&payload) =>
                {
                    info!(
                        "[NewAPI] {} returned a retryable generateContent error, retrying with {}",
                        attempt.request_kind,
                        attempts[index + 1].request_kind
                    );
                }
                Err(AIError::Provider(message))
                    if has_more_attempts
                        && Self::should_continue_generate_content_attempt(&message) =>
                {
                    info!(
                        "[NewAPI] {} provider error matched fallback criteria, retrying with {}",
                        attempt.request_kind,
                        attempts[index + 1].request_kind
                    );
                }
                Ok(payload) => return Ok(payload),
                Err(error) => return Err(error),
            }
        }

        Err(AIError::Provider(
            "NewAPI generateContent attempts exhausted without a result".to_string(),
        ))
    }

    async fn run_openai_chat(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_endpoint(&config.endpoint_url);
        let fields = Self::resolve_openai_request_fields(request, &config.request_model)?;
        let prompt_text = Self::build_openai_chat_prompt_text(request, &fields);
        let message_content = if let Some(reference_images) = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
        {
            let mut content_parts = vec![json!({
                "type": "text",
                "text": prompt_text,
            })];

            for source in reference_images {
                let data_url = Self::source_to_data_url(source).await?;
                content_parts.push(json!({
                    "type": "image_url",
                    "image_url": {
                        "url": data_url,
                    }
                }));
            }

            Value::Array(content_parts)
        } else {
            Value::String(prompt_text)
        };

        let body = Self::build_openai_chat_body(&fields, message_content);

        self.send_json_request(&endpoint, api_key, Value::Object(body), "openai-chat")
            .await
    }

    async fn run_openai_edits(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_edits_endpoint(&config.endpoint_url);
        let fields = Self::resolve_openai_request_fields(request, &config.request_model)?;
        let sources = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
            .ok_or_else(|| {
                AIError::InvalidRequest("OpenAI 编辑接口至少需要一张参考图".to_string())
            })?;

        let mut form = Form::new()
            .text("model", fields.request_model.clone())
            .text(
                "prompt",
                Self::build_openai_edits_prompt_text(request, &fields),
            )
            .text("response_format", "url".to_string());

        for (index, source) in sources.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await?;
            let extension = Self::file_extension_from_source(source);
            let image_part = Part::bytes(bytes)
                .file_name(format!("image-{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart image part: {}", error))
                })?;

            let field_name = if sources.len() > 1 {
                "image[]"
            } else {
                "image"
            };
            form = form.part(field_name.to_string(), image_part);
        }

        if let Some(size) = fields.size.as_ref() {
            form = form.text("size", size.clone());
        }
        if let Some(image_size) = fields.image_size.as_ref() {
            form = form.text("image_size", image_size.clone());
        }
        if let Some(aspect_ratio) = fields.aspect_ratio.as_ref() {
            form = form.text("aspect_ratio", aspect_ratio.clone());
        }
        if let Some(image_backend) = fields.image_backend.as_ref() {
            form = form.text("image_backend", image_backend.clone());
        }

        self.send_multipart_request(&endpoint, api_key, form, "openai-edits")
            .await
    }

    async fn run_openai_edits_with_generate_content_fallback(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        match self.run_openai_edits(request, config, api_key).await {
            Ok(payload) => Ok(payload),
            Err(AIError::Provider(message))
                if Self::is_flow2api_image_request_model(&config.request_model)
                    && Self::should_retry_openai_request_with_generate_content(&message) =>
            {
                info!(
                    "[NewAPI] openai-edits provider error matched native JSON fallback criteria, retrying with generateContent"
                );
                self.run_generate_content(request, config, api_key).await
            }
            Err(error) => Err(error),
        }
    }

    async fn run_openai_generations(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_generations_endpoint(&config.endpoint_url);
        let fields = Self::resolve_openai_request_fields(request, &config.request_model)?;
        let body = Self::build_openai_generations_body(request, &fields);

        self.send_json_request(
            &endpoint,
            api_key,
            Value::Object(body),
            "openai-images-generations",
        )
        .await
    }

    async fn run_openai_images_edits(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let endpoint = Self::resolve_openai_edits_endpoint(&config.endpoint_url);
        let fields = Self::resolve_openai_request_fields(request, &config.request_model)?;
        let sources = request
            .reference_images
            .as_ref()
            .filter(|images| !images.is_empty())
            .ok_or_else(|| {
                AIError::InvalidRequest(
                    "OpenAI image edits require at least one reference image".to_string(),
                )
            })?;

        let mut form = Form::new();
        for (field_name, field_value) in
            Self::build_openai_images_edits_text_fields(request, &fields)
        {
            form = form.text(field_name, field_value);
        }

        let image_field_names = Self::build_openai_images_edits_image_field_names(sources.len());
        for (index, source) in sources.iter().enumerate() {
            let bytes = Self::source_to_bytes(source).await?;
            let extension = Self::file_extension_from_source(source);
            let image_part = Part::bytes(bytes)
                .file_name(format!("image-{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!("Failed to create multipart image part: {}", error))
                })?;

            form = form.part(image_field_names[index].to_string(), image_part);
        }

        self.send_multipart_request(&endpoint, api_key, form, "openai-images-edits")
            .await
    }

    async fn run_openai_images(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        match Self::resolve_openai_images_route(
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0),
        ) {
            OpenAiImageRoute::Generations => {
                self.run_openai_generations(request, config, api_key).await
            }
            OpenAiImageRoute::Edits => self.run_openai_images_edits(request, config, api_key).await,
        }
    }

    async fn run_openai_compatible(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let has_reference_images = Self::has_reference_images(request);
        let supports_generate_content_fallback =
            Self::is_flow2api_image_request_model(&config.request_model);

        match self.run_openai_chat(request, config, api_key).await {
            Ok(payload)
                if has_reference_images
                    && Self::extract_error_message(&payload)
                        .map(|message| Self::should_retry_openai_chat_with_openai_edits(&message))
                        .unwrap_or(false) =>
            {
                info!(
                    "[NewAPI] openai-compatible returned an image compatibility error payload, retrying with OpenAI edits"
                );
                self.run_openai_edits_with_generate_content_fallback(request, config, api_key)
                    .await
            }
            Ok(payload)
                if supports_generate_content_fallback
                    && Self::extract_error_message(&payload)
                        .map(|message| {
                            Self::should_retry_openai_request_with_generate_content(&message)
                        })
                        .unwrap_or(false) =>
            {
                info!(
                    "[NewAPI] openai-compatible returned a native JSON fallback error payload, retrying with generateContent"
                );
                self.run_generate_content(request, config, api_key).await
            }
            Ok(payload) => Ok(payload),
            Err(AIError::Provider(message))
                if has_reference_images
                    && Self::should_retry_openai_chat_with_openai_edits(&message) =>
            {
                info!(
                    "[NewAPI] openai-compatible provider error matched image compatibility fallback criteria, retrying with OpenAI edits"
                );
                self.run_openai_edits_with_generate_content_fallback(request, config, api_key)
                    .await
            }
            Err(AIError::Provider(message))
                if supports_generate_content_fallback
                    && Self::should_retry_openai_request_with_generate_content(&message) =>
            {
                info!(
                    "[NewAPI] openai-compatible provider error matched native JSON fallback criteria, retrying with generateContent"
                );
                self.run_generate_content(request, config, api_key).await
            }
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::NewApiProvider;
    use serde_json::{json, Value};

    #[test]
    fn resolve_endpoint_encodes_slash_model_names() {
        let endpoint = NewApiProvider::resolve_endpoint(
            "https://api.rensumo.top/",
            "flow/gemini-3-pro-image-preview",
        );

        assert_eq!(
            endpoint,
            "https://api.rensumo.top/v1beta/models/flow%2Fgemini-3-pro-image-preview:generateContent"
        );
    }

    #[test]
    fn resolve_endpoint_rewrites_openai_v1_base_for_generate_content() {
        let endpoint = NewApiProvider::resolve_endpoint(
            "https://www.oopii.cn/v1",
            "gemini-3.1-flash-image-landscape-4k",
        );

        assert_eq!(
            endpoint,
            "https://www.oopii.cn/v1beta/models/gemini-3.1-flash-image-landscape-4k:generateContent"
        );
    }

    #[test]
    fn resolve_openai_endpoint_normalizes_images_generations_base() {
        let endpoint =
            NewApiProvider::resolve_openai_endpoint("https://www.oopii.cn/v1/images/generations");

        assert_eq!(endpoint, "https://www.oopii.cn/v1/chat/completions");
    }

    #[test]
    fn resolve_openai_endpoint_normalizes_images_edits_base() {
        let endpoint =
            NewApiProvider::resolve_openai_endpoint("https://www.oopii.cn/v1/images/edits");

        assert_eq!(endpoint, "https://www.oopii.cn/v1/chat/completions");
    }

    #[test]
    fn resolve_openai_generations_endpoint_normalizes_chat_base() {
        let endpoint = NewApiProvider::resolve_openai_generations_endpoint(
            "https://www.oopii.cn/v1/chat/completions",
        );

        assert_eq!(endpoint, "https://www.oopii.cn/v1/images/generations");
    }

    #[test]
    fn normalize_image_source_rewrites_internal_flow2api_url_to_endpoint_origin() {
        let image_source = NewApiProvider::normalize_image_source(
            "http://flow2api:8000/tmp/example_4K.jpg".to_string(),
            "https://www.oopii.cn/v1",
        );

        assert_eq!(
            image_source,
            "https://www.oopii.cn/tmp/example_4K.jpg".to_string()
        );
    }

    #[test]
    fn normalize_image_source_keeps_public_urls_unchanged() {
        let image_source = NewApiProvider::normalize_image_source(
            "https://storage.googleapis.com/example/image.png?token=abc".to_string(),
            "https://www.oopii.cn/v1",
        );

        assert_eq!(
            image_source,
            "https://storage.googleapis.com/example/image.png?token=abc".to_string()
        );
    }

    #[test]
    fn normalize_flow2api_image_request_model_strips_aspect_and_size_suffixes() {
        assert_eq!(
            NewApiProvider::normalize_flow2api_image_request_model(
                "gemini-3.1-flash-image-landscape-4k"
            ),
            "gemini-3.1-flash-image".to_string()
        );
        assert_eq!(
            NewApiProvider::normalize_flow2api_image_request_model(
                "gemini-3.0-pro-image-portrait-2k"
            ),
            "gemini-3.0-pro-image".to_string()
        );
        assert_eq!(
            NewApiProvider::normalize_flow2api_image_request_model(
                "imagen-4.0-generate-preview-square"
            ),
            "imagen-4.0-generate-preview".to_string()
        );
        assert_eq!(
            NewApiProvider::normalize_flow2api_image_request_model(
                "vendor/gemini-3-pro-image-preview-landscape-4k"
            ),
            "vendor/gemini-3-pro-image-preview".to_string()
        );
    }

    #[test]
    fn normalize_flow2api_image_request_model_keeps_unknown_models() {
        assert_eq!(
            NewApiProvider::normalize_flow2api_image_request_model("custom-provider/my-model-4k"),
            "custom-provider/my-model-4k".to_string()
        );
    }

    #[test]
    fn is_flow2api_image_request_model_detects_supported_base_and_variant_models() {
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "gemini-3.0-pro-image"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "vendor/gemini-3-pro-image-preview"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "gemini-3.0-pro-image-landscape-4k"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "imagen-4.0-generate-preview-square"
        ));
    }

    #[test]
    fn is_flow2api_image_request_model_rejects_unknown_models() {
        assert!(!NewApiProvider::is_flow2api_image_request_model(
            "custom-provider/my-model"
        ));
        assert!(!NewApiProvider::is_flow2api_image_request_model(""));
    }

    #[test]
    fn build_flow2api_openai_extra_body_includes_aspect_ratio_and_image_size() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it night".to_string(),
            model: "newapi/gemini".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: None,
        };

        let extra_body =
            NewApiProvider::build_flow2api_openai_extra_body(&request, "gemini-3.0-pro-image")
                .expect("expected extra_body for flow2api image model");

        assert_eq!(
            extra_body,
            json!({
                "google": {
                    "image_config": {
                        "aspect_ratio": "16:9",
                        "image_size": "4K",
                    }
                }
            })
        );
    }

    #[test]
    fn build_flow2api_openai_extra_body_skips_non_flow2api_models() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it night".to_string(),
            model: "newapi/gemini".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: None,
        };

        assert!(
            NewApiProvider::build_flow2api_openai_extra_body(&request, "gpt-image-1").is_none()
        );
    }

    #[test]
    fn resolve_gpt2api_image_size_maps_2k_16_9() {
        assert_eq!(
            NewApiProvider::resolve_gpt2api_image_size("gpt-image-2-2k-medium", "2K", "16:9"),
            Some("2560x1440")
        );
    }

    #[test]
    fn resolve_gpt2api_image_size_maps_4k_9_16() {
        assert_eq!(
            NewApiProvider::resolve_gpt2api_image_size("gpt-image-2-4k-high", "4K", "9:16"),
            Some("2160x3840")
        );
    }

    #[test]
    fn build_gpt2api_prompt_text_appends_size_tag() {
        assert_eq!(
            NewApiProvider::build_gpt2api_prompt_text("make it cinematic", "2560x1440"),
            "make it cinematic\n\n[__gpt2api_image_size=2560x1440__]".to_string()
        );
    }

    #[test]
    fn build_openai_request_fields_for_gpt2api_alias_include_backend_and_omit_generic_size() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: None,
        };

        let fields =
            NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2-2k-medium")
                .expect("expected gpt-image-2 alias fields");
        let prompt = NewApiProvider::build_openai_chat_prompt_text(&request, &fields);
        let body = NewApiProvider::build_openai_chat_body(&fields, Value::String(prompt.clone()));

        assert_eq!(fields.request_model, "gpt-image-2-2k-medium".to_string());
        assert_eq!(fields.image_backend.as_deref(), Some("auto"));
        assert_eq!(fields.gpt2api_image_size.as_deref(), Some("2560x1440"));
        assert!(!body.contains_key("size"));
        assert!(!body.contains_key("aspect_ratio"));
        assert!(!body.contains_key("image_size"));
        assert_eq!(
            body.get("image_backend"),
            Some(&Value::String("auto".to_string()))
        );
        assert_eq!(
            body.get("model"),
            Some(&Value::String("gpt-image-2-2k-medium".to_string()))
        );
        assert!(prompt.ends_with("[__gpt2api_image_size=2560x1440__]"));
    }

    #[test]
    fn build_openai_edits_prompt_text_uses_gpt2api_size_tag() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "9:16".to_string(),
            reference_images: Some(vec!["https://example.com/reference.png".to_string()]),
            extra_params: None,
        };

        let fields = NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2-4k-high")
            .expect("expected gpt-image-2 alias fields");

        assert_eq!(
            NewApiProvider::build_openai_edits_prompt_text(&request, &fields),
            "make it cinematic\n\n[__gpt2api_image_size=2160x3840__]".to_string()
        );
    }

    #[test]
    fn resolve_openai_images_route_prefers_generations_without_references() {
        assert_eq!(
            NewApiProvider::resolve_openai_images_route(0),
            super::OpenAiImageRoute::Generations
        );
        assert_eq!(
            NewApiProvider::resolve_openai_images_route(2),
            super::OpenAiImageRoute::Edits
        );
    }

    #[test]
    fn build_openai_generations_body_for_gpt2api_alias_uses_doc_fields() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: None,
        };

        let fields =
            NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2-2k-medium")
                .expect("expected gpt-image-2 alias fields");
        let body = NewApiProvider::build_openai_generations_body(&request, &fields);

        assert_eq!(
            body.get("model"),
            Some(&Value::String("gpt-image-2-2k-medium".to_string()))
        );
        assert_eq!(body.get("n"), Some(&json!(1)));
        assert_eq!(
            body.get("image_backend"),
            Some(&Value::String("auto".to_string()))
        );
        assert_eq!(
            body.get("prompt"),
            Some(&Value::String(
                "make it cinematic\n\n[__gpt2api_image_size=2560x1440__]".to_string()
            ))
        );
        assert!(!body.contains_key("size"));
        assert!(!body.contains_key("aspect_ratio"));
        assert!(!body.contains_key("image_size"));
    }

    #[test]
    fn build_openai_images_edits_text_fields_for_gpt2api_alias_uses_doc_fields() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "9:16".to_string(),
            reference_images: Some(vec!["https://example.com/reference.png".to_string()]),
            extra_params: None,
        };

        let fields = NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2-4k-high")
            .expect("expected gpt-image-2 alias fields");
        let text_fields = NewApiProvider::build_openai_images_edits_text_fields(&request, &fields);

        assert_eq!(
            text_fields,
            vec![
                ("model".to_string(), "gpt-image-2-4k-high".to_string()),
                (
                    "prompt".to_string(),
                    "make it cinematic\n\n[__gpt2api_image_size=2160x3840__]".to_string()
                ),
                ("n".to_string(), "1".to_string()),
                ("image_backend".to_string(), "auto".to_string()),
            ]
        );
    }

    #[test]
    fn build_openai_images_edits_image_field_names_repeat_image_key() {
        assert_eq!(
            NewApiProvider::build_openai_images_edits_image_field_names(3),
            vec!["image", "image", "image"]
        );
    }

    #[test]
    fn extract_first_image_prefers_flow2api_upscaled_asset() {
        let payload = json!({
            "url": "https://storage.googleapis.com/example/original.jpg",
            "generated_assets": {
                "origin_image_url": "https://storage.googleapis.com/example/original.jpg",
                "upscaled_image": {
                    "local_url": "http://flow2api:8000/tmp/example_4K.jpg"
                }
            }
        });

        assert_eq!(
            NewApiProvider::extract_first_image(&payload),
            Some("http://flow2api:8000/tmp/example_4K.jpg".to_string())
        );
    }

    #[test]
    fn resolve_endpoint_works_with_normalized_flow2api_model() {
        let model = NewApiProvider::normalize_flow2api_image_request_model(
            "gemini-3.1-flash-image-landscape-4k",
        );
        let endpoint = NewApiProvider::resolve_endpoint("https://www.oopii.cn/v1", &model);

        assert_eq!(
            endpoint,
            "https://www.oopii.cn/v1beta/models/gemini-3.1-flash-image:generateContent"
        );
    }

    #[test]
    fn extract_first_image_prefers_top_level_url() {
        let payload = json!({
            "url": "https://www.oopii.cn/tmp/example_4K.jpg",
            "choices": [{
                "message": {
                    "content": "![Generated Image](https://www.oopii.cn/tmp/fallback.jpg)"
                }
            }]
        });

        assert_eq!(
            NewApiProvider::extract_first_image(&payload),
            Some("https://www.oopii.cn/tmp/example_4K.jpg".to_string())
        );
    }

    #[test]
    fn should_retry_generate_content_payload_detects_unexpected_end_error() {
        let payload = json!({
            "error": {
                "message": "unexpected end of JSON input"
            }
        });

        assert!(NewApiProvider::should_retry_generate_content_payload(
            &payload
        ));
    }

    #[test]
    fn should_retry_generate_content_payload_detects_json_invalid_error() {
        let payload = json!({
            "error": {
                "message": "NewAPI openai-chat request failed 422 Unprocessable Entity: {\"detail\":[{\"type\":\"json_invalid\",\"msg\":\"JSON decode error\",\"ctx\":{\"error\":\"Unterminated string starting at\"}}]}"
            }
        });

        assert!(NewApiProvider::should_retry_generate_content_payload(
            &payload
        ));
    }

    #[test]
    fn should_retry_generate_content_payload_detects_upstream_extract_error() {
        let payload = json!({
            "error": {
                "message": "Failed to extract image from upstream response."
            }
        });

        assert!(NewApiProvider::should_retry_generate_content_payload(
            &payload
        ));
    }

    #[test]
    fn should_continue_generate_content_attempt_detects_nginx_html_400() {
        let message = "NewAPI generateContent request failed 400 Bad Request: <html><body><center><h1>400 Bad Request</h1></center><hr><center>nginx</center></body></html>";

        assert!(NewApiProvider::should_continue_generate_content_attempt(
            message
        ));
    }

    #[test]
    fn should_continue_generate_content_attempt_detects_openresty_html_504() {
        let message = "NewAPI generateContent-banana request failed 504 Gateway Timeout: <html><body><center><h1>504 Gateway Time-out</h1></center><hr><center>openresty</center></body></html>";

        assert!(!NewApiProvider::should_continue_generate_content_attempt(
            message
        ));
    }

    #[test]
    fn should_continue_generate_content_attempt_detects_unterminated_string_error() {
        let message = "Provider error: NewAPI openai-chat request failed 422 Unprocessable Entity: {\"detail\":[{\"type\":\"json_invalid\",\"loc\":[\"body\",176],\"msg\":\"JSON decode error\",\"ctx\":{\"error\":\"Unterminated string starting at\"}}]}";

        assert!(NewApiProvider::should_continue_generate_content_attempt(
            message
        ));
    }

    #[test]
    fn should_retry_generate_content_payload_ignores_other_errors() {
        let payload = json!({
            "error": {
                "message": "model not found"
            }
        });

        assert!(!NewApiProvider::should_retry_generate_content_payload(
            &payload
        ));
    }

    #[test]
    fn is_timeout_message_detects_transport_timeout_variants() {
        assert!(NewApiProvider::is_timeout_message(
            "curl transport failed for NewAPI generateContent request: Operation timed out after 240001 milliseconds"
        ));
        assert!(NewApiProvider::is_timeout_message(
            "NewAPI generateContent request failed 504 Gateway Timeout: <html><body><center><h1>504 Gateway Time-out</h1></center></body></html>"
        ));
    }

    #[test]
    fn should_retry_http_status_skips_timeout_statuses() {
        assert!(!NewApiProvider::should_retry_http_status(
            reqwest::StatusCode::REQUEST_TIMEOUT
        ));
        assert!(!NewApiProvider::should_retry_http_status(
            reqwest::StatusCode::GATEWAY_TIMEOUT
        ));
        assert!(NewApiProvider::should_retry_http_status(
            reqwest::StatusCode::BAD_GATEWAY
        ));
    }

    #[test]
    fn parse_api_format_accepts_simplified_and_legacy_values() {
        assert_eq!(
            NewApiProvider::parse_api_format("openai").unwrap(),
            super::NewApiFormat::OpenAiCompatible
        );
        assert_eq!(
            NewApiProvider::parse_api_format("openai-images").unwrap(),
            super::NewApiFormat::OpenAiImages
        );
        assert_eq!(
            NewApiProvider::parse_api_format("openai-chat").unwrap(),
            super::NewApiFormat::OpenAiCompatible
        );
        assert_eq!(
            NewApiProvider::parse_api_format("openai-edits").unwrap(),
            super::NewApiFormat::OpenAiCompatible
        );
        assert_eq!(
            NewApiProvider::parse_api_format("gemini").unwrap(),
            super::NewApiFormat::GeminiGenerateContent
        );
        assert_eq!(
            NewApiProvider::parse_api_format("gemini-generate-content").unwrap(),
            super::NewApiFormat::GeminiGenerateContent
        );
    }

    #[test]
    fn should_retry_openai_chat_with_openai_edits_only_for_image_compatibility_errors() {
        assert!(NewApiProvider::should_retry_openai_chat_with_openai_edits(
            "invalid image_url payload"
        ));
        assert!(NewApiProvider::should_retry_openai_chat_with_openai_edits(
            "json_invalid"
        ));
        assert!(!NewApiProvider::should_retry_openai_chat_with_openai_edits(
            "PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC"
        ));
    }

    #[test]
    fn should_retry_openai_request_with_generate_content_for_invalid_json_gateway_error() {
        assert!(NewApiProvider::should_retry_openai_request_with_generate_content(
            "NewAPI openai-edits request failed 400 Bad Request: {\"error\":{\"message\":\"Invalid JSON payload received. Unable to parse number.\\n--503939003c066953-c\\n^\",\"type\":\"upstream_error\"}}"
        ));
        assert!(
            !NewApiProvider::should_retry_openai_request_with_generate_content("model not found")
        );
    }
}

impl Default for NewApiProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for NewApiProvider {
    fn name(&self) -> &str {
        "newapi"
    }

    fn supports_model(&self, model: &str) -> bool {
        model.starts_with("newapi/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![STORYBOARD_MODEL_ID.to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self.get_api_key().await?;
        let config = Self::extract_config(&request)?;
        info!(
            "[NewAPI Request] display_name: {}, format: {:?}, endpoint: {}, request_model: {}, refs: {}",
            config.display_name,
            config.api_format,
            config.endpoint_url,
            config.request_model,
            request
                .reference_images
                .as_ref()
                .map(|images| images.len())
                .unwrap_or(0)
        );

        let payload = match config.api_format {
            NewApiFormat::GeminiGenerateContent => {
                self.run_generate_content(&request, &config, &api_key)
                    .await?
            }
            NewApiFormat::OpenAiImages => {
                self.run_openai_images(&request, &config, &api_key).await?
            }
            NewApiFormat::OpenAiCompatible => {
                self.run_openai_compatible(&request, &config, &api_key)
                    .await?
            }
        };

        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        if let Some(image_source) = Self::extract_first_image(&payload) {
            return Ok(Self::normalize_image_source(
                image_source,
                &config.endpoint_url,
            ));
        }

        if let Some(text) = Self::extract_text(&payload) {
            return Ok(text);
        }

        Err(AIError::Provider(format!(
            "NewAPI response did not include image or text data: {}",
            payload
        )))
    }
}
