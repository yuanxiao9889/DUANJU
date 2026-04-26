pub mod ai;
pub mod commands;

use std::path::PathBuf;
use std::time::Duration;

use commands::ad_skill_package;
use commands::ai as ai_commands;
use commands::asset_state;
use commands::clip_library;
use commands::dreamina_cli;
use commands::extensions;
use commands::image;
use commands::jimeng_video_queue;
use commands::midjourney;
use commands::project_state;
use commands::ps_server;
use commands::script_project_package;
use commands::seedance;
use commands::style_preset_package;
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

    info!("OOpii Infinite Canvas starting...");
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

    let builder = tauri::Builder::default()
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
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "windows")]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            ad_skill_package::export_ad_director_skill_package,
            ad_skill_package::import_ad_director_skill_package,
            extensions::read_extension_package,
            extensions::list_local_extension_packages,
            extensions::start_extension_runtime,
            extensions::stop_extension_runtime,
            extensions::get_extension_runtime_status,
            extensions::run_extension_command,
            dreamina_cli::check_dreamina_cli_status,
            dreamina_cli::check_dreamina_cli_update,
            dreamina_cli::install_dreamina_cli,
            dreamina_cli::update_dreamina_cli,
            dreamina_cli::open_dreamina_login_terminal,
            dreamina_cli::logout_dreamina_cli,
            dreamina_cli::run_dreamina_guided_setup,
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
            jimeng_video_queue::list_jimeng_video_queue_jobs,
            jimeng_video_queue::upsert_jimeng_video_queue_job,
            jimeng_video_queue::delete_jimeng_video_queue_job,
            midjourney::submit_midjourney_imagine,
            midjourney::submit_midjourney_action,
            midjourney::submit_midjourney_modal,
            midjourney::query_midjourney_tasks,
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
            clip_library::list_clip_libraries,
            clip_library::get_clip_library_snapshot,
            clip_library::create_clip_library,
            clip_library::open_clip_library_root,
            clip_library::update_clip_library,
            clip_library::delete_clip_library,
            clip_library::create_clip_library_chapter,
            clip_library::update_clip_library_chapter,
            clip_library::move_clip_library_chapter,
            clip_library::delete_clip_library_chapter,
            clip_library::create_clip_folder,
            clip_library::move_clip_folder,
            clip_library::rename_clip_folder,
            clip_library::delete_clip_folder,
            clip_library::add_node_media_to_clip_library,
            clip_library::update_clip_item_description,
            clip_library::rename_clip_item,
            clip_library::move_clip_item,
            clip_library::delete_clip_item,
            clip_library::save_clip_library_ui_state,
            clip_library::get_clip_delete_impact,
            project_state::list_project_summaries,
            project_state::get_project_record,
            project_state::upsert_project_record,
            project_state::update_project_viewport_record,
            project_state::rename_project_record,
            project_state::delete_project_record,
            project_state::sync_style_template_image_refs,
            system::get_runtime_system_info,
            system::read_system_clipboard_file_paths,
            system::request_app_exit,
            system::start_system_file_drag,
            text_gen::generate_text,
            text_gen::test_provider_connection,
            text_gen::get_active_text_model_status,
            update::check_latest_release_tag,
            commands::export::save_text_file,
            commands::export::save_binary_file,
            script_project_package::export_script_project_package,
            script_project_package::preview_script_project_package,
            script_project_package::import_script_project_package,
            style_preset_package::export_style_template_package,
            style_preset_package::import_style_template_package,
            style_preset_package::export_mj_style_code_package,
            style_preset_package::import_mj_style_code_package,
            commands::storage::get_storage_info,
            commands::storage::list_database_backups,
            commands::storage::create_database_backup,
            commands::storage::ensure_daily_database_backup,
            commands::storage::restore_database_backup,
            commands::storage::migrate_storage,
            commands::storage::reset_storage_to_default,
            commands::storage::open_storage_folder,
            seedance::create_seedance_video_task,
            seedance::get_seedance_video_task,
            ps_server::start_ps_server,
            ps_server::stop_ps_server,
            ps_server::get_ps_server_status,
            ps_server::send_image_to_photoshop,
            ps_server::get_ps_selection,
            ps_server::get_ps_selection_image,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    if let Err(err) = commands::storage::ensure_storage_asset_scope(&app.handle().clone()) {
        warn!("failed to restore storage asset scope on startup: {err}");
    }

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(async {
                extensions::shutdown_all_extension_runtimes().await;
            });
        }
    });
}
