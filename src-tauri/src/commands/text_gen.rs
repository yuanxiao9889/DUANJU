use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::providers::build_default_providers;
use crate::ai::providers::compatible::{CompatibleApiFormat, CompatibleProvider};
use crate::ai::{GenerateRequest, ProviderRegistry};

static TEXT_REGISTRY: std::sync::OnceLock<ProviderRegistry> = std::sync::OnceLock::new();
static ACTIVE_TEXT_MODEL_STATUS: std::sync::OnceLock<Arc<RwLock<Option<ActiveTextModelStatus>>>> =
    std::sync::OnceLock::new();
static CANCELLED_DIRECTOR_STREAM_REQUESTS: std::sync::OnceLock<Arc<RwLock<HashSet<String>>>> =
    std::sync::OnceLock::new();
static CANCELLED_COMMERCE_AGENT_STREAM_REQUESTS: std::sync::OnceLock<Arc<RwLock<HashSet<String>>>> =
    std::sync::OnceLock::new();

const SCRIPT_DIRECTOR_STORYBOARD_STREAM_EVENT: &str = "script-director-storyboard-stream";
const COMMERCE_AD_AGENT_STREAM_EVENT: &str = "commerce-ad-agent-stream";

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

fn cancelled_director_stream_requests() -> &'static Arc<RwLock<HashSet<String>>> {
    CANCELLED_DIRECTOR_STREAM_REQUESTS.get_or_init(|| Arc::new(RwLock::new(HashSet::new())))
}

fn cancelled_commerce_agent_stream_requests() -> &'static Arc<RwLock<HashSet<String>>> {
    CANCELLED_COMMERCE_AGENT_STREAM_REQUESTS.get_or_init(|| Arc::new(RwLock::new(HashSet::new())))
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
    pub extra_params: Option<HashMap<String, Value>>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScriptDirectorStoryboardStreamRequestDto {
    pub content: String,
    pub request_id: String,
    pub batch_label: Option<String>,
    pub model: String,
    pub provider: String,
    pub api_key: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub extra_params: Option<HashMap<String, Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScriptDirectorStoryboardStreamResponseDto {
    pub request_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommerceAdAgentStreamRequestDto {
    pub prompt: String,
    pub request_id: String,
    pub model: String,
    pub provider: String,
    pub api_key: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub reference_images: Option<Vec<String>>,
    pub extra_params: Option<HashMap<String, Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommerceAdAgentStreamResponseDto {
    pub request_id: String,
}

#[derive(Debug, Clone)]
struct StoryboardOutlineRow {
    row_id: String,
    seq: u32,
    scene_number: String,
    shot_number: String,
    sketch: String,
    shot_size: String,
    camera_angle: String,
    camera_movement: String,
    blocking_action: String,
    dialogue_or_sound: String,
    character_ids: Vec<String>,
    scene_id: String,
    item_ids: Vec<String>,
    mood: String,
    remark: String,
    asset_refs: Vec<String>,
    duration_seconds: f64,
    is_continuous_with_prev: bool,
}

#[derive(Debug, Clone)]
struct StoryboardRowCompletion {
    row_id: String,
    image_prompt: String,
    reference_asset_hints: Vec<String>,
}

#[derive(Debug, Clone)]
struct StoryboardSummaryState {
    row_count: usize,
    generated_row_count: usize,
    total_duration_seconds: f64,
    continuous_group_count: usize,
    groups10s_count: usize,
    groups15s_count: usize,
}

const DIRECTOR_PROMPT_BATCH_SIZE: usize = 6;

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

fn split_text_for_pseudo_stream(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        let should_flush = matches!(ch, '。' | '！' | '？' | '\n' | '.' | '!' | '?')
            || current.chars().count() >= 36;
        if should_flush {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                chunks.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        chunks.push(trimmed.to_string());
    }
    chunks
}

pub fn parse_openai_chat_sse_delta(line: &str) -> Result<Option<String>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return Ok(None);
    }
    let data = if let Some(data) = trimmed.strip_prefix("data:") {
        data.trim()
    } else if trimmed.starts_with('{') {
        trimmed
    } else {
        return Ok(None);
    };
    if data == "[DONE]" {
        return Ok(None);
    }
    if data.is_empty() {
        return Ok(None);
    }
    let payload: Value = serde_json::from_str(data).map_err(|error| error.to_string())?;
    Ok(payload
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        }))
}

fn normalize_commerce_oopii_chat_model(model: &str) -> String {
    let stripped = model
        .trim()
        .split_once('/')
        .map(|(_, bare)| bare.trim())
        .unwrap_or_else(|| model.trim());
    match stripped.to_ascii_lowercase().as_str() {
        "gpt-5.4" => "all-5.4".to_string(),
        "gpt-5.5" => "all-5.5".to_string(),
        _ => stripped.to_string(),
    }
}

fn is_commerce_oopii_chat_model(model: &str) -> bool {
    let normalized = normalize_commerce_oopii_chat_model(model).to_ascii_lowercase();
    normalized == "all-5.4"
        || normalized == "all-5.5"
        || model.trim().to_ascii_lowercase().starts_with("oopii/")
}

fn ensure_commerce_agent_stream_compatible_config(
    provider: &str,
    model: &str,
    extra_params: &mut Option<HashMap<String, Value>>,
) {
    if !provider.trim().eq_ignore_ascii_case("oopii") || !is_commerce_oopii_chat_model(model) {
        return;
    }

    let params = extra_params.get_or_insert_with(HashMap::new);
    if params.get("compatible_config").is_some() {
        return;
    }

    let request_model = normalize_commerce_oopii_chat_model(model);
    params.insert(
        "compatible_config".to_string(),
        json!({
            "api_format": "openai-chat",
            "endpoint_url": "https://www.oopii.cc/",
            "request_model": request_model,
            "display_name": request_model,
        }),
    );
}

async fn is_director_stream_cancelled(request_id: &str) -> bool {
    cancelled_director_stream_requests()
        .read()
        .await
        .contains(request_id)
}

async fn mark_director_stream_cancelled(request_id: String) {
    cancelled_director_stream_requests()
        .write()
        .await
        .insert(request_id);
}

