use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

const APP_DATA_DIR: &str = r"C:\Users\Administrator\AppData\Roaming\com.storyboard.copilot";
const IMAGE_REF_PREFIX: &str = "__img_ref__:";

#[derive(Debug, Default)]
struct RecoveryTarget {
    candidates: HashSet<String>,
    contexts: HashSet<String>,
}

fn normalize_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/").trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }

    if cfg!(target_os = "windows") {
        return Some(normalized.to_ascii_lowercase());
    }

    Some(normalized)
}

fn collect_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn project_nodes_array(value: &Value) -> Option<&Vec<Value>> {
    match value {
        Value::Array(nodes) => Some(nodes),
        Value::Object(object) => object.get("nodes").and_then(Value::as_array),
        _ => None,
    }
}

fn extract_image_pool(parsed_nodes: Option<&Value>, parsed_history: Option<&Value>) -> Vec<String> {
    let image_pool = collect_string_array(parsed_nodes.and_then(|value| value.get("imagePool")));
    if !image_pool.is_empty() {
        return image_pool;
    }

    collect_string_array(parsed_history.and_then(|value| value.get("imagePool")))
}

fn resolve_image_ref(value: &str, image_pool: &[String]) -> Option<String> {
    if let Some(index_text) = value.strip_prefix(IMAGE_REF_PREFIX) {
        let index = index_text.parse::<usize>().ok()?;
        return image_pool.get(index).map(|item| item.to_string());
    }

    Some(value.to_string())
}

fn normalize_extension(raw_ext: &str) -> String {
    let ext = raw_ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if ext.is_empty() {
        return "png".to_string();
    }

    if ext == "jpeg" {
        return "jpg".to_string();
    }

    ext
}

fn register_missing_target(
    raw_target: Option<&str>,
    candidate_values: &[Option<&str>],
    image_pool: &[String],
    images_dir: &Path,
    targets: &mut HashMap<String, RecoveryTarget>,
    context: &str,
) {
    let Some(raw_target) = raw_target else {
        return;
    };
    let Some(resolved_target) = resolve_image_ref(raw_target, image_pool) else {
        return;
    };
    let target_path = PathBuf::from(&resolved_target);
    if target_path.exists() {
        return;
    }

    let Some(target_normalized) = normalize_path(&resolved_target) else {
        return;
    };
    let Some(images_dir_normalized) = normalize_path(&images_dir.to_string_lossy()) else {
        return;
    };
    if !target_normalized.starts_with(&images_dir_normalized) {
        return;
    }

    let entry = targets.entry(target_normalized).or_default();
    entry.contexts.insert(context.to_string());

    for candidate in candidate_values {
        let Some(candidate) = candidate else {
            continue;
        };
        let Some(resolved_candidate) = resolve_image_ref(candidate, image_pool) else {
            continue;
        };
        if resolved_candidate.trim().is_empty() || resolved_candidate == resolved_target {
            continue;
        }
        entry.candidates.insert(resolved_candidate);
    }
}

