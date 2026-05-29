use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEditSession {
    pub project_id: String,
    pub window_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimProjectEditSessionResult {
    pub claimed: bool,
    #[serde(default)]
    pub owner_window_label: Option<String>,
}

static PROJECT_EDIT_SESSIONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static PROJECT_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn edit_sessions() -> &'static Mutex<HashMap<String, String>> {
    PROJECT_EDIT_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn project_windows() -> &'static Mutex<HashSet<String>> {
    PROJECT_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn cleanup_dead_windows(app: &AppHandle) -> Result<(), String> {
    let live_labels: HashSet<String> = app.webview_windows().keys().cloned().collect();

    {
        let mut windows = project_windows()
            .lock()
            .map_err(|_| "Failed to lock project windows".to_string())?;
        windows.retain(|label| live_labels.contains(label));
    }

    let registered_windows = project_windows()
        .lock()
        .map_err(|_| "Failed to lock project windows".to_string())?
        .clone();
    let mut sessions = edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?;
    sessions.retain(|_, label| live_labels.contains(label) && registered_windows.contains(label));
    Ok(())
}

#[tauri::command]
pub fn register_project_window(app: AppHandle, window_label: String) -> Result<(), String> {
    cleanup_dead_windows(&app)?;
    let label = window_label.trim();
    if label.is_empty() {
        return Err("Window label is required".to_string());
    }
    if app.get_webview_window(label).is_none() {
        return Err(format!("Window {label} was not found"));
    }

    project_windows()
        .lock()
        .map_err(|_| "Failed to lock project windows".to_string())?
        .insert(label.to_string());
    Ok(())
}

#[tauri::command]
pub fn unregister_project_window(app: AppHandle, window_label: String) -> Result<(), String> {
    cleanup_dead_windows(&app)?;
    let label = window_label.trim();
    project_windows()
        .lock()
        .map_err(|_| "Failed to lock project windows".to_string())?
        .remove(label);
    edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?
        .retain(|_, owner_label| owner_label != label);
    Ok(())
}

#[tauri::command]
pub fn claim_project_edit_session(
    app: AppHandle,
    project_id: String,
    window_label: String,
) -> Result<ClaimProjectEditSessionResult, String> {
    cleanup_dead_windows(&app)?;
    let project_id = project_id.trim();
    let window_label = window_label.trim();
    if project_id.is_empty() {
        return Err("Project id is required".to_string());
    }
    if window_label.is_empty() {
        return Err("Window label is required".to_string());
    }
    if app.get_webview_window(window_label).is_none() {
        return Err(format!("Window {window_label} was not found"));
    }

    project_windows()
        .lock()
        .map_err(|_| "Failed to lock project windows".to_string())?
        .insert(window_label.to_string());

    let mut sessions = edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?;
    if let Some(owner_label) = sessions.get(project_id) {
        if owner_label == window_label {
            return Ok(ClaimProjectEditSessionResult {
                claimed: true,
                owner_window_label: Some(owner_label.clone()),
            });
        }
        return Ok(ClaimProjectEditSessionResult {
            claimed: false,
            owner_window_label: Some(owner_label.clone()),
        });
    }

    sessions.insert(project_id.to_string(), window_label.to_string());
    Ok(ClaimProjectEditSessionResult {
        claimed: true,
        owner_window_label: Some(window_label.to_string()),
    })
}

#[tauri::command]
pub fn release_project_edit_session(
    app: AppHandle,
    project_id: String,
    window_label: String,
) -> Result<(), String> {
    cleanup_dead_windows(&app)?;
    let project_id = project_id.trim();
    let window_label = window_label.trim();
    let mut sessions = edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?;
    if sessions
        .get(project_id)
        .is_some_and(|label| label == window_label)
    {
        sessions.remove(project_id);
    }
    Ok(())
}

#[tauri::command]
pub fn list_project_edit_sessions(app: AppHandle) -> Result<Vec<ProjectEditSession>, String> {
    cleanup_dead_windows(&app)?;
    let mut sessions: Vec<ProjectEditSession> = edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?
        .iter()
        .map(|(project_id, window_label)| ProjectEditSession {
            project_id: project_id.clone(),
            window_label: window_label.clone(),
        })
        .collect();
    sessions.sort_by(|left, right| left.project_id.cmp(&right.project_id));
    Ok(sessions)
}

#[tauri::command]
pub fn focus_project_window(app: AppHandle, window_label: String) -> Result<(), String> {
    cleanup_dead_windows(&app)?;
    let label = window_label.trim();
    let Some(window) = app.get_webview_window(label) else {
        return Err(format!("Window {label} was not found"));
    };
    window
        .show()
        .map_err(|err| format!("Failed to show window {label}: {err}"))?;
    window
        .set_focus()
        .map_err(|err| format!("Failed to focus window {label}: {err}"))?;
    Ok(())
}

pub(crate) fn ensure_project_write_allowed(
    app: &AppHandle,
    project_id: &str,
    window_label: Option<&str>,
) -> Result<(), String> {
    cleanup_dead_windows(app)?;
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("Project id is required".to_string());
    }
    let sessions = edit_sessions()
        .lock()
        .map_err(|_| "Failed to lock project edit sessions".to_string())?;
    let Some(owner_label) = sessions.get(project_id) else {
        return Ok(());
    };
    let Some(window_label) = window_label
        .map(str::trim)
        .filter(|label| !label.is_empty())
    else {
        return Err(format!(
            "Project {project_id} is open in another window. Writes require the owning window."
        ));
    };
    if owner_label == window_label {
        return Ok(());
    }
    Err(format!(
        "Project {project_id} is already open in window {owner_label}."
    ))
}