async fn clear_director_stream_cancelled(request_id: &str) {
    cancelled_director_stream_requests()
        .write()
        .await
        .remove(request_id);
}

async fn is_commerce_agent_stream_cancelled(request_id: &str) -> bool {
    cancelled_commerce_agent_stream_requests()
        .read()
        .await
        .contains(request_id)
}

async fn mark_commerce_agent_stream_cancelled(request_id: String) {
    cancelled_commerce_agent_stream_requests()
        .write()
        .await
        .insert(request_id);
}

async fn clear_commerce_agent_stream_cancelled(request_id: &str) {
    cancelled_commerce_agent_stream_requests()
        .write()
        .await
        .remove(request_id);
}

fn strip_markdown_code_fence(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(stripped) = trimmed.strip_prefix("```json") {
        return stripped.trim().trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        return stripped.trim().trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

fn extract_json_value(text: &str) -> Result<Value, String> {
    let stripped = strip_markdown_code_fence(text);
    if let Ok(value) = serde_json::from_str::<Value>(&stripped) {
        return Ok(value);
    }

    let object_start = stripped.find('{');
    let object_end = stripped.rfind('}');
    if let (Some(start), Some(end)) = (object_start, object_end) {
        if start < end {
            if let Ok(value) = serde_json::from_str::<Value>(&stripped[start..=end]) {
                return Ok(value);
            }
        }
    }

    let array_start = stripped.find('[');
    let array_end = stripped.rfind(']');
    if let (Some(start), Some(end)) = (array_start, array_end) {
        if start < end {
            if let Ok(value) = serde_json::from_str::<Value>(&stripped[start..=end]) {
                return Ok(value);
            }
        }
    }

    Err("Failed to parse JSON from model response".to_string())
}

fn read_string(value: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let normalized = text.trim();
            if !normalized.is_empty() {
                return normalized.to_string();
            }
        }
    }
    String::new()
}

fn read_string_array(value: &Value, keys: &[&str]) -> Vec<String> {
    for key in keys {
        if let Some(items) = value.get(*key).and_then(Value::as_array) {
            let mut normalized = Vec::new();
            for item in items {
                if let Some(text) = item.as_str() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && !normalized.iter().any(|existing| existing == trimmed)
                    {
                        normalized.push(trimmed.to_string());
                    }
                }
            }
            if !normalized.is_empty() {
                return normalized;
            }
        }
    }
    Vec::new()
}

fn read_u32(value: &Value, keys: &[&str], fallback: u32) -> u32 {
    for key in keys {
        if let Some(raw) = value.get(*key) {
            if let Some(number) = raw.as_u64() {
                return number as u32;
            }
            if let Some(text) = raw.as_str() {
                if let Ok(parsed) = text.trim().parse::<u32>() {
                    return parsed;
                }
            }
        }
    }
    fallback
}