fn inspect_node(
    node: &Value,
    image_pool: &[String],
    images_dir: &Path,
    targets: &mut HashMap<String, RecoveryTarget>,
    context: &str,
) {
    let Some(data) = node.get("data").and_then(Value::as_object) else {
        return;
    };

    let image_url = data.get("imageUrl").and_then(Value::as_str);
    let preview_image_url = data.get("previewImageUrl").and_then(Value::as_str);
    let video_url = data.get("videoUrl").and_then(Value::as_str);
    let audio_url = data.get("audioUrl").and_then(Value::as_str);
    let source_url = data.get("sourceUrl").and_then(Value::as_str);
    let poster_source_url = data.get("posterSourceUrl").and_then(Value::as_str);

    register_missing_target(
        image_url,
        &[source_url, preview_image_url],
        image_pool,
        images_dir,
        targets,
        context,
    );
    register_missing_target(
        preview_image_url,
        &[poster_source_url, source_url, image_url],
        image_pool,
        images_dir,
        targets,
        context,
    );
    register_missing_target(
        video_url,
        &[source_url],
        image_pool,
        images_dir,
        targets,
        context,
    );
    register_missing_target(audio_url, &[], image_pool, images_dir, targets, context);

    if let Some(frames) = data.get("frames").and_then(Value::as_array) {
        for (index, frame) in frames.iter().enumerate() {
            let Some(frame_object) = frame.as_object() else {
                continue;
            };
            let frame_image = frame_object.get("imageUrl").and_then(Value::as_str);
            let frame_preview = frame_object.get("previewImageUrl").and_then(Value::as_str);
            let frame_context = format!("{context} > frame[{index}]");
            register_missing_target(
                frame_image,
                &[frame_preview],
                image_pool,
                images_dir,
                targets,
                &frame_context,
            );
            register_missing_target(
                frame_preview,
                &[frame_image],
                image_pool,
                images_dir,
                targets,
                &frame_context,
            );
        }
    }

    if let Some(result_images) = data.get("resultImages").and_then(Value::as_array) {
        for (index, item) in result_images.iter().enumerate() {
            let Some(item_object) = item.as_object() else {
                continue;
            };
            let item_image = item_object.get("imageUrl").and_then(Value::as_str);
            let item_preview = item_object.get("previewImageUrl").and_then(Value::as_str);
            let item_video = item_object.get("videoUrl").and_then(Value::as_str);
            let item_source = item_object.get("sourceUrl").and_then(Value::as_str);
            let item_poster = item_object.get("posterSourceUrl").and_then(Value::as_str);
            let item_context = format!("{context} > result[{index}]");

            register_missing_target(
                item_image,
                &[item_source, item_preview],
                image_pool,
                images_dir,
                targets,
                &item_context,
            );
            register_missing_target(
                item_preview,
                &[item_poster, item_source, item_image],
                image_pool,
                images_dir,
                targets,
                &item_context,
            );
            register_missing_target(
                item_video,
                &[item_source],
                image_pool,
                images_dir,
                targets,
                &item_context,
            );
        }
    }
}

