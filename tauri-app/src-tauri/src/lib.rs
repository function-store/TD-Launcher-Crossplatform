mod commands;
mod config;
mod project;
mod td_manager;

use commands::{parse_cli_toe, AppState, APP_VERSION};
use config::ConfigManager;
use std::sync::Mutex;
use td_manager::TDManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_toe = parse_cli_toe();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            cli_toe: Mutex::new(cli_toe),
            config: Mutex::new(ConfigManager::new()),
            td: Mutex::new(TDManager::new()),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            log::info!("TD Launcher Plus v{APP_VERSION}");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_cli_toe_file,
            commands::discover_versions,
            commands::inspect_toe,
            commands::launch_project,
            commands::get_config,
            commands::update_prefs,
            commands::get_recents,
            commands::add_recent,
            commands::remove_recent,
            commands::clear_recents,
            commands::clear_missing,
            commands::get_templates,
            commands::add_template,
            commands::remove_template,
            commands::move_template,
            commands::find_icon,
            commands::get_icon_data_url,
            commands::get_readme,
            commands::save_readme_cmd,
            commands::open_path,
            commands::open_url,
            commands::pick_toe_files,
            commands::get_download_url,
            commands::download_td,
            commands::open_installer,
            commands::check_version_installed,
            commands::rediscover_and_check,
            commands::get_file_meta_cmd,
            commands::quit_app,
            commands::write_temp_html,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