fn read_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    for key in keys {
        if let Some(raw) = value.get(*key) {
            if let Some(number) = raw.as_f64() {
                return Some(number);
            }
            if let Some(number) = raw.as_u64() {
                return Some(number as f64);
            }
            if let Some(text) = raw.as_str() {
                if let Ok(parsed) = text.trim().parse::<f64>() {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

fn estimate_duration_seconds(
    frame_description: &str,
    motion_hint: &str,
    has_dialogue: bool,
    is_continuous_with_prev: bool,
) -> f64 {
    let text_length = frame_description.chars().count();
    let mut duration: f64 = if text_length <= 12 {
        2.0
    } else if text_length <= 28 {
        3.0
    } else {
        4.0
    };
    if !motion_hint.trim().is_empty() {
        duration += 0.5;
    }
    if has_dialogue {
        duration += 0.5;
    }
    if !is_continuous_with_prev {
        duration += 0.5;
    }
    (duration.clamp(1.5, 6.0) * 2.0).round() / 2.0
}

fn compute_is_continuous_with_prev(
    previous_row: Option<&StoryboardOutlineRow>,
    next_scene_id: &str,
    next_character_ids: &[String],
    next_item_ids: &[String],
) -> bool {
    let Some(previous) = previous_row else {
        return false;
    };

    if previous.scene_id.trim() != next_scene_id.trim() {
        return false;
    }

    if previous
        .character_ids
        .iter()
        .any(|item| next_character_ids.iter().any(|next| next == item))
    {
        return true;
    }

    previous
        .item_ids
        .iter()
        .any(|item| next_item_ids.iter().any(|next| next == item))
}

fn compute_storyboard_summary(
    rows: &[StoryboardOutlineRow],
    generated_row_count: usize,
) -> StoryboardSummaryState {
    let total_duration_seconds =
        (rows.iter().map(|row| row.duration_seconds).sum::<f64>() * 10.0).round() / 10.0;

    let mut continuous_group_count = 0usize;
    for (index, row) in rows.iter().enumerate() {
        if index == 0 || !row.is_continuous_with_prev {
            continuous_group_count += 1;
        }
    }

    let groups10s_count = compute_duration_group_count(rows, 10.0);
    let groups15s_count = compute_duration_group_count(rows, 15.0);

    StoryboardSummaryState {
        row_count: rows.len(),
        generated_row_count,
        total_duration_seconds,
        continuous_group_count,
        groups10s_count,
        groups15s_count,
    }
}

fn compute_duration_group_count(rows: &[StoryboardOutlineRow], limit_seconds: f64) -> usize {
    if rows.is_empty() {
        return 0;
    }

    let mut count = 0usize;
    let mut current_duration = 0.0;
    for row in rows {
        if current_duration > 0.0 && current_duration + row.duration_seconds > limit_seconds {
            count += 1;
            current_duration = 0.0;
        }
        current_duration += row.duration_seconds;
    }

    if current_duration > 0.0 {
        count += 1;
    }

    count
}

fn build_script_director_blueprint_prompt(content: &str, batch_label: Option<&str>) -> String {
    let mut lines = vec![
        "You are a professional director storyboard planner for image generation.".to_string(),
        "Your job is to break the source packet into a director storyboard table that looks like a production-ready shot list.".to_string(),
        "Return strict JSON only. Do not add markdown. Do not explain.".to_string(),
        "".to_string(),
        "Rules:".to_string(),
        "1. Cover the full dramatic progression of the source text without skipping important actions, reveals, reversals, or space changes.".to_string(),
        "2. Each row must represent one shootable image moment and directly support downstream image generation.".to_string(),
        "3. Favor continuous shot segments when the same space, same axis, and same interaction continue.".to_string(),
        "4. Split when there is a clear pause, view change, emotional turn, space change, or narrative emphasis shift.".to_string(),
        "5. sketch must describe the visible frame, not abstract literary summary.".to_string(),
        "6. shotSize should use concrete values like wide shot, medium shot, close-up, extreme close-up, over-shoulder, etc.".to_string(),
        "7. cameraAngle and cameraMovement must be separated. Do not merge them into one field.".to_string(),
        "8. blockingAction should describe character staging, pose, direction, and motion trend in the frame.".to_string(),
        "9. dialogueOrSound should include spoken lines, voice-over, ambience, SFX, or silence cues that matter to the shot.".to_string(),
        "10. characterIds, sceneId, and itemIds should reuse asset names already present in the source packet whenever possible.".to_string(),
        "11. sceneNumber should be a stable short label such as 1-1, 1-2, or S1. shotNumber should be sequential within the table.".to_string(),
        "12. remark should hold directing notes, continuity reminders, or narrative emphasis for the shot.".to_string(),
        "".to_string(),
        "Return this JSON structure:".to_string(),
        "{".to_string(),
        "  \"rows\": [".to_string(),
        "    {".to_string(),
        "      \"seq\": 1,".to_string(),
        "      \"sceneNumber\": \"1-1\",".to_string(),
        "      \"shotNumber\": \"1\",".to_string(),
        "      \"sketch\": \"visible frame sketch in the same primary language as the source\",".to_string(),
        "      \"shotSize\": \"wide shot / medium shot / close-up / etc\",".to_string(),
        "      \"cameraAngle\": \"eye level / low angle / high angle / over shoulder / etc\",".to_string(),
        "      \"cameraMovement\": \"locked / pan / tilt / push in / pull back / handheld follow / etc\",".to_string(),
        "      \"blockingAction\": \"what the characters are doing and how they are staged\",".to_string(),
        "      \"dialogueOrSound\": \"spoken line, voice-over, ambience, SFX, or silence cue\",".to_string(),
        "      \"durationSeconds\": 4,".to_string(),
        "      \"characterIds\": [\"character name\"],".to_string(),
        "      \"sceneId\": \"scene name\",".to_string(),
        "      \"itemIds\": [\"item name\"],".to_string(),
        "      \"mood\": \"mood or tone\",".to_string(),
        "      \"remark\": \"continuity note, performance note, or directing emphasis\",".to_string(),
        "      \"assetRefs\": [\"人物 A\", \"场景 B\", \"物品 C\"]".to_string(),
        "    }".to_string(),
        "  ]".to_string(),
        "}".to_string(),
    ];

    if let Some(label) = batch_label {
        let trimmed = label.trim();
        if !trimmed.is_empty() {
            lines.push("".to_string());
            lines.push(format!("Batch label: {trimmed}"));
        }
    }

    lines.push("".to_string());
    lines.push("Source packet:".to_string());
    lines.push(content.trim().to_string());
    lines.join("\n")
}

fn build_script_director_row_batch_prompt(content: &str, rows: &[StoryboardOutlineRow]) -> String {
    let rows_json: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "rowId": row.row_id,
                "seq": row.seq,
                "sceneNumber": row.scene_number,
                "shotNumber": row.shot_number,
                "sketch": row.sketch,
                "shotSize": row.shot_size,
                "cameraAngle": row.camera_angle,
                "cameraMovement": row.camera_movement,
                "blockingAction": row.blocking_action,
                "dialogueOrSound": row.dialogue_or_sound,
                "durationSeconds": row.duration_seconds,
                "characterIds": row.character_ids,
                "sceneId": row.scene_id,
                "itemIds": row.item_ids,
                "mood": row.mood,
                "remark": row.remark,
                "assetRefs": row.asset_refs
            })
        })
        .collect();

    [
        "You are a professional director storyboard prompt writer.",
        "Generate production-ready image prompts for the provided storyboard rows in one batch.",
        "Return strict JSON only. Do not add markdown. Do not explain.",
        "",
        "Rules:",
        "1. Return exactly one output object for each input row. Preserve rowId exactly.",
        "2. imagePrompt must be directly usable for image generation.",
        "3. Keep the output in the same primary language as the source packet.",
        "4. The prompt should feel like the final '生成提示词' cell of a director storyboard table, not a generic caption.",
        "5. Multi-character rows must clearly describe spatial relationships.",
        "6. Single-character rows must clearly describe gaze, facing direction, and starting pose.",
        "7. Motion should be described as starting frame plus motion trend, not only the final static result.",
        "8. Reuse scene continuity, prop continuity, and recognizable character features from the source packet.",
        "9. referenceAssetHints should prefer labels like 角色 X / 场景 Y / 物品 Z when the source language is Chinese.",
        "",
        "Return this JSON structure:",
        "{",
        "  \"rows\": [",
        "    {",
        "      \"rowId\": \"row-1\",",
        "      \"imagePrompt\": \"full image prompt\",",
        "      \"referenceAssetHints\": [\"角色 A\", \"场景 B\", \"物品 C\"]",
        "    }",
        "  ]",
        "}",
        "",
        "Source packet:",
        content.trim(),
        "",
        "Current row blueprints:",
        &serde_json::to_string_pretty(&rows_json).unwrap_or_else(|_| "[]".to_string()),
    ]
    .join("\n")
}

