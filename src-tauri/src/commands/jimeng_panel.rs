use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, WebviewUrl};
use tracing::{info, warn};
use uuid::Uuid;

#[cfg(windows)]
use webview2_com::ExecuteScriptCompletedHandler;
#[cfg(windows)]
use windows::core::HSTRING;

const JIMENG_PANEL_LABEL: &str = "jimeng-panel";
const JIMENG_PANEL_URL: &str = "https://jimeng.jianying.com/";
const JIMENG_PANEL_EDITOR_URL: &str = "https://jimeng.jianying.com/ai-tool/generate";
const MAIN_WINDOW_LABEL: &str = "main";
const JIMENG_PANEL_BRIDGE_SCRIPT: &str = include_str!("jimeng_panel_bridge.js");
const JIMENG_PANEL_TITLE: &str = "Jimeng";
const JIMENG_PANEL_INSPECTION_PREFIX: &str = "__STORYBOARD_JIMENG_INSPECT__:";
const JIMENG_PANEL_INSPECTION_FILE_NAME: &str = "jimeng-panel-inspection.json";
const JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS: u64 = 350;
const JIMENG_PANEL_INSPECTION_TIMEOUT_MS: u64 = 25_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureJimengPanelWindowPayload {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub decorations: bool,
    pub resizable: bool,
    pub skip_taskbar: bool,
    pub focus: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitJimengPanelExtraControlPayload {
    pub control_index: usize,
    pub trigger_text: String,
    pub option_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitJimengPanelReferenceImagePayload {
    pub file_name: String,
    pub data_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitJimengPanelPayload {
    pub prompt: String,
    pub creation_type: Option<String>,
    pub model: Option<String>,
    pub reference_mode: Option<String>,
    pub aspect_ratio: Option<String>,
    pub duration_seconds: Option<u32>,
    pub reference_images: Option<Vec<SubmitJimengPanelReferenceImagePayload>>,
    pub extra_controls: Option<Vec<SubmitJimengPanelExtraControlPayload>>,
    pub auto_submit: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JimengPanelInspectionState {
    status: Option<String>,
    report: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JimengPanelSubmissionState {
    status: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JimengPanelPageContext {
    location_href: Option<String>,
    ready_state: Option<String>,
    document_title: Option<String>,
    has_bridge: Option<bool>,
}

fn jimeng_panel_inspection_snapshot_path() -> PathBuf {
    std::env::temp_dir()
        .join("storyboard-copilot")
        .join(JIMENG_PANEL_INSPECTION_FILE_NAME)
}

fn persist_jimeng_panel_inspection_value(json_value: &serde_json::Value) -> Result<PathBuf, String> {
    let pretty_json = serde_json::to_vec_pretty(&json_value)
        .map_err(|error| format!("failed to serialize Jimeng inspection snapshot: {error}"))?;

    let snapshot_path = jimeng_panel_inspection_snapshot_path();
    if let Some(parent) = snapshot_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create Jimeng inspection snapshot directory {}: {error}",
                parent.display()
            )
        })?;
    }

    fs::write(&snapshot_path, pretty_json).map_err(|error| {
        format!(
            "failed to write Jimeng inspection snapshot to {}: {error}",
            snapshot_path.display()
        )
    })?;

    Ok(snapshot_path)
}

fn persist_jimeng_panel_inspection_snapshot(encoded_payload: &str) -> Result<PathBuf, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_payload)
        .map_err(|error| format!("failed to decode Jimeng inspection snapshot: {error}"))?;

    let json_value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse Jimeng inspection snapshot: {error}"))?;

    persist_jimeng_panel_inspection_value(&json_value)
}

fn handle_jimeng_panel_title_change(window: &tauri::WebviewWindow, title: &str) {
    if let Some(encoded_payload) = title.strip_prefix(JIMENG_PANEL_INSPECTION_PREFIX) {
        match persist_jimeng_panel_inspection_snapshot(encoded_payload) {
            Ok(snapshot_path) => {
                info!(
                    "captured Jimeng inspection snapshot at {}",
                    snapshot_path.display()
                );
            }
            Err(error) => {
                warn!("{error}");
            }
        }

        let _ = window.set_title(JIMENG_PANEL_TITLE);
        return;
    }

    let _ = window.set_title(title);
}

