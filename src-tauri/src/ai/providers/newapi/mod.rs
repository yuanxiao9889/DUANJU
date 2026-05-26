use base64::{engine::general_purpose::STANDARD, Engine};
use image::imageops::FilterType;
use image::ImageFormat;
use reqwest::multipart::{Form, Part};
use reqwest::{header::HeaderMap, Client};
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
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};
use crate::commands::image::resolve_image_source_bytes;

const STORYBOARD_MODEL_ID: &str = "newapi/storyboard-experimental";
const BANANA_CLIENT_HEADER_VALUE: &str = "comfyui-banana-li";
const JSON_REQUEST_MAX_ATTEMPTS: usize = 2;
const JSON_REQUEST_RETRY_DELAY_MS: u64 = 2_000;
const CURL_JSON_TRANSPORT_MIN_BYTES: usize = 64 * 1024;
const CURL_JSON_TRANSPORT_TIMEOUT_SECONDS: u64 = 1_000;
const CURL_MULTIPART_TRANSPORT_TIMEOUT_SECONDS: u64 = 1_000;
const CURL_4K_IMAGE_TRANSPORT_TIMEOUT_SECONDS: u64 = 2_400;
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
    quality: Option<String>,
    extra_body: Option<Value>,
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
            .connect_timeout(Duration::from_secs(10))
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

    fn resolve_api_format_for_request_model(
        api_format: &str,
        request_model: &str,
    ) -> Result<NewApiFormat, AIError> {
        let parsed_format = Self::parse_api_format(api_format)?;
        if Self::is_gpt2api_image_request_model(request_model) {
            return Ok(NewApiFormat::OpenAiImages);
        }

        Ok(parsed_format)
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
            api_format: Self::resolve_api_format_for_request_model(
                &payload.api_format,
                &request_model,
            )?,
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
        let (bytes, _extension) = resolve_image_source_bytes(trimmed)
            .await
            .map_err(AIError::InvalidRequest)?;
        Ok(bytes)
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
            || lower.contains("monkey-image")
            || lower == "monkey-pro"
            || lower == "monkey-2"
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
            || lower_model.contains("monkey-image")
            || lower_model == "monkey-pro"
            || lower_model == "monkey-2"
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

    fn is_oopii_all_image_2_request_model(request_model: &str) -> bool {
        request_model.trim().eq_ignore_ascii_case("all-image-2")
    }

    fn is_gpt2api_image_request_model(request_model: &str) -> bool {
        request_model.trim().eq_ignore_ascii_case("gpt-image-2")
            || Self::is_oopii_all_image_2_request_model(request_model)
            || Self::is_gpt2api_image_request_model_alias(request_model)
    }

    fn resolve_gpt2api_transport_model(request_model: &str) -> &'static str {
        if Self::is_oopii_all_image_2_request_model(request_model) {
            "all-image-2"
        } else {
            "gpt-image-2"
        }
    }

    fn resolve_gpt2api_quality(request: &GenerateRequest, request_model: &str) -> Option<String> {
        let from_extra_params = request
            .extra_params
            .as_ref()
            .and_then(|params| params.get("quality"))
            .and_then(Value::as_str)
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .filter(|quality| matches!(quality.as_str(), "low" | "medium" | "high" | "auto"));

        if from_extra_params.is_some() {
            return from_extra_params;
        }

        let normalized = request_model.trim().to_ascii_lowercase();
        if normalized.ends_with("-low") {
            Some("low".to_string())
        } else if normalized.ends_with("-medium") {
            Some("medium".to_string())
        } else if normalized.ends_with("-high") {
            Some("high".to_string())
        } else {
            None
        }
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
            ("1K", "9:21") => Some("624x1456"),
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
            ("2K", "9:21") => Some("1296x3024"),
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
            ("4K", "9:21") => Some("1584x3696"),
            ("4K", "16:9") => Some("3840x2160"),
            ("4K", "4:3") => Some("3264x2448"),
            ("4K", "3:2") => Some("3504x2336"),
            ("4K", "4:5") => Some("2560x3200"),
            ("4K", "3:4") => Some("2448x3264"),
            ("4K", "2:3") => Some("2336x3504"),
            _ => None,
        }
    }

    fn resolve_openai_request_fields(
        request: &GenerateRequest,
        config_request_model: &str,
    ) -> Result<OpenAiRequestFields, AIError> {
        if Self::is_gpt2api_image_request_model(config_request_model) {
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
                request_model: Self::resolve_gpt2api_transport_model(config_request_model)
                    .to_string(),
                size: Some(image_size.to_string()),
                aspect_ratio: Some(request.aspect_ratio.trim().to_string()),
                image_size: None,
                image_backend: Some("auto".to_string()),
                quality: Self::resolve_gpt2api_quality(request, config_request_model),
                extra_body: None,
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
            quality: None,
            extra_body: Self::build_flow2api_openai_extra_body(request, &request_model),
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

    fn resolve_image_transport_timeout_seconds(request: &GenerateRequest) -> u64 {
        if request.size.trim().eq_ignore_ascii_case("4K") {
            CURL_4K_IMAGE_TRANSPORT_TIMEOUT_SECONDS
        } else {
            CURL_MULTIPART_TRANSPORT_TIMEOUT_SECONDS
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
        _fields: &OpenAiRequestFields,
    ) -> String {
        Self::build_prompt_text(request)
    }

    fn build_openai_edits_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> String {
        Self::build_gpt2api_prompt_text(request, fields, request.prompt.trim())
    }

    fn build_openai_generations_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
    ) -> String {
        Self::build_gpt2api_prompt_text(request, fields, request.prompt.trim())
    }

    fn build_gpt2api_prompt_text(
        request: &GenerateRequest,
        fields: &OpenAiRequestFields,
        prompt: &str,
    ) -> String {
        if fields.image_backend.as_deref() != Some("auto") {
            return prompt.to_string();
        }

        let aspect_ratio = request.aspect_ratio.trim();
        if aspect_ratio.is_empty() {
            return prompt.to_string();
        }

        let mut lines = vec![prompt.to_string()];
        lines.push(format!(
            "Strict output canvas requirement: final image aspect ratio must be exactly {}. Do not crop, pad, or resize to any other aspect ratio.",
            aspect_ratio
        ));
        if let Some(size) = fields.size.as_ref() {
            lines.push(format!(
                "Use the requested output size {} for this {} aspect ratio.",
                size, aspect_ratio
            ));
        }

        lines
            .into_iter()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<String>>()
            .join("\n\n")
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
        if let Some(quality) = fields.quality.as_ref() {
            body.insert("quality".to_string(), Value::String(quality.clone()));
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
        if let Some(quality) = fields.quality.as_ref() {
            body.insert("quality".to_string(), Value::String(quality.clone()));
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
        if let Some(quality) = fields.quality.as_ref() {
            text_fields.push(("quality".to_string(), quality.clone()));
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
            "/error",
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

    fn should_fallback_to_reqwest_for_multipart_provider_error(message: &str) -> bool {
        if Self::is_timeout_message(message) {
            return false;
        }

        let normalized = message.trim().to_ascii_lowercase();
        normalized.contains("curl transport failed")
            || normalized.contains("failed to run curl")
            || normalized.contains("curl multipart task failed")
            || normalized.contains("failed to persist newapi")
            || normalized.contains("multipart file")
            || normalized.contains("access is denied")
            || normalized.contains("permission denied")
            || normalized.contains("operation not permitted")
            || normalized.contains("the system cannot find the path specified")
            || normalized.contains("no such file or directory")
    }

    fn should_fallback_to_reqwest_for_multipart_error(error: &AIError) -> bool {
        match error {
            AIError::Provider(message) => {
                Self::should_fallback_to_reqwest_for_multipart_provider_error(message)
            }
            _ => false,
        }
    }

    fn is_flow2api_image_request_model(request_model: &str) -> bool {
        let normalized = Self::normalize_flow2api_image_request_model(request_model);
        let lower = normalized.to_ascii_lowercase();
        lower.contains("imagen")
            || lower.contains("monkey-image")
            || lower == "monkey-pro"
            || lower == "monkey-2"
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
        request_kind == "openai-images-generations"
            || (payload_len >= CURL_JSON_TRANSPORT_MIN_BYTES
                && (request_kind.starts_with("openai-chat")
                    || request_kind.starts_with("generateContent")))
    }

    fn extract_request_id_from_headers(headers: &HeaderMap) -> Option<String> {
        [
            "x-request-id",
            "x-oneapi-request-id",
            "request-id",
            "x-requestid",
            "x-newapi-request-id",
            "x-new-api-request-id",
        ]
        .iter()
        .find_map(|name| {
            headers
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn extract_request_id_from_header_text(headers: &str) -> Option<String> {
        headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            let normalized_name = name.trim().to_ascii_lowercase();
            if matches!(
                normalized_name.as_str(),
                "x-request-id"
                    | "x-oneapi-request-id"
                    | "request-id"
                    | "x-requestid"
                    | "x-newapi-request-id"
                    | "x-new-api-request-id"
            ) {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            None
        })
    }

    fn extract_request_id_from_payload(payload: &Value) -> Option<String> {
        [
            "/request_id",
            "/requestId",
            "/id",
            "/error/request_id",
            "/error/requestId",
            "/error/id",
            "/detail/request_id",
            "/detail/requestId",
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

    fn extract_request_id_from_text(text: &str) -> Option<String> {
        if let Ok(payload) = serde_json::from_str::<Value>(text) {
            if let Some(request_id) = Self::extract_request_id_from_payload(&payload) {
                return Some(request_id);
            }
        }

        text.split(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | '}' | '{'))
            .find_map(|token| {
                let normalized =
                    token.trim_matches(|ch: char| matches!(ch, ':' | '=' | ';' | ',' | '"' | '\''));
                let lower = normalized.to_ascii_lowercase();
                for prefix in ["request_id=", "requestid=", "request-id=", "x-request-id="] {
                    if let Some(value) = lower.strip_prefix(prefix) {
                        if !value.is_empty() {
                            let start = normalized.len() - value.len();
                            return Some(normalized[start..].to_string());
                        }
                    }
                }
                None
            })
    }

    fn append_request_id_to_error(message: String, request_id: Option<String>) -> String {
        let Some(request_id) = request_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            return message;
        };
        if message.contains(&request_id) {
            return message;
        }
        format!("{} request_id={}", message, request_id)
    }

    async fn send_json_request_with_curl(
        endpoint: String,
        api_key: String,
        payload: Vec<u8>,
        request_kind: String,
        timeout_seconds: u64,
    ) -> Result<(reqwest::StatusCode, String, Option<String>), AIError> {
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
            let header_file_path = std::env::temp_dir().join(format!(
                "storyboard-copilot-newapi-response-headers-{}.txt",
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
                    .arg(timeout_seconds.to_string())
                    .arg("-X")
                    .arg("POST")
                    .arg(&endpoint)
                    .arg("-H")
                    .arg(format!("Authorization: Bearer {}", api_key))
                    .arg("-H")
                    .arg("Content-Type: application/json")
                    .arg("--data-binary")
                    .arg(format!("@{}", request_file_path.display()))
                    .arg("-D")
                    .arg(&header_file_path)
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
                let response_headers = fs::read_to_string(&header_file_path).unwrap_or_default();
                let request_id = Self::extract_request_id_from_header_text(&response_headers)
                    .or_else(|| Self::extract_request_id_from_text(&response_text));
                let status = reqwest::StatusCode::from_u16(status_code).map_err(|error| {
                    AIError::Provider(format!(
                        "Invalid curl HTTP status for NewAPI {} request: {}",
                        request_kind, error
                    ))
                })?;

                Ok((status, response_text, request_id))
            })();

            let _ = fs::remove_file(&request_file_path);
            let _ = fs::remove_file(&response_file_path);
            let _ = fs::remove_file(&header_file_path);
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
        timeout_seconds: u64,
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
                    timeout_seconds,
                )
                .await
                {
                    Ok((status, response_text, request_id)) => {
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
                            return Err(AIError::Provider(Self::append_request_id_to_error(
                                format!(
                                    "NewAPI {} request failed {}: {}",
                                    request_kind, status, response_text
                                ),
                                request_id,
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
                    let request_id = Self::extract_request_id_from_headers(response.headers());
                    let response_text = response.text().await?;
                    let request_id =
                        request_id.or_else(|| Self::extract_request_id_from_text(&response_text));
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
                        return Err(AIError::Provider(Self::append_request_id_to_error(
                            format!(
                                "NewAPI {} request failed {}: {}",
                                request_kind, status, response_text
                            ),
                            request_id,
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

    async fn send_multipart_request_with_curl(
        endpoint: String,
        api_key: String,
        text_fields: Vec<(String, String)>,
        file_parts: Vec<(String, Vec<u8>, &'static str)>,
        request_kind: String,
        timeout_seconds: u64,
    ) -> Result<Value, AIError> {
        let request_kind_for_join = request_kind.clone();
        tokio::task::spawn_blocking(move || {
            let temp_dir = std::env::temp_dir();
            let response_file_path = temp_dir.join(format!(
                "storyboard-copilot-newapi-multipart-response-{}.txt",
                uuid::Uuid::new_v4()
            ));
            let header_file_path = temp_dir.join(format!(
                "storyboard-copilot-newapi-multipart-response-headers-{}.txt",
                uuid::Uuid::new_v4()
            ));
            let mut temp_file_paths = Vec::<PathBuf>::new();

            let result = (|| {
                let curl_binary = if cfg!(target_os = "windows") {
                    "curl.exe"
                } else {
                    "curl"
                };
                let mut command = Command::new(curl_binary);
                #[cfg(target_os = "windows")]
                command.creation_flags(CREATE_NO_WINDOW);

                command
                    .arg("-sS")
                    .arg("--http1.1")
                    .arg("--connect-timeout")
                    .arg("30")
                    .arg("--max-time")
                    .arg(timeout_seconds.to_string())
                    .arg("-X")
                    .arg("POST")
                    .arg(&endpoint)
                    .arg("-H")
                    .arg(format!("Authorization: Bearer {}", api_key))
                    .arg("-H")
                    .arg("Accept: application/json")
                    .arg("-H")
                    .arg(format!("X-API-Key: {}", api_key))
                    .arg("-H")
                    .arg(format!("X-Banana-Client: {}", BANANA_CLIENT_HEADER_VALUE));

                for (field_name, field_value) in text_fields {
                    command
                        .arg("--form-string")
                        .arg(format!("{}={}", field_name, field_value));
                }

                for (index, (field_name, bytes, extension)) in file_parts.into_iter().enumerate() {
                    let temp_file_path = temp_dir.join(format!(
                        "storyboard-copilot-newapi-multipart-{}-{}.{}",
                        uuid::Uuid::new_v4(),
                        index + 1,
                        extension
                    ));
                    fs::write(&temp_file_path, bytes).map_err(|error| {
                        AIError::Provider(format!(
                            "Failed to persist NewAPI {} multipart file: {}",
                            request_kind, error
                        ))
                    })?;
                    temp_file_paths.push(temp_file_path.clone());

                    command.arg("--form").arg(format!(
                        "{}=@{}",
                        field_name,
                        temp_file_path.display()
                    ));
                }

                command
                    .arg("-D")
                    .arg(&header_file_path)
                    .arg("-o")
                    .arg(&response_file_path)
                    .arg("-w")
                    .arg("%{http_code}");

                let output = command.output().map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to run curl for NewAPI {} request: {}",
                        request_kind, error
                    ))
                })?;

                let status_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let response_text = fs::read_to_string(&response_file_path).unwrap_or_default();
                let response_headers = fs::read_to_string(&header_file_path).unwrap_or_default();
                let request_id = Self::extract_request_id_from_header_text(&response_headers)
                    .or_else(|| Self::extract_request_id_from_text(&response_text));

                if !output.status.success() {
                    return Err(AIError::Provider(format!(
                        "NewAPI {} curl transport failed: {}",
                        request_kind,
                        if stderr_text.is_empty() {
                            output.status.to_string()
                        } else {
                            stderr_text
                        }
                    )));
                }

                let status_code = status_text.parse::<u16>().unwrap_or(0);
                info!(
                    "[NewAPI] {} {} -> {} via curl multipart",
                    request_kind, endpoint, status_code
                );
                info!("[NewAPI] {} response: {}", request_kind, response_text);

                if !(200..300).contains(&status_code) {
                    return Err(AIError::Provider(Self::append_request_id_to_error(
                        format!(
                            "NewAPI {} request failed {}: {}",
                            request_kind, status_code, response_text
                        ),
                        request_id,
                    )));
                }

                serde_json::from_str(&response_text).map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to parse NewAPI {} response: {}. Response was: {}",
                        request_kind, error, response_text
                    ))
                })
            })();

            for path in temp_file_paths {
                let _ = fs::remove_file(path);
            }
            let _ = fs::remove_file(response_file_path);
            let _ = fs::remove_file(header_file_path);

            result
        })
        .await
        .map_err(|error| {
            AIError::Provider(format!(
                "NewAPI {} curl multipart task failed: {}",
                request_kind_for_join, error
            ))
        })?
    }

    async fn send_multipart_request_with_reqwest(
        &self,
        endpoint: &str,
        api_key: &str,
        text_fields: &[(String, String)],
        file_parts: &[(String, Vec<u8>, &'static str)],
        request_kind: &str,
        timeout_seconds: u64,
    ) -> Result<Value, AIError> {
        let mut form = Form::new();
        for (field_name, field_value) in text_fields {
            form = form.text(field_name.clone(), field_value.clone());
        }

        for (index, (field_name, bytes, extension)) in file_parts.iter().enumerate() {
            let part = Part::bytes(bytes.clone())
                .file_name(format!("image_{}.{}", index + 1, extension))
                .mime_str(Self::mime_type_from_extension(extension))
                .map_err(|error| {
                    AIError::Provider(format!(
                        "Failed to create NewAPI {} multipart image part: {}",
                        request_kind, error
                    ))
                })?;
            form = form.part(field_name.clone(), part);
        }

        let response = self
            .client
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("X-API-Key", api_key)
            .header("X-Banana-Client", BANANA_CLIENT_HEADER_VALUE)
            .multipart(form)
            .timeout(Duration::from_secs(timeout_seconds))
            .send()
            .await?;

        let status = response.status();
        let request_id = Self::extract_request_id_from_headers(response.headers());
        let response_text = response.text().await?;
        let request_id = request_id.or_else(|| Self::extract_request_id_from_text(&response_text));

        info!(
            "[NewAPI] {} {} -> {} via reqwest multipart",
            request_kind, endpoint, status
        );
        info!("[NewAPI] {} response: {}", request_kind, response_text);

        if !status.is_success() {
            return Err(AIError::Provider(Self::append_request_id_to_error(
                format!(
                    "NewAPI {} request failed {}: {}",
                    request_kind, status, response_text
                ),
                request_id,
            )));
        }

        serde_json::from_str(&response_text).map_err(|error| {
            AIError::Provider(format!(
                "Failed to parse NewAPI {} response: {}. Response was: {}",
                request_kind, error, response_text
            ))
        })
    }

    async fn send_multipart_request(
        &self,
        endpoint: String,
        api_key: String,
        text_fields: Vec<(String, String)>,
        file_parts: Vec<(String, Vec<u8>, &'static str)>,
        request_kind: String,
        timeout_seconds: u64,
    ) -> Result<Value, AIError> {
        match Self::send_multipart_request_with_curl(
            endpoint.clone(),
            api_key.clone(),
            text_fields.clone(),
            file_parts.clone(),
            request_kind.clone(),
            timeout_seconds,
        )
        .await
        {
            Ok(payload) => Ok(payload),
            Err(error) if Self::should_fallback_to_reqwest_for_multipart_error(&error) => {
                warn!(
                    "[NewAPI] {} curl multipart failed, falling back to reqwest: {}",
                    request_kind, error
                );
                self.send_multipart_request_with_reqwest(
                    &endpoint,
                    &api_key,
                    &text_fields,
                    &file_parts,
                    &request_kind,
                    timeout_seconds,
                )
                .await
            }
            Err(error) => Err(error),
        }
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
                request_kind: "generateContent-resized-reference-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: Some(1536),
                image_size_override: None,
            });
            attempts.push(GenerateContentAttempt {
                request_kind: "generateContent-compact-reference-fallback",
                include_aspect_ratio: false,
                include_prompt_preferences: false,
                include_top_p: true,
                force_png_reference_images: true,
                resize_reference_images_to_max_dimension: Some(1024),
                image_size_override: None,
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
                .send_json_request(
                    &endpoint,
                    api_key,
                    body,
                    attempt.request_kind,
                    CURL_JSON_TRANSPORT_TIMEOUT_SECONDS,
                )
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

        self.send_json_request(
            &endpoint,
            api_key,
            Value::Object(body),
            "openai-chat",
            CURL_JSON_TRANSPORT_TIMEOUT_SECONDS,
        )
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

        let mut text_fields = vec![
            ("model".to_string(), fields.request_model.clone()),
            (
                "prompt".to_string(),
                Self::build_openai_edits_prompt_text(request, &fields),
            ),
            ("response_format".to_string(), "url".to_string()),
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
        if let Some(quality) = fields.quality.as_ref() {
            text_fields.push(("quality".to_string(), quality.clone()));
        }

        let image_field_names = Self::build_openai_images_edits_image_field_names(sources.len());
        let mut file_parts = Vec::with_capacity(sources.len());
        let mut total_upload_bytes = 0usize;
        for (index, source) in sources.iter().enumerate() {
            let bytes = Self::source_to_png_bytes(source).await?;
            total_upload_bytes += bytes.len();
            file_parts.push((image_field_names[index].to_string(), bytes, "png"));
        }
        info!(
            "[NewAPI] prepared {} normalized reference images for openai-edits upload: total_bytes={}",
            file_parts.len(),
            total_upload_bytes
        );

        self.send_multipart_request(
            endpoint,
            api_key.to_string(),
            text_fields,
            file_parts,
            "openai-edits".to_string(),
            Self::resolve_image_transport_timeout_seconds(request),
        )
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
            Self::resolve_image_transport_timeout_seconds(request),
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

        let text_fields = Self::build_openai_images_edits_text_fields(request, &fields);
        let image_field_names = Self::build_openai_images_edits_image_field_names(sources.len());
        let mut file_parts = Vec::with_capacity(sources.len());
        let mut total_upload_bytes = 0usize;
        for (index, source) in sources.iter().enumerate() {
            let bytes = Self::source_to_png_bytes(source).await?;
            total_upload_bytes += bytes.len();
            file_parts.push((image_field_names[index].to_string(), bytes, "png"));
        }
        info!(
            "[NewAPI] prepared {} normalized reference images for openai-images-edits upload: total_bytes={}",
            file_parts.len(),
            total_upload_bytes
        );

        self.send_multipart_request(
            endpoint,
            api_key.to_string(),
            text_fields,
            file_parts,
            "openai-images-edits".to_string(),
            Self::resolve_image_transport_timeout_seconds(request),
        )
        .await
    }

    fn sync_payload_to_submission(
        &self,
        payload: Value,
        config: &NewApiConfig,
    ) -> Result<ProviderTaskSubmission, AIError> {
        if let Some(error_message) = Self::extract_error_message(&payload) {
            return Err(AIError::Provider(error_message));
        }

        if let Some(image_source) = Self::extract_first_image(&payload) {
            return Ok(ProviderTaskSubmission::Succeeded(
                Self::normalize_image_source(image_source, &config.endpoint_url),
            ));
        }

        if let Some(text) = Self::extract_text(&payload) {
            return Ok(ProviderTaskSubmission::Succeeded(text));
        }

        Err(AIError::Provider(format!(
            "NewAPI response did not include image or text data: {}",
            payload
        )))
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

    async fn run_openai_images_with_chat_fallback(
        &self,
        request: &GenerateRequest,
        config: &NewApiConfig,
        api_key: &str,
    ) -> Result<Value, AIError> {
        let allow_chat_fallback = !Self::is_gpt2api_image_request_model(&config.request_model);
        match self.run_openai_images(request, config, api_key).await {
            Ok(payload) => {
                if let Some(message) = Self::extract_error_message(&payload) {
                    if !allow_chat_fallback {
                        return Ok(payload);
                    }
                    warn!(
                        "[NewAPI] openai-images returned an error payload, retrying via chat/completions fallback: {}",
                        message
                    );
                    return self.run_openai_compatible(request, config, api_key).await;
                }

                Ok(payload)
            }
            Err(AIError::Provider(message))
                if allow_chat_fallback && !Self::is_timeout_message(&message) =>
            {
                warn!(
                    "[NewAPI] openai-images provider error, retrying via chat/completions fallback: {}",
                    message
                );
                self.run_openai_compatible(request, config, api_key).await
            }
            Err(error) => Err(error),
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
    use super::{GenerateContentAttempt, NewApiProvider};
    use crate::ai::AIError;
    use crate::ai::AIProvider;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::{json, Value};
    use std::collections::HashMap;

    fn gpt2api_expected_size_cases() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("1K", "1:1", "1024x1024"),
            ("1K", "5:4", "1120x896"),
            ("1K", "9:16", "720x1280"),
            ("1K", "21:9", "1456x624"),
            ("1K", "9:21", "624x1456"),
            ("1K", "16:9", "1280x720"),
            ("1K", "4:3", "1152x864"),
            ("1K", "3:2", "1248x832"),
            ("1K", "4:5", "896x1120"),
            ("1K", "3:4", "864x1152"),
            ("1K", "2:3", "832x1248"),
            ("2K", "1:1", "2048x2048"),
            ("2K", "5:4", "2240x1792"),
            ("2K", "9:16", "1440x2560"),
            ("2K", "21:9", "3024x1296"),
            ("2K", "9:21", "1296x3024"),
            ("2K", "16:9", "2560x1440"),
            ("2K", "4:3", "2304x1728"),
            ("2K", "3:2", "2496x1664"),
            ("2K", "4:5", "1792x2240"),
            ("2K", "3:4", "1728x2304"),
            ("2K", "2:3", "1664x2496"),
            ("4K", "1:1", "2880x2880"),
            ("4K", "5:4", "3200x2560"),
            ("4K", "9:16", "2160x3840"),
            ("4K", "21:9", "3696x1584"),
            ("4K", "9:21", "1584x3696"),
            ("4K", "16:9", "3840x2160"),
            ("4K", "4:3", "3264x2448"),
            ("4K", "3:2", "3504x2336"),
            ("4K", "4:5", "2560x3200"),
            ("4K", "3:4", "2448x3264"),
            ("4K", "2:3", "2336x3504"),
        ]
    }

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
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "monkey-image-pro"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "monkey-image-flash 2"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "monkey-pro"
        ));
        assert!(NewApiProvider::is_flow2api_image_request_model(
            "monkey-2"
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
    fn build_flow2api_openai_extra_body_supports_monkey_image_models() {
        let request = crate::ai::GenerateRequest {
            prompt: "make it night".to_string(),
            model: "oopii/monkey-image-flash 2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: None,
        };

        let extra_body =
            NewApiProvider::build_flow2api_openai_extra_body(&request, "monkey-image-flash 2")
                .expect("expected extra_body for monkey image model");

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
    fn build_flow2api_openai_extra_body_supports_monkey_alias_models() {
        for (request_model, size) in [("monkey-2", "2K"), ("monkey-pro", "4K")] {
            let request = crate::ai::GenerateRequest {
                prompt: "make it night".to_string(),
                model: format!("oopii/{}", request_model),
                size: size.to_string(),
                aspect_ratio: "16:9".to_string(),
                reference_images: None,
                extra_params: None,
            };

            let extra_body =
                NewApiProvider::build_flow2api_openai_extra_body(&request, request_model)
                    .expect("expected extra_body for monkey alias model");

            assert_eq!(
                extra_body,
                json!({
                    "google": {
                        "image_config": {
                            "aspect_ratio": "16:9",
                            "image_size": size,
                        }
                    }
                })
            );
        }
    }

    #[tokio::test]
    async fn generate_content_reference_fallbacks_keep_requested_image_size() {
        let provider = NewApiProvider::new();
        let reference_png = {
            let mut buffer = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                1,
                1,
                image::Rgba([255, 255, 255, 255]),
            ))
            .write_to(&mut buffer, image::ImageFormat::Png)
            .expect("expected test png encoding");
            format!("data:image/png;base64,{}", STANDARD.encode(buffer.into_inner()))
        };

        for (request_model, size) in [("monkey-pro", "4K"), ("monkey-2", "4K"), ("monkey-2", "2K")] {
            let request = crate::ai::GenerateRequest {
                prompt: "make it night".to_string(),
                model: format!("oopii/{}", request_model),
                size: size.to_string(),
                aspect_ratio: "16:9".to_string(),
                reference_images: Some(vec![reference_png.clone()]),
                extra_params: None,
            };

            for attempt in [
                GenerateContentAttempt {
                    request_kind: "generateContent-resized-image-fallback",
                    include_aspect_ratio: false,
                    include_prompt_preferences: false,
                    include_top_p: true,
                    force_png_reference_images: true,
                    resize_reference_images_to_max_dimension: Some(1536),
                    image_size_override: None,
                },
                GenerateContentAttempt {
                    request_kind: "generateContent-resized-reference-fallback",
                    include_aspect_ratio: false,
                    include_prompt_preferences: false,
                    include_top_p: true,
                    force_png_reference_images: true,
                    resize_reference_images_to_max_dimension: Some(1536),
                    image_size_override: None,
                },
                GenerateContentAttempt {
                    request_kind: "generateContent-compact-reference-fallback",
                    include_aspect_ratio: false,
                    include_prompt_preferences: false,
                    include_top_p: true,
                    force_png_reference_images: true,
                    resize_reference_images_to_max_dimension: Some(1024),
                    image_size_override: None,
                },
            ] {
                let body = provider
                    .build_generate_content_body(&request, request_model, attempt)
                    .await
                    .expect("expected generateContent body");

                assert_eq!(
                    body.pointer("/generationConfig/imageConfig/imageSize"),
                    Some(&Value::String(size.to_string())),
                    "fallback {} should preserve requested output size for {} {}",
                    attempt.request_kind,
                    request_model,
                    size
                );
            }
        }
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
    fn build_openai_request_fields_for_gpt2api_alias_include_standard_size() {
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

        assert_eq!(fields.request_model, "gpt-image-2".to_string());
        assert_eq!(fields.image_backend.as_deref(), Some("auto"));
        assert_eq!(fields.quality.as_deref(), Some("medium"));
        assert_eq!(fields.size.as_deref(), Some("2560x1440"));
        assert_eq!(
            body.get("size"),
            Some(&Value::String("2560x1440".to_string()))
        );
        assert_eq!(
            body.get("aspect_ratio"),
            Some(&Value::String("16:9".to_string()))
        );
        assert!(!body.contains_key("image_size"));
        assert_eq!(
            body.get("image_backend"),
            Some(&Value::String("auto".to_string()))
        );
        assert_eq!(
            body.get("model"),
            Some(&Value::String("gpt-image-2".to_string()))
        );
        assert_eq!(
            body.get("quality"),
            Some(&Value::String("medium".to_string()))
        );
        assert!(prompt.contains("final image aspect ratio must be exactly 16:9"));
        assert!(!prompt.contains("__gpt2api_image_size"));
    }

    #[test]
    fn build_openai_edits_prompt_text_omits_gpt2api_size_tag() {
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
            "make it cinematic".to_string()
        );
        assert_eq!(fields.request_model, "gpt-image-2");
        assert_eq!(fields.size.as_deref(), Some("2160x3840"));
        assert_eq!(fields.quality.as_deref(), Some("high"));
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
            Some(&Value::String("gpt-image-2".to_string()))
        );
        assert_eq!(body.get("n"), Some(&json!(1)));
        assert_eq!(
            body.get("image_backend"),
            Some(&Value::String("auto".to_string()))
        );
        assert_eq!(
            body.get("quality"),
            Some(&Value::String("medium".to_string()))
        );
        let prompt = body
            .get("prompt")
            .and_then(Value::as_str)
            .expect("expected prompt");
        assert!(prompt.starts_with("make it cinematic"));
        assert!(prompt.contains("final image aspect ratio must be exactly 16:9"));
        assert_eq!(
            body.get("size"),
            Some(&Value::String("2560x1440".to_string()))
        );
        assert_eq!(
            body.get("aspect_ratio"),
            Some(&Value::String("16:9".to_string()))
        );
        assert!(!body.contains_key("image_size"));
    }

    #[test]
    fn build_openai_generations_body_for_base_gpt_image_2_uses_size_and_quality_params() {
        let mut extra_params = std::collections::HashMap::new();
        extra_params.insert("quality".to_string(), Value::String("high".to_string()));
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: Some(extra_params),
        };

        let fields = NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2")
            .expect("expected gpt-image-2 fields");
        let body = NewApiProvider::build_openai_generations_body(&request, &fields);

        assert_eq!(
            body.get("model"),
            Some(&Value::String("gpt-image-2".to_string()))
        );
        assert_eq!(
            body.get("size"),
            Some(&Value::String("2880x2880".to_string()))
        );
        assert_eq!(
            body.get("quality"),
            Some(&Value::String("high".to_string()))
        );
    }

    #[test]
    fn build_openai_generations_body_for_gpt_image_2_allows_auto_quality() {
        let mut extra_params = std::collections::HashMap::new();
        extra_params.insert("quality".to_string(), Value::String("auto".to_string()));
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: None,
            extra_params: Some(extra_params),
        };

        let fields = NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2")
            .expect("expected gpt-image-2 fields");
        let body = NewApiProvider::build_openai_generations_body(&request, &fields);

        assert_eq!(
            body.get("quality"),
            Some(&Value::String("auto".to_string()))
        );
    }

    #[test]
    fn build_openai_request_fields_for_oopii_all_image_2_keeps_model_and_uses_exact_3_4_size() {
        let mut extra_params = std::collections::HashMap::new();
        extra_params.insert("quality".to_string(), Value::String("medium".to_string()));
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "oopii/all-image-2".to_string(),
            size: "2K".to_string(),
            aspect_ratio: "3:4".to_string(),
            reference_images: None,
            extra_params: Some(extra_params),
        };

        let fields = NewApiProvider::resolve_openai_request_fields(&request, "all-image-2")
            .expect("expected all-image-2 fields");
        let body = NewApiProvider::build_openai_generations_body(&request, &fields);

        assert_eq!(fields.request_model, "all-image-2".to_string());
        assert_eq!(fields.size.as_deref(), Some("1728x2304"));
        assert_eq!(
            body.get("model"),
            Some(&Value::String("all-image-2".to_string()))
        );
        assert_eq!(
            body.get("size"),
            Some(&Value::String("1728x2304".to_string()))
        );
        assert_eq!(
            body.get("aspect_ratio"),
            Some(&Value::String("3:4".to_string()))
        );
    }

    #[test]
    fn gpt_image_2_exact_size_table_covers_all_supported_ratios() {
        for (resolution, aspect_ratio, expected_size) in gpt2api_expected_size_cases() {
            let request = crate::ai::GenerateRequest {
                prompt: "make it cinematic".to_string(),
                model: "newapi/gpt-image-2".to_string(),
                size: resolution.to_string(),
                aspect_ratio: aspect_ratio.to_string(),
                reference_images: None,
                extra_params: None,
            };

            let fields = NewApiProvider::resolve_openai_request_fields(&request, "gpt-image-2")
                .unwrap_or_else(|_| {
                    panic!(
                        "expected mapping for resolution={} aspect_ratio={}",
                        resolution, aspect_ratio
                    )
                });

            assert_eq!(
                fields.request_model, "gpt-image-2",
                "unexpected model for resolution={} aspect_ratio={}",
                resolution, aspect_ratio
            );
            assert_eq!(
                fields.size.as_deref(),
                Some(expected_size),
                "unexpected size for resolution={} aspect_ratio={}",
                resolution,
                aspect_ratio
            );
            assert_eq!(
                fields.aspect_ratio.as_deref(),
                Some(aspect_ratio),
                "aspect_ratio field should be preserved for resolution={} aspect_ratio={}",
                resolution,
                aspect_ratio
            );
        }
    }

    #[test]
    fn oopii_all_image_2_exact_size_table_matches_gpt_image_2_for_all_supported_ratios() {
        for (resolution, aspect_ratio, expected_size) in gpt2api_expected_size_cases() {
            let request = crate::ai::GenerateRequest {
                prompt: "make it cinematic".to_string(),
                model: "oopii/all-image-2".to_string(),
                size: resolution.to_string(),
                aspect_ratio: aspect_ratio.to_string(),
                reference_images: None,
                extra_params: None,
            };

            let fields = NewApiProvider::resolve_openai_request_fields(&request, "all-image-2")
                .unwrap_or_else(|_| {
                    panic!(
                        "expected OOpii mapping for resolution={} aspect_ratio={}",
                        resolution, aspect_ratio
                    )
                });
            let body = NewApiProvider::build_openai_generations_body(&request, &fields);

            assert_eq!(
                fields.request_model, "all-image-2",
                "unexpected model for resolution={} aspect_ratio={}",
                resolution, aspect_ratio
            );
            assert_eq!(
                fields.size.as_deref(),
                Some(expected_size),
                "unexpected size for resolution={} aspect_ratio={}",
                resolution,
                aspect_ratio
            );
            assert_eq!(
                body.get("size"),
                Some(&Value::String(expected_size.to_string())),
                "unexpected body size for resolution={} aspect_ratio={}",
                resolution,
                aspect_ratio
            );
            assert_eq!(
                body.get("aspect_ratio"),
                Some(&Value::String(aspect_ratio.to_string())),
                "unexpected body aspect_ratio for resolution={} aspect_ratio={}",
                resolution,
                aspect_ratio
            );
        }
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
            text_fields.first(),
            Some(&("model".to_string(), "gpt-image-2".to_string()))
        );
        let prompt = text_fields
            .iter()
            .find(|(key, _)| key == "prompt")
            .map(|(_, value)| value.as_str())
            .expect("expected prompt text field");
        assert!(prompt.starts_with("make it cinematic"));
        assert!(prompt.contains("final image aspect ratio must be exactly 9:16"));
        assert!(text_fields.contains(&("n".to_string(), "1".to_string())));
        assert!(text_fields.contains(&("size".to_string(), "2160x3840".to_string())));
        assert!(text_fields.contains(&("aspect_ratio".to_string(), "9:16".to_string())));
        assert!(text_fields.contains(&("image_backend".to_string(), "auto".to_string())));
        assert!(text_fields.contains(&("quality".to_string(), "high".to_string())));
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
    fn multipart_reqwest_fallback_detects_local_curl_failures() {
        assert!(
            NewApiProvider::should_fallback_to_reqwest_for_multipart_provider_error(
                "NewAPI openai-images-edits curl transport failed: Access is denied"
            )
        );
        assert!(NewApiProvider::should_fallback_to_reqwest_for_multipart_provider_error(
            "Failed to run curl for NewAPI openai-images-edits request: The system cannot find the path specified"
        ));
    }

    #[test]
    fn multipart_reqwest_fallback_skips_timeout_failures() {
        assert!(!NewApiProvider::should_fallback_to_reqwest_for_multipart_provider_error(
            "NewAPI openai-images-edits curl transport failed: Operation timed out after 240001 milliseconds"
        ));
        assert!(!NewApiProvider::should_fallback_to_reqwest_for_multipart_error(
            &AIError::Provider(
                "NewAPI openai-images-edits curl transport failed: Operation timed out after 240001 milliseconds".to_string()
            )
        ));
    }

    #[test]
    fn openai_images_generations_prefers_curl_json_transport() {
        assert!(NewApiProvider::should_use_curl_json_transport(
            "openai-images-generations",
            512
        ));
        assert!(!NewApiProvider::should_use_curl_json_transport(
            "openai-chat",
            512
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
    fn extract_config_forces_gpt_image_2_to_openai_images_route() {
        let mut extra_params = HashMap::new();
        extra_params.insert(
            "newapi_config".to_string(),
            json!({
                "api_format": "openai-edits",
                "endpoint_url": "https://www.oopii.cn/",
                "request_model": "gpt-image-2-4k-high",
                "display_name": "gpt-image-2",
            }),
        );
        let request = crate::ai::GenerateRequest {
            prompt: "make it cinematic".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "9:16".to_string(),
            reference_images: Some(vec!["https://example.com/reference.png".to_string()]),
            extra_params: Some(extra_params),
        };

        let config = NewApiProvider::extract_config(&request).expect("expected NewAPI config");

        assert_eq!(config.api_format, super::NewApiFormat::OpenAiImages);
        assert_eq!(config.request_model, "gpt-image-2-4k-high");
    }

    #[test]
    fn should_not_use_task_resume_for_openai_images_requests() {
        let mut extra_params = HashMap::new();
        extra_params.insert(
            "newapi_config".to_string(),
            json!({
                "api_format": "openai-images",
                "endpoint_url": "https://www.oopii.cn/",
                "request_model": "gpt-image-2",
                "display_name": "gpt-image-2",
            }),
        );
        let request = crate::ai::GenerateRequest {
            prompt: "extract the logo".to_string(),
            model: "newapi/gpt-image-2".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "16:9".to_string(),
            reference_images: Some(vec!["https://example.com/reference.png".to_string()]),
            extra_params: Some(extra_params),
        };

        let provider = NewApiProvider::new();
        assert!(!provider.should_use_task_resume(&request));
    }

    #[test]
    fn should_not_use_task_resume_for_openai_compatible_requests() {
        let mut extra_params = HashMap::new();
        extra_params.insert(
            "newapi_config".to_string(),
            json!({
                "api_format": "openai",
                "endpoint_url": "https://example.com/v1",
                "request_model": "gpt-4.1",
                "display_name": "gpt-4.1",
            }),
        );
        let request = crate::ai::GenerateRequest {
            prompt: "describe this".to_string(),
            model: "newapi/gpt-4.1".to_string(),
            size: "1K".to_string(),
            aspect_ratio: "1:1".to_string(),
            reference_images: None,
            extra_params: Some(extra_params),
        };

        let provider = NewApiProvider::new();
        assert!(!provider.should_use_task_resume(&request));
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

    #[test]
    fn identifies_base_and_alias_gpt_image_2_models() {
        assert!(NewApiProvider::is_gpt2api_image_request_model(
            "gpt-image-2"
        ));
        assert!(NewApiProvider::is_gpt2api_image_request_model(
            "gpt-image-2-4k-high"
        ));
        assert!(NewApiProvider::is_gpt2api_image_request_model(
            "all-image-2"
        ));
        assert!(!NewApiProvider::is_gpt2api_image_request_model("gpt-4.1"));
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

    fn supports_task_resume(&self) -> bool {
        false
    }

    fn should_use_task_resume(&self, request: &GenerateRequest) -> bool {
        let _ = request;
        false
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let api_key = self.get_api_key().await?;
        let config = Self::extract_config(&request)?;
        let payload = match config.api_format {
            NewApiFormat::GeminiGenerateContent => {
                self.run_generate_content(&request, &config, &api_key)
                    .await?
            }
            NewApiFormat::OpenAiImages => {
                self.run_openai_images_with_chat_fallback(&request, &config, &api_key)
                    .await?
            }
            NewApiFormat::OpenAiCompatible => {
                self.run_openai_compatible(&request, &config, &api_key)
                    .await?
            }
        };
        let image_source = match self.sync_payload_to_submission(payload, &config)? {
            ProviderTaskSubmission::Succeeded(image_source) => image_source,
            ProviderTaskSubmission::Queued(_) => {
                return Err(AIError::Provider(
                    "NewAPI image response unexpectedly returned async task data".to_string(),
                ));
            }
        };
        Ok(ProviderTaskSubmission::Succeeded(image_source))
    }

    async fn poll_task(
        &self,
        _handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        Err(AIError::Provider(
            "NewAPI image task polling is not supported by standard NewAPI image endpoints"
                .to_string(),
        ))
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
                self.run_openai_images_with_chat_fallback(&request, &config, &api_key)
                    .await?
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