fn parse_storyboard_outline_rows(value: &Value) -> Result<Vec<StoryboardOutlineRow>, String> {
    let rows_value = value
        .get("rows")
        .and_then(Value::as_array)
        .or_else(|| value.get("lineBlueprints").and_then(Value::as_array))
        .or_else(|| value.get("rows").and_then(Value::as_array))
        .ok_or_else(|| "Storyboard blueprint response is missing rows".to_string())?;

    let mut rows = Vec::new();
    for (index, item) in rows_value.iter().enumerate() {
        let seq = read_u32(item, &["seq", "shotNumber"], (index + 1) as u32);
        let scene_number = read_string(item, &["sceneNumber", "sceneLabel", "sceneNo"]);
        let shot_number = read_string(item, &["shotNumber", "shotNo"]);
        let sketch = read_string(item, &["sketch", "frameDescription", "comicText"]);
        let shot_size = read_string(item, &["shotSize", "shotHint", "shotType"]);
        let camera_angle = read_string(
            item,
            &[
                "cameraAngle",
                "compositionHint",
                "composition",
                "cameraAngleHint",
            ],
        );
        let camera_movement = read_string(
            item,
            &["cameraMovement", "cameraHint", "camera", "cameraMove"],
        );
        let blocking_action = read_string(
            item,
            &[
                "blockingAction",
                "motionHint",
                "motion",
                "action",
                "blocking",
            ],
        );
        let dialogue_or_sound =
            read_string(item, &["dialogueOrSound", "dialogue", "sound", "audioCue"]);
        let character_ids = read_string_array(item, &["characterIds", "characterNames"]);
        let item_ids = read_string_array(item, &["itemIds", "itemNames"]);
        let scene_id = read_string(item, &["sceneId", "sceneName"]);
        let mood = read_string(item, &["mood", "tone"]);
        let remark = read_string(item, &["remark", "note", "notes", "plotPoint", "storyBeat"]);
        let asset_refs = read_string_array(
            item,
            &["assetRefs", "referenceAssetHints", "mentionedMaterials"],
        );
        let duration_seconds =
            read_f64(item, &["durationSeconds", "duration", "rhythmDuration"]).unwrap_or(0.0);

        if sketch.is_empty() && blocking_action.is_empty() && remark.is_empty() {
            continue;
        }

        let is_continuous_with_prev =
            compute_is_continuous_with_prev(rows.last(), &scene_id, &character_ids, &item_ids);
        let duration_seconds = if duration_seconds > 0.0 {
            duration_seconds
        } else {
            estimate_duration_seconds(
                &sketch,
                &blocking_action,
                !dialogue_or_sound.trim().is_empty(),
                is_continuous_with_prev,
            )
        };

        rows.push(StoryboardOutlineRow {
            row_id: format!("row-{}", index + 1),
            seq,
            scene_number: if scene_number.is_empty() {
                format!("S{}", index + 1)
            } else {
                scene_number
            },
            shot_number: if shot_number.is_empty() {
                seq.to_string()
            } else {
                shot_number
            },
            sketch,
            shot_size,
            camera_angle,
            camera_movement,
            blocking_action,
            dialogue_or_sound,
            character_ids,
            scene_id,
            item_ids,
            mood,
            remark,
            asset_refs,
            duration_seconds,
            is_continuous_with_prev,
        });
    }

    if rows.is_empty() {
        return Err("Storyboard blueprint response did not contain any valid rows".to_string());
    }

    Ok(rows)
}

fn parse_storyboard_row_completion(
    value: &Value,
    row: &StoryboardOutlineRow,
) -> StoryboardRowCompletion {
    let image_prompt = read_string(value, &["imagePrompt"]);
    let reference_asset_hints = {
        let hints = read_string_array(value, &["referenceAssetHints"]);
        if hints.is_empty() {
            let mut merged = row.asset_refs.clone();
            if merged.is_empty() {
                for item in &row.character_ids {
                    let label = format!("人物 {}", item.trim());
                    if !merged.iter().any(|existing| existing == &label) {
                        merged.push(label);
                    }
                }
                if !row.scene_id.trim().is_empty() {
                    let label = format!("场景 {}", row.scene_id.trim());
                    if !merged.iter().any(|item| item == &label) {
                        merged.push(label);
                    }
                }
                for item in &row.item_ids {
                    let label = format!("物品 {}", item.trim());
                    if !merged.iter().any(|existing| existing == &label) {
                        merged.push(label);
                    }
                }
            }
            merged
        } else {
            hints
        }
    };

    StoryboardRowCompletion {
        row_id: row.row_id.clone(),
        image_prompt,
        reference_asset_hints,
    }
}

fn fallback_storyboard_row_completion(row: &StoryboardOutlineRow) -> StoryboardRowCompletion {
    parse_storyboard_row_completion(&json!({}), row)
}

fn parse_storyboard_row_batch_completions(
    value: &Value,
    rows: &[StoryboardOutlineRow],
) -> Vec<StoryboardRowCompletion> {
    let items = value
        .get("rows")
        .and_then(Value::as_array)
        .or_else(|| value.get("items").and_then(Value::as_array))
        .or_else(|| value.as_array());

    rows.iter()
        .map(|row| {
            let matched = items.and_then(|items| {
                items.iter().find(|item| {
                    read_string(item, &["rowId", "row_id"]) == row.row_id
                        || read_u32(item, &["seq", "shotNumber"], 0) == row.seq
                })
            });

            matched
                .map(|item| {
                    let mut completion = parse_storyboard_row_completion(item, row);
                    completion.row_id = row.row_id.clone();
                    completion
                })
                .unwrap_or_else(|| fallback_storyboard_row_completion(row))
        })
        .collect()
}

async fn resolve_text_provider_for_stream(
    request: &ScriptDirectorStoryboardStreamRequestDto,
) -> Result<Arc<dyn crate::ai::AIProvider>, String> {
    let switch_started_at = Instant::now();
    let registry = get_text_registry();
    let provider = registry
        .get_provider(request.provider.trim())
        .ok_or_else(|| format!("Provider '{}' not found", request.provider))?
        .clone();

    provider
        .set_api_key(request.api_key.trim().to_string())
        .await
        .map_err(|error| error.to_string())?;

    update_active_text_model(provider.name(), request.model.as_str(), switch_started_at).await;
    Ok(provider)
}

