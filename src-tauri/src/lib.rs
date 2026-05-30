pub mod ai;
pub mod commands;

use std::path::PathBuf;
use std::time::Duration;

use commands::ad_skill_package;
use commands::ai as ai_commands;
use commands::asset_state;
use commands::clip_library;
use commands::director_stage;
use commands::dreamina_cli;
use commands::error_log;
use commands::extensions;
use commands::gpt_best_video;
use commands::generation_history;
use commands::image;
use commands::jimeng_video_queue;
use commands::media_audio;
use commands::midjourney;
use commands::project_state;
use commands::project_window_sessions;
use commands::ps_server;
use commands::script_project_package;
use commands::seedance;
use commands::style_preset_package;
use commands::system;
use commands::text_gen;
use commands::update;
use commands::vidu;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, LogicalSize, Manager, WebviewWindow};
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const MAIN_TRAY_ID: &str = "main-tray";
pub(crate) const MAIN_TRAY_SHOW_WINDOW_MENU_ID: &str = "show-main-window";
pub(crate) const MAIN_TRAY_QUIT_MENU_ID: &str = "quit-app";
pub(crate) const FRONTEND_MAIN_CLOSE_REQUEST_EVENT: &str = "app:request-main-close";
const FRONTEND_READY_TIMEOUT_MS: u64 = 3_500;
const MAIN_WINDOW_WORK_AREA_MARGIN_WIDTH: f64 = 48.0;
const MAIN_WINDOW_WORK_AREA_MARGIN_HEIGHT: f64 = 72.0;

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

pub(crate) fn set_main_tray_visible(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) else {
        if visible {
            return Err("main tray icon not found".to_string());
        }
        return Ok(());
    };

    tray.set_visible(visible)
        .map_err(|err| format!("failed to set tray visibility: {err}"))
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Err(err) = set_main_tray_visible(app, false) {
        warn!("{err}");
    }

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

pub(crate) fn minimize_main_window_to_tray(app: &tauri::AppHandle) -> Result<(), String> {
    set_main_tray_visible(app, true)?;

    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window not found while minimizing to tray".to_string());
    };

    main_window
        .hide()
        .map_err(|err| format!("failed to hide main window to tray: {err}"))
}

fn emit_main_window_close_request(app: &tauri::AppHandle) {
    show_main_window(app);

    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("main window not found while emitting close request");
        return;
    };

    if let Err(err) = main_window.emit(FRONTEND_MAIN_CLOSE_REQUEST_EVENT, ()) {
        warn!("failed to emit main close request event: {err}");
    }
}

fn setup_main_tray(app: &tauri::App) -> Result<(), String> {
    let tray_icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "missing default window icon for tray".to_string())?;
    let show_main_window_item = MenuItem::with_id(
        app,
        MAIN_TRAY_SHOW_WINDOW_MENU_ID,
        "显示主窗口",
        true,
        None::<&str>,
    )
    .map_err(|err| format!("failed to create tray show menu item: {err}"))?;
    let quit_app_item =
        MenuItem::with_id(app, MAIN_TRAY_QUIT_MENU_ID, "退出应用", true, None::<&str>)
            .map_err(|err| format!("failed to create tray quit menu item: {err}"))?;
    let tray_menu = Menu::with_items(app, &[&show_main_window_item, &quit_app_item])
        .map_err(|err| format!("failed to create tray menu: {err}"))?;
    let tray = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .icon(tray_icon)
        .menu(&tray_menu)
        .tooltip("OOpii Infinite Canvas")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == MAIN_TRAY_SHOW_WINDOW_MENU_ID {
                show_main_window(app);
                return;
            }

            if event.id() == MAIN_TRAY_QUIT_MENU_ID {
                emit_main_window_close_request(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|err| format!("failed to build main tray icon: {err}"))?;

    if let Err(err) = tray.set_visible(false) {
        warn!("failed to hide tray icon on startup: {err}");
    }

    Ok(())
}

