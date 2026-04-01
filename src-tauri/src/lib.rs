pub mod ai;
pub mod commands;

use std::path::PathBuf;
use std::time::Duration;

use commands::ai as ai_commands;
use commands::asset_state;
use commands::dreamina_cli;
use commands::image;
use commands::project_state;
use commands::ps_server;
use commands::system;
use commands::text_gen;
use commands::update;
use tauri::Manager;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const MAIN_WINDOW_LABEL: &str = "main";
const FRONTEND_READY_TIMEOUT_MS: u64 = 3_500;

fn resolve_log_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join("Library/Logs/storyboard-copilot"));
    }

    candidates.push(std::env::temp_dir().join("storyboard-copilot/logs"));

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("logs"));
    }

    for directory in candidates {
        if std::fs::create_dir_all(&directory).is_ok() {
            return Some(directory);
        }
    }

    None
}

fn setup_logging() {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,storyboard_copilot=debug".into());

    if let Some(log_dir) = resolve_log_dir() {
        let file_appender = tracing_appender::rolling::daily(log_dir, "storyboard.log");
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
        std::mem::forget(_guard);

        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
            .init();
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    info!("Storyboard Copilot starting...");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Err(err) = main_window.show() {
            warn!("failed to show main window: {err}");
        }
        if let Err(err) = main_window.set_focus() {
            warn!("failed to focus main window: {err}");
        }
    } else {
        warn!("main window not found while trying to reveal UI");
    }
}

#[tauri::command]
fn frontend_ready(app: tauri::AppHandle) {
    info!("frontend_ready received, revealing main window");
    show_main_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_logging();

    tauri::Builder::default()
        .on_page_load(|window, _payload| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            info!("main page loaded, revealing main window");
            show_main_window(&window.app_handle());
        })
        .setup(|app| {
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == MAIN_WINDOW_LABEL)
                .cloned()
                .ok_or_else(|| "missing main window config".to_string())?;

            let main_window =
                tauri::WebviewWindowBuilder::from_config(app, &window_config)?.build()?;

            if let Err(err) = main_window.hide() {
                warn!("failed to hide main window on startup: {err}");
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(FRONTEND_READY_TIMEOUT_MS)).await;

                let is_main_visible = app_handle
                    .get_webview_window(MAIN_WINDOW_LABEL)
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(false);

                if !is_main_visible {
                    warn!(
                        "frontend_ready timeout after {}ms, forcing main window reveal",
                        FRONTEND_READY_TIMEOUT_MS
                    );
                    show_main_window(&app_handle);
                }
            });

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            dreamina_cli::check_dreamina_cli_status,
            dreamina_cli::generate_jimeng_dreamina_images,
            dreamina_cli::generate_jimeng_dreamina_videos,
            dreamina_cli::submit_jimeng_dreamina_images,
            dreamina_cli::submit_jimeng_dreamina_videos,
            dreamina_cli::query_jimeng_dreamina_image_results,
            dreamina_cli::query_jimeng_dreamina_video_result,
            image::split_image,
            image::split_image_source,
            image::prepare_node_image_source,
            image::prepare_node_image_binary,
            image::crop_image_source,
            image::merge_storyboard_images,
            image::read_storyboard_image_metadata,
            image::embed_storyboard_image_metadata,
            image::load_image,
            image::persist_image_source,
            image::persist_image_binary,
            image::save_image_source_to_downloads,
            image::save_image_source_to_path,
            image::save_image_source_to_directory,
            image::save_image_source_to_app_debug_dir,
            image::copy_image_source_to_clipboard,
            ai_commands::set_api_key,
            ai_commands::submit_generate_image_job,
            ai_commands::get_generate_image_job,
            ai_commands::generate_image,
            ai_commands::list_models,
            asset_state::list_asset_libraries,
            asset_state::create_asset_library,
            asset_state::update_asset_library,
            asset_state::delete_asset_library,
            asset_state::create_asset_subcategory,
            asset_state::update_asset_subcategory,
            asset_state::delete_asset_subcategory,
            asset_state::create_asset_item,
            asset_state::update_asset_item,
            asset_state::delete_asset_item,
            project_state::list_project_summaries,
            project_state::get_project_record,
            project_state::upsert_project_record,
            project_state::update_project_viewport_record,
            project_state::rename_project_record,
            project_state::delete_project_record,
            system::get_runtime_system_info,
            text_gen::generate_text,
            text_gen::test_provider_connection,
            text_gen::get_active_text_model_status,
            update::check_latest_release_tag,
            commands::export::save_text_file,
            commands::export::save_binary_file,
            commands::storage::get_storage_info,
            commands::storage::list_database_backups,
            commands::storage::create_database_backup,
            commands::storage::ensure_daily_database_backup,
            commands::storage::restore_database_backup,
            commands::storage::migrate_storage,
            commands::storage::reset_storage_to_default,
            commands::storage::open_storage_folder,
            ps_server::start_ps_server,
            ps_server::stop_ps_server,
            ps_server::get_ps_server_status,
            ps_server::send_image_to_photoshop,
            ps_server::get_ps_selection,
            ps_server::get_ps_selection_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