async fn generate_text_with_provider(
    provider: Arc<dyn crate::ai::AIProvider>,
    request: &ScriptDirectorStoryboardStreamRequestDto,
    prompt: String,
) -> Result<String, String> {
    let wrapped_prompt = format!(
        "You are a professional storyboard assistant. Output only the requested JSON.\n\n{}",
        prompt
    );

    provider
        .generate(GenerateRequest {
            prompt: wrapped_prompt,
            model: request.model.clone(),
            size: String::new(),
            aspect_ratio: String::new(),
            reference_images: None,
            extra_params: request
                .extra_params
                .clone()
                .filter(|params| !params.is_empty()),
        })
        .await
        .map_err(|error| error.to_string())
}

fn emit_director_stream_event(app: &tauri::AppHandle, payload: Value) -> Result<(), String> {
    app.emit(SCRIPT_DIRECTOR_STORYBOARD_STREAM_EVENT, payload)
        .map_err(|error: tauri::Error| error.to_string())
}

async fn emit_director_stream_cancelled(
    app: &tauri::AppHandle,
    request_id: &str,
) -> Result<(), String> {
    emit_director_stream_event(
        app,
        json!({
            "type": "stream_cancelled",
            "requestId": request_id,
            "message": "已取消本次导演分镜生成。"
        }),
    )
}

fn emit_commerce_agent_stream_event(app: &tauri::AppHandle, payload: Value) -> Result<(), String> {
    app.emit(COMMERCE_AD_AGENT_STREAM_EVENT, payload)
        .map_err(|error: tauri::Error| error.to_string())
}

async fn emit_commerce_agent_stream_cancelled(
    app: &tauri::AppHandle,
    request_id: &str,
) -> Result<(), String> {
    emit_commerce_agent_stream_event(
        app,
        json!({
            "type": "stream_cancelled",
            "requestId": request_id,
            "message": "已停止生成。",
        }),
    )
}

async fn run_commerce_ad_agent_openai_chat_sse(
    app: &tauri::AppHandle,
    request: &CommerceAdAgentStreamRequestDto,
    req: &GenerateRequest,
) -> Result<Option<String>, String> {
    let config = CompatibleProvider::extract_config(req).map_err(|error| error.to_string())?;
    if config.api_format != CompatibleApiFormat::OpenAiChat {
        return Ok(None);
    }

    let endpoint = CompatibleProvider::resolve_openai_endpoint(
        &config.endpoint_url,
        CompatibleApiFormat::OpenAiChat,
    );
    let message_content = if let Some(reference_images) = req
        .reference_images
        .as_ref()
        .filter(|images| !images.is_empty())
    {
        let mut content = vec![json!({
            "type": "text",
            "text": req.prompt.trim(),
        })];
        for source in reference_images {
            content.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": CompatibleProvider::source_to_data_url(source)
                        .await
                        .map_err(|error| error.to_string())?
                }
            }));
        }
        Value::Array(content)
    } else {
        Value::String(req.prompt.trim().to_string())
    };

    let body = json!({
        "model": CompatibleProvider::sanitize_model(&config.request_model),
        "messages": [{
            "role": "user",
            "content": message_content
        }],
        "temperature": request.temperature.unwrap_or(0.35),
        "max_tokens": request.max_tokens.unwrap_or(1200),
        "stream": true,
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .version(reqwest::Version::HTTP_11)
        .bearer_auth(request.api_key.trim())
        .header("X-API-Key", request.api_key.trim())
        .header("Accept", "text/event-stream")
        .header("Content-Type", "application/json")
        .header("User-Agent", "Storyboard-Copilot/commerce-agent-stream")
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Stream request failed {}: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let mut full_text = String::new();
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        if is_commerce_agent_stream_cancelled(&request.request_id).await {
            emit_commerce_agent_stream_cancelled(app, &request.request_id).await?;
            return Ok(Some(full_text));
        }
        let bytes = item.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(newline_index) = buffer.find('\n') {
            let line = buffer[..newline_index].to_string();
            buffer = buffer[newline_index + 1..].to_string();
            if line.trim() == "data: [DONE]" || line.trim() == "data:[DONE]" {
                return Ok(Some(full_text));
            }
            if let Some(delta) = parse_openai_chat_sse_delta(&line)? {
                if delta.is_empty() {
                    continue;
                }
                full_text.push_str(&delta);
                emit_commerce_agent_stream_event(
                    app,
                    json!({
                        "type": "text_delta",
                        "requestId": request.request_id,
                        "delta": delta,
                    }),
                )?;
            }
        }
    }

    Ok(Some(full_text))
}