#[cfg(windows)]
async fn evaluate_jimeng_panel_script_json(
    panel_window: &tauri::WebviewWindow,
    script: impl Into<String>,
) -> Result<serde_json::Value, String> {
    let script = script.into();
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));

    panel_window
        .with_webview({
            let sender = Arc::clone(&sender);
            move |webview| {
                let webview2 = match unsafe { webview.controller().CoreWebView2() } {
                    Ok(webview2) => webview2,
                    Err(error) => {
                        if let Some(sender) = sender.lock().ok().and_then(|mut guard| guard.take()) {
                            let _ = sender.send(Err(format!(
                                "failed to access Jimeng WebView2 instance: {error}"
                            )));
                        }
                        return;
                    }
                };

                let script = HSTRING::from(script);
                let callback_sender = Arc::clone(&sender);

                if let Err(error) = unsafe {
                    webview2.ExecuteScript(
                        &script,
                        &ExecuteScriptCompletedHandler::create(Box::new(
                            move |error_code, result_json| {
                                let outcome = match error_code {
                                    Ok(()) => Ok(result_json),
                                    Err(error) => {
                                        Err(format!("failed to evaluate Jimeng inspection script: {error}"))
                                    }
                                };

                                if let Some(sender) =
                                    callback_sender.lock().ok().and_then(|mut guard| guard.take())
                                {
                                    let _ = sender.send(outcome);
                                }

                                Ok(())
                            },
                        )),
                    )
                } {
                    if let Some(sender) = sender.lock().ok().and_then(|mut guard| guard.take()) {
                        let _ = sender.send(Err(format!(
                            "failed to dispatch Jimeng inspection script: {error}"
                        )));
                    }
                }
            }
        })
        .map_err(|error| format!("failed to access Jimeng native webview handle: {error}"))?;

    let result_json = tokio::time::timeout(Duration::from_millis(5_000), receiver)
        .await
        .map_err(|_| "timed out waiting for Jimeng inspection script result".to_string())?
        .map_err(|_| "Jimeng inspection script channel closed unexpectedly".to_string())??;

    let trimmed = result_json.trim();
    if trimmed.is_empty() || trimmed == "undefined" {
        return Ok(serde_json::Value::Null);
    }

    serde_json::from_str(trimmed)
        .map_err(|error| format!("failed to parse Jimeng inspection script result: {error}"))
}

#[cfg(not(windows))]
async fn evaluate_jimeng_panel_script_json(
    _panel_window: &tauri::WebviewWindow,
    _script: impl Into<String>,
) -> Result<serde_json::Value, String> {
    Err("Jimeng inspection is currently supported only on Windows".to_string())
}

async fn poll_jimeng_panel_inspection_state(
    panel_window: &tauri::WebviewWindow,
) -> Result<JimengPanelInspectionState, String> {
    let script = r#"
(() => {
  try {
    return window.__STORYBOARD_JIMENG__?.getInspectionState?.() ?? null;
  } catch (error) {
    return {
      status: "error",
      error: String(error && error.message ? error.message : error),
    };
  }
})()
"#;

    let state_value = evaluate_jimeng_panel_script_json(panel_window, script).await?;
    if state_value.is_null() {
        return Ok(JimengPanelInspectionState::default());
    }

    serde_json::from_value(state_value)
        .map_err(|error| format!("failed to decode Jimeng inspection state: {error}"))
}

async fn poll_jimeng_panel_submission_state(
    panel_window: &tauri::WebviewWindow,
) -> Result<JimengPanelSubmissionState, String> {
    let script = r#"
(() => {
  try {
    return window.__STORYBOARD_JIMENG__?.getSubmissionState?.() ?? null;
  } catch (error) {
    return {
      status: "error",
      error: String(error && error.message ? error.message : error),
    };
  }
})()
"#;

    let state_value = evaluate_jimeng_panel_script_json(panel_window, script).await?;
    if state_value.is_null() {
        return Ok(JimengPanelSubmissionState::default());
    }

    serde_json::from_value(state_value)
        .map_err(|error| format!("failed to decode Jimeng submission state: {error}"))
}