fn inspect_db(db_path: &Path, images_dir: &Path, targets: &mut HashMap<String, RecoveryTarget>) -> Result<(), String> {
    let conn = Connection::open(db_path)
        .map_err(|error| format!("Failed to open db {}: {}", db_path.display(), error))?;
    let mut stmt = conn
        .prepare("SELECT id, nodes_json, history_json FROM projects")
        .map_err(|error| format!("Failed to prepare project query for {}: {}", db_path.display(), error))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("Failed to query projects for {}: {}", db_path.display(), error))?;

    for row in rows {
        let (project_id, nodes_json, history_json) = row
            .map_err(|error| format!("Failed to read project row for {}: {}", db_path.display(), error))?;
        let parsed_nodes = serde_json::from_str::<Value>(&nodes_json).ok();
        let parsed_history = serde_json::from_str::<Value>(&history_json).ok();
        let image_pool = extract_image_pool(parsed_nodes.as_ref(), parsed_history.as_ref());

        if let Some(nodes) = parsed_nodes.as_ref().and_then(project_nodes_array) {
            for (index, node) in nodes.iter().enumerate() {
                inspect_node(
                    node,
                    &image_pool,
                    images_dir,
                    targets,
                    &format!("project={project_id} current[{index}]"),
                );
            }
        }

        if let Some(history) = parsed_history.as_ref() {
            for timeline_key in ["past", "future"] {
                let Some(timeline) = history.get(timeline_key).and_then(Value::as_array) else {
                    continue;
                };

                for (snapshot_index, snapshot) in timeline.iter().enumerate() {
                    if let Some(nodes) = snapshot.get("nodes").and_then(Value::as_array) {
                        for (index, node) in nodes.iter().enumerate() {
                            inspect_node(
                                node,
                                &image_pool,
                                images_dir,
                                targets,
                                &format!(
                                    "project={project_id} {timeline_key}[{snapshot_index}] current[{index}]"
                                ),
                            );
                        }
                    }

                    if snapshot.get("kind").and_then(Value::as_str) == Some("nodePatch") {
                        if let Some(entries) = snapshot.get("entries").and_then(Value::as_array) {
                            for (entry_index, entry) in entries.iter().enumerate() {
                                let Some(node) = entry.get("node") else {
                                    continue;
                                };
                                if node.is_null() {
                                    continue;
                                }

                                inspect_node(
                                    node,
                                    &image_pool,
                                    images_dir,
                                    targets,
                                    &format!(
                                        "project={project_id} {timeline_key}[{snapshot_index}] patch[{entry_index}]"
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

fn collect_hash_candidates_from_dir(
    directory: &Path,
    images_dir: &Path,
    targets: &mut HashMap<String, RecoveryTarget>,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read directory {}: {}", directory.display(), error))?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to read directory entry under {}: {}",
                directory.display(),
                error
            )
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_hash_candidates_from_dir(&path, images_dir, targets)?;
            continue;
        }

        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let digest = md5::compute(&bytes);
        let candidate_target = images_dir.join(format!(
            "{:x}.{}",
            digest,
            normalize_extension(extension)
        ));
        let Some(candidate_target_key) = normalize_path(&candidate_target.to_string_lossy()) else {
            continue;
        };

        let Some(target) = targets.get_mut(&candidate_target_key) else {
            continue;
        };
        target
            .candidates
            .insert(path.to_string_lossy().to_string());
    }

    Ok(())
}

async fn restore_from_candidate(target_path: &Path, candidate: &str) -> Result<bool, String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create parent directory {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let response = reqwest::get(trimmed)
            .await
            .map_err(|error| format!("Failed to download {trimmed}: {error}"))?;
        if !response.status().is_success() {
            return Ok(false);
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to read response body for {trimmed}: {error}"))?;
        fs::write(target_path, &bytes).map_err(|error| {
            format!(
                "Failed to write restored file {} from {}: {}",
                target_path.display(),
                trimmed,
                error
            )
        })?;
        return Ok(true);
    }

    let candidate_path = PathBuf::from(trimmed);
    if !candidate_path.exists() || !candidate_path.is_file() {
        return Ok(false);
    }

    fs::copy(&candidate_path, target_path).map_err(|error| {
        format!(
            "Failed to copy restored file from {} to {}: {}",
            candidate_path.display(),
            target_path.display(),
            error
        )
    })?;
    Ok(true)
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let app_data_dir = PathBuf::from(APP_DATA_DIR);
    let images_dir = app_data_dir.join("images");
    let current_db = app_data_dir.join("projects.db");
    let backups_dir = app_data_dir.join("backups").join("db");
    let runtime_dir = app_data_dir.join("dreamina-cli-runtime");

    let mut db_paths = vec![current_db];
    if let Ok(entries) = fs::read_dir(&backups_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                db_paths.push(path);
            }
        }
    }

    let mut targets: HashMap<String, RecoveryTarget> = HashMap::new();
    for db_path in &db_paths {
        inspect_db(db_path, &images_dir, &mut targets)?;
    }
    collect_hash_candidates_from_dir(&runtime_dir, &images_dir, &mut targets)?;

    println!("Scanned {} databases.", db_paths.len());
    println!("Found {} unique missing media targets.", targets.len());

    let mut restored = 0usize;
    let mut recoverable = 0usize;
    let mut unrecoverable = Vec::new();

    let mut target_entries: Vec<(String, RecoveryTarget)> = targets.into_iter().collect();
    target_entries.sort_by(|left, right| left.0.cmp(&right.0));

    for (target_normalized, target) in target_entries {
        let target_path = PathBuf::from(&target_normalized);
        if target_path.exists() {
            continue;
        }

        let mut candidate_list: Vec<String> = target.candidates.into_iter().collect();
        candidate_list.sort();

        if !candidate_list.is_empty() {
            recoverable += 1;
        }

        let mut target_restored = false;
        for candidate in &candidate_list {
            match restore_from_candidate(&target_path, candidate).await {
                Ok(true) => {
                    println!(
                        "RESTORED: {} <= {}",
                        target_path.display(),
                        candidate
                    );
                    restored += 1;
                    target_restored = true;
                    break;
                }
                Ok(false) => {}
                Err(error) => {
                    eprintln!("WARN: {}", error);
                }
            }
        }

        if !target_restored {
            unrecoverable.push((
                target_path,
                candidate_list,
                target.contexts.into_iter().collect::<Vec<_>>(),
            ));
        }
    }

    println!("Recoverable targets with at least one candidate: {}", recoverable);
    println!("Successfully restored targets: {}", restored);
    println!("Still missing targets: {}", unrecoverable.len());

    for (target_path, candidate_list, contexts) in unrecoverable.iter().take(40) {
        println!("MISSING: {}", target_path.display());
        if !candidate_list.is_empty() {
            println!("  candidates: {}", candidate_list.join(" | "));
        }
        if !contexts.is_empty() {
            println!("  contexts: {}", contexts.join(" | "));
        }
    }

    Ok(())
}