async fn run_commerce_ad_agent_stream_job(
    app: tauri::AppHandle,
    request: CommerceAdAgentStreamRequestDto,
) {
    let result: Result<(), String> = async {
        clear_commerce_agent_stream_cancelled(&request.request_id).await;
        let switch_started_at = Instant::now();
        let registry = get_text_registry();
        let provider = registry
            .get_provider(request.provider.trim())
            .ok_or_else(|| format!("Provider '{}' not found", request.provider.trim()))?
            .clone();
        provider
            .set_api_key(request.api_key.trim().to_string())
            .await
            .map_err(|error| error.to_string())?;
        update_active_text_model(provider.name(), request.model.as_str(), switch_started_at).await;

        let mut extra_params = request.extra_params.clone().filter(|params| !params.is_empty());
        ensure_commerce_agent_stream_compatible_config(
            request.provider.trim(),
            request.model.as_str(),
            &mut extra_params,
        );

        let req = GenerateRequest {
            prompt: request.prompt.clone(),
            model: request.model.clone(),
            size: String::new(),
            aspect_ratio: String::new(),
            reference_images: request.reference_images.clone().filter(|items| !items.is_empty()),
            extra_params,
        };

        emit_commerce_agent_stream_event(
            &app,
            json!({
                "type": "stream_started",
                "requestId": request.request_id,
                "message": "开始分析图片和技能上下文。",
            }),
        )?;
        emit_commerce_agent_stream_event(
            &app,
            json!({
                "type": "phase_changed",
                "requestId": request.request_id,
                "phase": "image_analysis",
                "message": "正在分析图片",
            }),
        )?;

        let has_openai_chat_compatible_config = req
            .extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .and_then(|value| value.get("api_format"))
            .and_then(Value::as_str)
            .map(|value| value == "openai-chat")
            .unwrap_or(false);
        let attempted_token_stream = has_openai_chat_compatible_config;
        let streamed_text = if has_openai_chat_compatible_config {
            match run_commerce_ad_agent_openai_chat_sse(&app, &request, &req).await {
                Ok(text) => text,
                Err(error) => {
                    emit_commerce_agent_stream_event(
                        &app,
                        json!({
                            "type": "phase_changed",
                            "requestId": request.request_id,
                            "phase": "skill_work",
                            "message": format!("真实 token 流式连接失败，正在降级为分段输出：{}", error),
                        }),
                    )?;
                    None
                }
            }
        } else if request.provider.trim().eq_ignore_ascii_case("oopii") && is_commerce_oopii_chat_model(&request.model) {
            emit_commerce_agent_stream_event(
                &app,
                json!({
                    "type": "phase_changed",
                    "requestId": request.request_id,
                    "phase": "skill_work",
                    "message": "OOpii 已按 OpenAI Chat 流式配置重试，但请求缺少 compatible_config，正在降级为分段输出。",
                }),
            )?;
            None
        } else {
            None
        };

        let full_text = if let Some(text) = streamed_text {
            text
        } else {
            let fallback_message = if attempted_token_stream {
                "真实 token 流式连接失败，正在使用分段输出。"
            } else {
                "当前模型未配置真实 token 流式通道，正在使用分段输出。"
            };
            emit_commerce_agent_stream_event(
                &app,
                json!({
                    "type": "phase_changed",
                    "requestId": request.request_id,
                    "phase": "skill_work",
                    "message": fallback_message,
                }),
            )?;
            let text = provider.generate(req).await.map_err(|error| error.to_string())?;
            for chunk in split_text_for_pseudo_stream(&text) {
                if is_commerce_agent_stream_cancelled(&request.request_id).await {
                    emit_commerce_agent_stream_cancelled(&app, &request.request_id).await?;
                    return Ok(());
                }
                emit_commerce_agent_stream_event(
                    &app,
                    json!({
                        "type": "text_delta",
                        "requestId": request.request_id,
                        "delta": chunk,
                    }),
                )?;
                sleep(Duration::from_millis(45)).await;
            }
            text
        };

        emit_commerce_agent_stream_event(
            &app,
            json!({
                "type": "phase_changed",
                "requestId": request.request_id,
                "phase": "finalizing",
                "message": "正在整理结构化结果",
            }),
        )?;
        emit_commerce_agent_stream_event(
            &app,
            json!({
                "type": "message_completed",
                "requestId": request.request_id,
                "text": full_text,
            }),
        )?;
        Ok(())
    }
    .await;

    if let Err(error) = result {
        let _ = emit_commerce_agent_stream_event(
            &app,
            json!({
                "type": "stream_failed",
                "requestId": request.request_id,
                "message": error,
            }),
        );
    }
    clear_commerce_agent_stream_cancelled(&request.request_id).await;
}