async fn read_jimeng_panel_page_context(
    panel_window: &tauri::WebviewWindow,
) -> Result<JimengPanelPageContext, String> {
    let script = r#"
(() => {
  try {
    return {
      locationHref: window.location.href,
      readyState: document.readyState,
      documentTitle: document.title,
      hasBridge: Boolean(window.__STORYBOARD_JIMENG__),
    };
  } catch (error) {
    return {
      locationHref: null,
      readyState: null,
      documentTitle: null,
      hasBridge: false,
    };
  }
})()
"#;

    let context_value = evaluate_jimeng_panel_script_json(panel_window, script).await?;
    if context_value.is_null() {
        return Ok(JimengPanelPageContext::default());
    }

    serde_json::from_value(context_value)
        .map_err(|error| format!("failed to decode Jimeng panel page context: {error}"))
}

fn is_jimeng_editor_location(location_href: Option<&str>) -> bool {
    location_href
        .map(|href| {
            href.starts_with("https://jimeng.jianying.com/ai-tool/")
                || href.starts_with("http://jimeng.jianying.com/ai-tool/")
        })
        .unwrap_or(false)
}

fn format_jimeng_page_context(context: &JimengPanelPageContext) -> String {
    let location = context.location_href.as_deref().unwrap_or("<unknown>");
    let ready_state = context.ready_state.as_deref().unwrap_or("<unknown>");
    let title = context.document_title.as_deref().unwrap_or("<unknown>");

    format!("{location} (readyState={ready_state}, title={title})")
}

fn redirect_jimeng_panel_to_editor(panel_window: &tauri::WebviewWindow) -> Result<(), String> {
    let navigation_script = format!(
        "window.location.replace({});",
        serde_json::to_string(JIMENG_PANEL_EDITOR_URL)
            .map_err(|error| format!("failed to serialize Jimeng editor URL: {error}"))?
    );

    panel_window
        .eval(&navigation_script)
        .map_err(|error| format!("failed to navigate Jimeng panel to editor page: {error}"))
}

async fn wait_for_jimeng_panel_ready(
    panel_window: &tauri::WebviewWindow,
    deadline: Instant,
) -> Result<(), String> {
    let mut redirected_to_editor = false;

    loop {
        let page_context = read_jimeng_panel_page_context(panel_window).await?;

        if !is_jimeng_editor_location(page_context.location_href.as_deref()) {
            if !redirected_to_editor {
                redirect_jimeng_panel_to_editor(panel_window)?;
                redirected_to_editor = true;
            }

            if Instant::now() >= deadline {
                return Err(format!(
                    "Jimeng panel is not on the editor page yet: {}",
                    format_jimeng_page_context(&page_context)
                ));
            }

            tokio::time::sleep(Duration::from_millis(
                JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS,
            ))
            .await;
            continue;
        }

        if !page_context.has_bridge.unwrap_or(false) {
            if Instant::now() >= deadline {
                return Err(format!(
                    "Jimeng panel bridge is not ready yet: {}",
                    format_jimeng_page_context(&page_context)
                ));
            }

            tokio::time::sleep(Duration::from_millis(
                JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS,
            ))
            .await;
            continue;
        }

        return Ok(());
    }
}

fn build_jimeng_popup_window(
    app: &AppHandle,
    url: tauri::Url,
    features: tauri::webview::NewWindowFeatures,
) -> Result<tauri::WebviewWindow, tauri::Error> {
    let popup_label = format!("jimeng-popup-{}", Uuid::new_v4().simple());
    let about_blank = "about:blank"
        .parse::<tauri::Url>()
        .expect("about:blank must be a valid URL");

    tauri::WebviewWindowBuilder::new(app, popup_label, WebviewUrl::External(about_blank))
        .window_features(features)
        .title(url.as_str())
        .visible(true)
        .focused(true)
        .resizable(true)
        .decorations(true)
        .skip_taskbar(false)
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build()
}