fn fit_main_window_to_work_area(
    window: &WebviewWindow,
    window_config: &tauri::utils::config::WindowConfig,
) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        warn!("failed to resolve monitor for main window sizing");
        return;
    };

    let scale_factor = monitor.scale_factor().max(1.0);
    let work_area = monitor.work_area();
    let max_width = (f64::from(work_area.size.width) / scale_factor
        - MAIN_WINDOW_WORK_AREA_MARGIN_WIDTH)
        .max(window_config.min_width.unwrap_or(720.0));
    let max_height = (f64::from(work_area.size.height) / scale_factor
        - MAIN_WINDOW_WORK_AREA_MARGIN_HEIGHT)
        .max(window_config.min_height.unwrap_or(520.0));

    let target_width = window_config.width.min(max_width);
    let target_height = window_config.height.min(max_height);
    let width_changed = (target_width - window_config.width).abs() >= 1.0;
    let height_changed = (target_height - window_config.height).abs() >= 1.0;

    if !width_changed && !height_changed {
        return;
    }

    if let Err(err) = window.set_size(LogicalSize::new(target_width, target_height)) {
        warn!("failed to clamp main window size to monitor work area: {err}");
        return;
    }

    if window_config.center {
        if let Err(err) = window.center() {
            warn!("failed to center main window after resizing: {err}");
        }
    }

    info!(
        "adjusted main window startup size to {:.0}x{:.0} logical px for work area {}x{}",
        target_width, target_height, work_area.size.width, work_area.size.height
    );
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
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

            fit_main_window_to_work_area(&main_window, &window_config);

            if let Err(err) = main_window.show() {
                warn!("failed to show main window on startup: {err}");
            }
            if let Err(err) = main_window.set_focus() {
                warn!("failed to focus main window on startup: {err}");
            }

            if let Err(err) = setup_main_tray(app) {
                warn!("{err}");
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
            dreamina_cli::resolve_jimeng_dreamina_video_submit_id_cache,
            image::split_image,
            image::split_image_source,
            image::prepare_node_image_source,
            image::prepare_node_image_binary,
            image::create_node_thumbnail_source,
            image::crop_image_source,
            image::merge_storyboard_images,
            image::read_storyboard_image_metadata,
            image::embed_storyboard_image_metadata,
            image::optimize_reference_images_for_api,
            image::load_image,
            image::read_local_image_binary,
            image::persist_image_source,
            image::persist_image_binary,
            image::save_image_source_to_downloads,
            image::save_image_source_to_path,
            image::save_image_source_to_directory,
            image::save_image_source_to_app_debug_dir,
            image::copy_image_source_to_clipboard,
            media_audio::trim_media_source,
            media_audio::extract_audio_from_video,
            director_stage::transcode_director_stage_recording_to_mp4,
            jimeng_video_queue::list_jimeng_video_queue_jobs,
            jimeng_video_queue::list_all_jimeng_video_queue_jobs,
            jimeng_video_queue::upsert_jimeng_video_queue_job,
            jimeng_video_queue::delete_jimeng_video_queue_job,
            error_log::list_error_log_items,
            error_log::upsert_error_log_item,
            error_log::delete_error_log_item,
            error_log::clear_error_log_items,
            error_log::prune_error_log_items,
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
            asset_state::repair_asset_item_preview,
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
            project_state::get_project_record_without_history,
            project_state::get_project_history_record,
            project_state::get_project_graph_record,
            project_state::get_project_graph_record_if_ready,
            project_state::get_project_graph_history,
            project_state::apply_project_graph_patch,
            project_state::upsert_project_graph_snapshot,
            project_state::compact_project_graph_backup,
            project_state::validate_project_graph_storage,
            project_state::upsert_project_record,
            project_state::update_project_viewport_record,
            project_state::list_commerce_agent_threads,
            project_state::get_commerce_agent_thread,
            project_state::upsert_commerce_agent_thread,
            project_state::delete_commerce_agent_thread,
            project_state::rename_project_record,
            project_state::delete_project_record,
            project_state::organize_project_media,
            project_state::get_style_template_state,
            project_state::save_style_template_state,
            project_state::sync_style_template_image_refs,
            project_window_sessions::register_project_window,
            project_window_sessions::unregister_project_window,
            project_window_sessions::claim_project_edit_session,
            project_window_sessions::release_project_edit_session,
            project_window_sessions::list_project_edit_sessions,
            project_window_sessions::focus_project_window,
            system::get_runtime_system_info,
            system::minimize_main_window_to_tray,
            system::read_system_clipboard_file_paths,
            system::request_app_exit,
            system::start_system_file_drag,
            text_gen::generate_text,
            text_gen::start_script_director_storyboard_stream,
            text_gen::cancel_script_director_storyboard_stream,
            text_gen::start_commerce_ad_agent_stream,
            text_gen::cancel_commerce_ad_agent_stream,
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
            commands::storage::list_rotating_database_snapshots,
            commands::storage::create_rotating_database_snapshot,
            commands::storage::restore_rotating_database_snapshot,
            commands::storage::check_database_health,
            commands::storage::migrate_storage,
            commands::storage::reset_storage_to_default,
            commands::storage::adopt_existing_storage_path,
            commands::storage::check_storage_session,
            commands::storage::refresh_storage_session,
            commands::storage::open_storage_folder,
            seedance::create_seedance_video_task,
            seedance::get_seedance_video_task,
            gpt_best_video::create_gpt_best_video_task,
            gpt_best_video::get_gpt_best_video_task,
            gpt_best_video::download_gpt_best_video_content,
            generation_history::scan_generation_history,
            generation_history::list_generation_history,
            generation_history::open_generation_history_item_in_folder,
            vidu::create_vidu_video_task,
            vidu::create_vidu_voice_clone,
            vidu::get_vidu_video_task,
            ps_server::start_ps_server,
            ps_server::stop_ps_server,
            ps_server::get_ps_server_status,
            ps_server::send_image_to_photoshop,
            ps_server::get_ps_selection,
            ps_server::get_ps_selection_image,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    let app_handle = app.handle().clone();

    if let Err(err) = commands::storage::recover_storage_from_legacy_default_if_needed(&app_handle)
    {
        warn!("failed to recover legacy storage root on startup: {err}");
    }

    if let Err(err) = commands::storage::ensure_storage_asset_scope(&app_handle) {
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