async fn run_script_director_storyboard_stream_job(
    app: tauri::AppHandle,
    request: ScriptDirectorStoryboardStreamRequestDto,
) {
    let request_id = request.request_id.clone();
    let result = async {
        clear_director_stream_cancelled(&request_id).await;

        let provider = resolve_text_provider_for_stream(&request).await?;
        emit_director_stream_event(
            &app,
            json!({
                "type": "stream_started",
                "requestId": request_id,
                "message": "正在准备导演分镜生成..."
            }),
        )?;

        let blueprint_prompt =
            build_script_director_blueprint_prompt(&request.content, request.batch_label.as_deref());
        let blueprint_text =
            generate_text_with_provider(provider.clone(), &request, blueprint_prompt).await?;
        if is_director_stream_cancelled(&request_id).await {
            emit_director_stream_cancelled(&app, &request_id).await?;
            return Ok::<(), String>(());
        }

        let blueprint_value = extract_json_value(&blueprint_text)?;
        let outline_rows = parse_storyboard_outline_rows(&blueprint_value)?;
        let outline_total = outline_rows.len();

        for row in &outline_rows {
            emit_director_stream_event(
                &app,
                json!({
                    "type": "outline_row_created",
                    "requestId": request_id,
                    "totalRows": outline_total,
                    "row": {
                        "rowId": row.row_id,
                        "seq": row.seq,
                        "sceneNumber": row.scene_number,
                        "shotNumber": row.shot_number,
                        "sketch": row.sketch,
                        "shotSize": row.shot_size,
                        "cameraAngle": row.camera_angle,
                        "cameraMovement": row.camera_movement,
                        "blockingAction": row.blocking_action,
                        "dialogueOrSound": row.dialogue_or_sound,
                        "durationSeconds": row.duration_seconds,
                        "characterIds": row.character_ids,
                        "sceneId": row.scene_id,
                        "itemIds": row.item_ids,
                        "mood": row.mood,
                        "remark": row.remark,
                        "assetRefs": row.asset_refs
                    }
                }),
            )?;
        }

        let mut generated_row_count = 0usize;
        let mut summary = compute_storyboard_summary(&outline_rows, generated_row_count);
        emit_director_stream_event(
            &app,
            json!({
                "type": "summary_updated",
                "requestId": request_id,
                "rowCount": summary.row_count,
                "generatedRowCount": summary.generated_row_count,
                "totalDurationSeconds": summary.total_duration_seconds,
                "continuousGroupCount": summary.continuous_group_count,
                "groups10sCount": summary.groups10s_count,
                "groups15sCount": summary.groups15s_count,
                "message": "已完成分镜表骨架创建。"
            }),
        )?;

        for (batch_index, batch) in outline_rows.chunks(DIRECTOR_PROMPT_BATCH_SIZE).enumerate() {
            if is_director_stream_cancelled(&request_id).await {
                emit_director_stream_cancelled(&app, &request_id).await?;
                return Ok(());
            }

            let batch_start_index = batch_index * DIRECTOR_PROMPT_BATCH_SIZE;
            for (offset, row) in batch.iter().enumerate() {
                emit_director_stream_event(
                    &app,
                    json!({
                        "type": "row_generation_started",
                        "requestId": request_id,
                        "rowId": row.row_id,
                        "index": batch_start_index + offset + 1,
                        "totalRows": outline_total,
                        "message": format!(
                            "正在批量生成第 {}-{} / {} 行分镜提示词...",
                            batch_start_index + 1,
                            (batch_start_index + batch.len()).min(outline_total),
                            outline_total
                        )
                    }),
                )?;
            }

            let row_prompt = build_script_director_row_batch_prompt(&request.content, batch);
            let row_text = generate_text_with_provider(provider.clone(), &request, row_prompt).await?;
            if is_director_stream_cancelled(&request_id).await {
                emit_director_stream_cancelled(&app, &request_id).await?;
                return Ok(());
            }

            let row_value = extract_json_value(&row_text)?;
            let completions = parse_storyboard_row_batch_completions(&row_value, batch);

            for completion in completions {
                generated_row_count += 1;

                emit_director_stream_event(
                    &app,
                    json!({
                        "type": "row_generation_completed",
                        "requestId": request_id,
                        "generatedRowCount": generated_row_count,
                        "totalRows": outline_total,
                        "message": format!("已完成第 {} / {} 行分镜提示词。", generated_row_count, outline_total),
                        "row": {
                            "rowId": completion.row_id,
                            "imagePrompt": completion.image_prompt,
                            "referenceAssetHints": completion.reference_asset_hints
                        }
                    }),
                )?;
            }

            summary = compute_storyboard_summary(&outline_rows, generated_row_count);
            emit_director_stream_event(
                &app,
                json!({
                    "type": "summary_updated",
                    "requestId": request_id,
                    "rowCount": summary.row_count,
                    "generatedRowCount": summary.generated_row_count,
                    "totalDurationSeconds": summary.total_duration_seconds,
                    "continuousGroupCount": summary.continuous_group_count,
                    "groups10sCount": summary.groups10s_count,
                    "groups15sCount": summary.groups15s_count,
                    "message": format!("当前已完成 {} / {} 行。", generated_row_count, outline_total)
                }),
            )?;
        }

        emit_director_stream_event(
            &app,
            json!({
                "type": "stream_completed",
                "requestId": request_id,
                "rowCount": summary.row_count,
                "generatedAt": now_ms(),
                "message": "导演分镜表生成完成。"
            }),
        )?;

        Ok(())
    }
    .await;

    if let Err(error) = result {
        let _ = emit_director_stream_event(
            &app,
            json!({
                "type": "stream_failed",
                "requestId": request_id,
                "message": error
            }),
        );
    }

    clear_director_stream_cancelled(&request.request_id).await;
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
        "You are a professional screenwriting assistant. Output only the requested content without any prefatory or explanatory text.\n\n{}",
        request.prompt
    );

    let req = GenerateRequest {
        prompt,
        model: request.model.clone(),
        size: "".to_string(),
        aspect_ratio: "".to_string(),
        reference_images: request.reference_images.filter(|items| !items.is_empty()),
        extra_params: request.extra_params.filter(|params| !params.is_empty()),
    };

    let text_result = provider.generate(req).await.map_err(|e| e.to_string())?;

    Ok(TextGenerationResponseDto {
        text: text_result,
        model: request.model,
    })
}

#[tauri::command]
pub async fn start_script_director_storyboard_stream(
    app: tauri::AppHandle,
    request: ScriptDirectorStoryboardStreamRequestDto,
) -> Result<ScriptDirectorStoryboardStreamResponseDto, String> {
    clear_director_stream_cancelled(&request.request_id).await;
    let app_handle = app.clone();
    let request_clone = request.clone();
    tauri::async_runtime::spawn(async move {
        run_script_director_storyboard_stream_job(app_handle, request_clone).await;
    });

    Ok(ScriptDirectorStoryboardStreamResponseDto {
        request_id: request.request_id,
    })
}