#[tauri::command]
pub async fn ensure_jimeng_panel_window(
    app: AppHandle,
    payload: EnsureJimengPanelWindowPayload,
) -> Result<(), String> {
    if app.get_webview_window(JIMENG_PANEL_LABEL).is_some() {
        return Ok(());
    }

    let main_window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    let jimeng_url = JIMENG_PANEL_URL
        .parse::<tauri::Url>()
        .map_err(|error| format!("invalid Jimeng URL: {error}"))?;
    let app_handle = app.clone();

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        JIMENG_PANEL_LABEL,
        WebviewUrl::External(jimeng_url),
    )
    .initialization_script(JIMENG_PANEL_BRIDGE_SCRIPT)
    .title(JIMENG_PANEL_TITLE)
    .position(payload.x, payload.y)
    .inner_size(payload.width, payload.height)
    .min_inner_size(payload.min_width, payload.min_height)
    .visible(true)
    .focused(payload.focus)
    .resizable(payload.resizable)
    .maximizable(false)
    .minimizable(false)
    .closable(true)
    .decorations(payload.decorations)
    .shadow(true)
    .skip_taskbar(payload.skip_taskbar)
    .prevent_overflow()
    .on_document_title_changed(|window, title| {
        handle_jimeng_panel_title_change(&window, &title);
    })
    .on_page_load(|window, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }

        if payload.url().host_str() != Some("jimeng.jianying.com") {
            return;
        }

        if let Err(error) = window.eval("window.__STORYBOARD_JIMENG__?.scheduleInspection?.();") {
            warn!("failed to schedule Jimeng inspection after page load: {error}");
        }
    })
    .on_new_window(move |url, features| {
        info!("jimeng popup requested: {}", url);

        match build_jimeng_popup_window(&app_handle, url, features) {
            Ok(window) => NewWindowResponse::Create { window },
            Err(error) => {
                warn!("failed to create Jimeng popup window: {error}");
                NewWindowResponse::Deny
            }
        }
    });

    let builder = builder
        .parent(&main_window)
        .map_err(|error| format!("failed to attach Jimeng panel to main window: {error}"))?;

    builder
        .build()
        .map(|_| ())
        .map_err(|error| format!("failed to create Jimeng panel window: {error}"))
}

#[tauri::command]
pub async fn submit_jimeng_panel_task(
    app: AppHandle,
    payload: SubmitJimengPanelPayload,
) -> Result<(), String> {
    let panel_window = app
        .get_webview_window(JIMENG_PANEL_LABEL)
        .ok_or_else(|| "jimeng panel window not found".to_string())?;

    panel_window
        .show()
        .map_err(|error| format!("failed to show Jimeng panel window: {error}"))?;
    panel_window
        .set_focus()
        .map_err(|error| format!("failed to focus Jimeng panel window: {error}"))?;

    let payload_json = serde_json::to_string(&payload)
        .map_err(|error| format!("failed to serialize Jimeng submission payload: {error}"))?;

    panel_window
        .eval(format!(
            "window.__STORYBOARD_JIMENG__?.submit?.({payload_json});"
        ))
        .map_err(|error| format!("failed to dispatch Jimeng submission: {error}"))
}

#[tauri::command]
pub async fn inspect_jimeng_panel_options(app: AppHandle) -> Result<serde_json::Value, String> {
    let panel_window = app
        .get_webview_window(JIMENG_PANEL_LABEL)
        .ok_or_else(|| "jimeng panel window not found".to_string())?;

    panel_window
        .show()
        .map_err(|error| format!("failed to show Jimeng panel window: {error}"))?;

    let deadline = Instant::now() + Duration::from_millis(JIMENG_PANEL_INSPECTION_TIMEOUT_MS);
    wait_for_jimeng_panel_ready(&panel_window, deadline).await?;

    panel_window
        .eval("window.__STORYBOARD_JIMENG__?.requestInspection?.(true);")
        .map_err(|error| format!("failed to trigger Jimeng inspection: {error}"))?;

    loop {
        let inspection_state = poll_jimeng_panel_inspection_state(&panel_window).await?;

        match inspection_state.status.as_deref() {
            Some("ready") => {
                let report = inspection_state
                    .report
                    .ok_or_else(|| "Jimeng inspection finished without a report".to_string())?;

                match persist_jimeng_panel_inspection_value(&report) {
                    Ok(snapshot_path) => {
                        info!(
                            "captured Jimeng inspection snapshot at {}",
                            snapshot_path.display()
                        );
                    }
                    Err(error) => {
                        warn!("{error}");
                    }
                }

                return Ok(report);
            }
            Some("error") => {
                return Err(
                    inspection_state
                        .error
                        .unwrap_or_else(|| "Jimeng inspection failed".to_string()),
                );
            }
            _ => {}
        }

        if Instant::now() >= deadline {
            return Err("timed out waiting for Jimeng inspection report".to_string());
        }

        tokio::time::sleep(Duration::from_millis(
            JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS,
        ))
        .await;
    }
}

#[tauri::command]
pub async fn sync_jimeng_panel_draft_options(
    app: AppHandle,
    payload: SubmitJimengPanelPayload,
) -> Result<serde_json::Value, String> {
    let panel_window = app
        .get_webview_window(JIMENG_PANEL_LABEL)
        .ok_or_else(|| "jimeng panel window not found".to_string())?;

    panel_window
        .show()
        .map_err(|error| format!("failed to show Jimeng panel window: {error}"))?;

    let deadline = Instant::now() + Duration::from_millis(JIMENG_PANEL_INSPECTION_TIMEOUT_MS);
    wait_for_jimeng_panel_ready(&panel_window, deadline).await?;

    let mut sync_payload = payload;
    sync_payload.auto_submit = Some(false);

    let payload_json = serde_json::to_string(&sync_payload)
        .map_err(|error| format!("failed to serialize Jimeng draft sync payload: {error}"))?;

    let dispatch_script = format!(
        "(() => Boolean(window.__STORYBOARD_JIMENG__?.syncDraft?.({payload_json})))()"
    );
    let dispatch_result = evaluate_jimeng_panel_script_json(&panel_window, dispatch_script).await?;

    if !dispatch_result.as_bool().unwrap_or(false) {
        return Err("failed to dispatch Jimeng draft sync".to_string());
    }

    loop {
        let submission_state = poll_jimeng_panel_submission_state(&panel_window).await?;

        match submission_state.status.as_deref() {
            Some("ready") => break,
            Some("error") => {
                return Err(
                    submission_state
                        .error
                        .unwrap_or_else(|| "Jimeng draft sync failed".to_string()),
                );
            }
            _ => {}
        }

        if Instant::now() >= deadline {
            return Err("timed out waiting for Jimeng draft sync".to_string());
        }

        tokio::time::sleep(Duration::from_millis(
            JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS,
        ))
        .await;
    }

    panel_window
        .eval("window.__STORYBOARD_JIMENG__?.requestInspection?.(true);")
        .map_err(|error| format!("failed to trigger Jimeng inspection after draft sync: {error}"))?;

    loop {
        let inspection_state = poll_jimeng_panel_inspection_state(&panel_window).await?;

        match inspection_state.status.as_deref() {
            Some("ready") => {
                let report = inspection_state
                    .report
                    .ok_or_else(|| "Jimeng inspection finished without a report".to_string())?;

                match persist_jimeng_panel_inspection_value(&report) {
                    Ok(snapshot_path) => {
                        info!(
                            "captured Jimeng inspection snapshot at {}",
                            snapshot_path.display()
                        );
                    }
                    Err(error) => {
                        warn!("{error}");
                    }
                }

                return Ok(report);
            }
            Some("error") => {
                return Err(
                    inspection_state
                        .error
                        .unwrap_or_else(|| "Jimeng inspection failed".to_string()),
                );
            }
            _ => {}
        }

        if Instant::now() >= deadline {
            return Err("timed out waiting for Jimeng inspection report".to_string());
        }

        tokio::time::sleep(Duration::from_millis(
            JIMENG_PANEL_INSPECTION_POLL_INTERVAL_MS,
        ))
        .await;
    }
}