#[tauri::command]
pub async fn cancel_script_director_storyboard_stream(request_id: String) -> Result<(), String> {
    mark_director_stream_cancelled(request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn start_commerce_ad_agent_stream(
    app: tauri::AppHandle,
    request: CommerceAdAgentStreamRequestDto,
) -> Result<CommerceAdAgentStreamResponseDto, String> {
    clear_commerce_agent_stream_cancelled(&request.request_id).await;
    let app_handle = app.clone();
    let request_clone = request.clone();
    tauri::async_runtime::spawn(async move {
        run_commerce_ad_agent_stream_job(app_handle, request_clone).await;
    });

    Ok(CommerceAdAgentStreamResponseDto {
        request_id: request.request_id,
    })
}

#[tauri::command]
pub async fn cancel_commerce_ad_agent_stream(request_id: String) -> Result<(), String> {
    mark_commerce_agent_stream_cancelled(request_id).await;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestConnectionRequest {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub extra_params: Option<HashMap<String, Value>>,
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

    let provider = registry
        .get_provider(&request.provider)
        .ok_or_else(|| format!("Provider '{}' not found", request.provider))?;

    provider
        .set_api_key(request.api_key.clone())
        .await
        .map_err(|e| e.to_string())?;

    let test_req = GenerateRequest {
        prompt: "Hello".to_string(),
        model: request.model.clone(),
        size: "".to_string(),
        aspect_ratio: "".to_string(),
        reference_images: None,
        extra_params: request.extra_params.filter(|params| !params.is_empty()),
    };

    match provider.generate(test_req).await {
        Ok(_) => Ok(TestConnectionResponse {
            success: true,
            message: "\u{8fde}\u{63a5}\u{6210}\u{529f}".to_string(),
        }),
        Err(e) => Ok(TestConnectionResponse {
            success: false,
            message: format!("\u{8fde}\u{63a5}\u{5931}\u{8d25}: {}", e),
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
        assert!(
            provider == "alibaba"
                || provider == "coding"
                || provider == "bltcy"
                || provider == "zhenzhen"
                || provider == "comfly"
                || provider == "oopii"
                || provider == "compatible"
        );
        assert!(status.switch_cost_ms.unwrap_or(0) < 10_000);
    }

    #[test]
    fn parse_openai_chat_sse_delta_reads_content_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(
            parse_openai_chat_sse_delta(line).unwrap(),
            Some("你好".to_string())
        );
    }

    #[test]
    fn parse_openai_chat_sse_delta_ignores_empty_and_done() {
        assert_eq!(parse_openai_chat_sse_delta("data: [DONE]").unwrap(), None);
        assert_eq!(parse_openai_chat_sse_delta("data:").unwrap(), None);
        assert_eq!(parse_openai_chat_sse_delta("event: message").unwrap(), None);
        assert_eq!(parse_openai_chat_sse_delta("id: chatcmpl-123").unwrap(), None);
        assert_eq!(parse_openai_chat_sse_delta("retry: 1000").unwrap(), None);
        assert_eq!(
            parse_openai_chat_sse_delta(r#"data: {"choices":[{"delta":{}}]}"#).unwrap(),
            None
        );
    }

    #[test]
    fn parse_openai_chat_sse_delta_reports_invalid_json() {
        assert!(parse_openai_chat_sse_delta("data: {not-json").is_err());
    }

    #[test]
    fn commerce_oopii_chat_model_aliases_are_streamable() {
        assert_eq!(normalize_commerce_oopii_chat_model("gpt-5.5"), "all-5.5");
        assert_eq!(
            normalize_commerce_oopii_chat_model("oopii/gpt-5.4"),
            "all-5.4"
        );
        assert!(is_commerce_oopii_chat_model("all-5.4"));
        assert!(is_commerce_oopii_chat_model("all-5.5"));
        assert!(is_commerce_oopii_chat_model("gpt-5.5"));
        assert!(is_commerce_oopii_chat_model("oopii/custom-text-model"));
        assert!(!is_commerce_oopii_chat_model("deepseek-chat"));
    }

    #[test]
    fn commerce_oopii_stream_injects_openai_chat_config_when_missing() {
        let mut extra_params = None;
        ensure_commerce_agent_stream_compatible_config("oopii", "gpt-5.5", &mut extra_params);
        let config = extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .expect("compatible config should be injected");

        assert_eq!(
            config
                .pointer("/api_format")
                .and_then(serde_json::Value::as_str),
            Some("openai-chat")
        );
        assert_eq!(
            config
                .pointer("/endpoint_url")
                .and_then(serde_json::Value::as_str),
            Some("https://www.oopii.cc/")
        );
        assert_eq!(
            config
                .pointer("/request_model")
                .and_then(serde_json::Value::as_str),
            Some("all-5.5")
        );
    }

    #[test]
    fn commerce_oopii_stream_preserves_existing_compatible_config() {
        let mut extra_params = Some(HashMap::from([(
            "compatible_config".to_string(),
            json!({
                "api_format": "openai-chat",
                "endpoint_url": "https://example.test/v1",
                "request_model": "custom",
            }),
        )]));

        ensure_commerce_agent_stream_compatible_config("oopii", "all-5.5", &mut extra_params);
        let config = extra_params
            .as_ref()
            .and_then(|params| params.get("compatible_config"))
            .expect("compatible config should still exist");
        assert_eq!(
            config
                .pointer("/endpoint_url")
                .and_then(serde_json::Value::as_str),
            Some("https://example.test/v1")
        );
        assert_eq!(
            config
                .pointer("/request_model")
                .and_then(serde_json::Value::as_str),
            Some("custom")
        );
    }

    #[tokio::test]
    #[ignore]
    async fn commerce_oopii_live_sse_receives_delta() {
        let api_key = std::env::var("OOPII_LIVE_TEST_KEY")
            .expect("set OOPII_LIVE_TEST_KEY to run this live test");
        let request = CommerceAdAgentStreamRequestDto {
            prompt: "请只回复 OK 两个字母。".to_string(),
            request_id: "commerce-oopii-live-test".to_string(),
            model: "all-5.5".to_string(),
            provider: "oopii".to_string(),
            api_key,
            temperature: Some(0.0),
            max_tokens: Some(32),
            reference_images: None,
            extra_params: Some(HashMap::from([(
                "compatible_config".to_string(),
                json!({
                    "api_format": "openai-chat",
                    "endpoint_url": "https://www.oopii.cc/",
                    "request_model": "all-5.5",
                    "display_name": "all-5.5",
                }),
            )])),
        };
        let req = GenerateRequest {
            prompt: request.prompt.clone(),
            model: request.model.clone(),
            size: String::new(),
            aspect_ratio: String::new(),
            reference_images: None,
            extra_params: request.extra_params.clone(),
        };
        let config = CompatibleProvider::extract_config(&req).unwrap();
        let endpoint = CompatibleProvider::resolve_openai_endpoint(
            &config.endpoint_url,
            CompatibleApiFormat::OpenAiChat,
        );
        let body = json!({
            "model": CompatibleProvider::sanitize_model(&config.request_model),
            "messages": [{
                "role": "user",
                "content": request.prompt
            }],
            "temperature": request.temperature.unwrap_or(0.35),
            "max_tokens": request.max_tokens.unwrap_or(1200),
            "stream": true,
        });
        let response = reqwest::Client::new()
            .post(endpoint)
            .version(reqwest::Version::HTTP_11)
            .bearer_auth(request.api_key.trim())
            .header("X-API-Key", request.api_key.trim())
            .header("Accept", "text/event-stream")
            .header("Content-Type", "application/json")
            .header(
                "User-Agent",
                "Storyboard-Copilot/commerce-agent-stream-test",
            )
            .json(&body)
            .send()
            .await
            .unwrap();
        assert!(
            response.status().is_success(),
            "status={} body={}",
            response.status(),
            response.text().await.unwrap_or_default()
        );
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;
        while let Some(item) = stream.next().await {
            let bytes = item.unwrap();
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            while let Some(newline_index) = buffer.find('\n') {
                let line = buffer[..newline_index].to_string();
                buffer = buffer[newline_index + 1..].to_string();
                if let Some(delta) = parse_openai_chat_sse_delta(&line).unwrap() {
                    if !delta.trim().is_empty() {
                        return;
                    }
                }
            }
        }
        panic!("live SSE completed without a text delta");
    }
}
