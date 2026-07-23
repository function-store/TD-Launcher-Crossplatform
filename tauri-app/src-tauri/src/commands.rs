//! Tauri command handlers for TD Launcher Plus.

use crate::config::{AppConfig, ConfigManager, PrefsUpdate, RecentEntry};
use crate::project::{
    get_file_meta, get_files_meta, get_readme_info, icon_data_url, open_in_file_manager, save_readme,
    FileMeta, ReadmeInfo,
};
use crate::td_manager::{DiscoverResult, TDManager, DEFAULT_TEMPLATE};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const APP_VERSION: &str = "3.0.0";

pub struct AppState {
    pub cli_toe: Mutex<Option<String>>,
    pub config: Mutex<ConfigManager>,
    pub td: Mutex<TDManager>,
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub default_template: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        version: APP_VERSION.into(),
        platform: std::env::consts::OS.into(),
        default_template: DEFAULT_TEMPLATE.into(),
    }
}

#[tauri::command]
pub fn get_cli_toe_file(state: State<'_, AppState>) -> Option<String> {
    state.cli_toe.lock().ok()?.clone()
}

#[tauri::command]
pub fn discover_versions(state: State<'_, AppState>) -> Result<DiscoverResult, String> {
    let mut td = state.td.lock().map_err(|e| e.to_string())?;
    Ok(td.discover())
}

#[tauri::command]
pub fn inspect_toe(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|p| p);
    let td = state.td.lock().map_err(|e| e.to_string())?;
    Ok(td.inspect_toe_file(&path, resource_dir.as_deref()))
}

#[tauri::command]
pub fn launch_project(
    app: AppHandle,
    path: String,
    version_key: String,
    use_touchplayer: bool,
    promote: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if promote && path != DEFAULT_TEMPLATE {
        let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.add_recent_file(&path)?;
    }
    {
        let td = state.td.lock().map_err(|e| e.to_string())?;
        td.launch(&path, &version_key, use_touchplayer)?;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?;
    Ok(cfg.config.clone())
}

#[tauri::command]
pub fn update_prefs(
    prefs: PrefsUpdate,
    state: State<'_, AppState>,
) -> Result<AppConfig, String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.apply_prefs(prefs)?;
    Ok(cfg.config.clone())
}

#[tauri::command]
pub fn get_recents(merged: bool, state: State<'_, AppState>) -> Result<Vec<RecentEntry>, String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?;
    Ok(if merged {
        cfg.get_merged_recents()
    } else {
        cfg.get_launcher_recents_only()
    })
}

#[tauri::command]
pub fn add_recent(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.add_recent_file(&path)
}

#[tauri::command]
pub fn remove_recent(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.remove_recent_file(&path)
}

#[tauri::command]
pub fn clear_recents(state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.clear_recents()
}

#[tauri::command]
pub fn clear_missing(state: State<'_, AppState>) -> Result<u32, String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.clear_missing_files()
}

#[tauri::command]
pub fn get_templates(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?;
    Ok(cfg.get_templates())
}

#[tauri::command]
pub fn add_template(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.add_template(&path)
}

#[tauri::command]
pub fn remove_template(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.remove_template(&path)
}

#[tauri::command]
pub fn move_template(
    path: String,
    direction: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
    cfg.move_template(&path, &direction)
}

#[tauri::command]
pub fn find_icon(path: String) -> Option<String> {
    crate::project::find_project_icon(&path)
}

#[tauri::command]
pub fn get_icon_data_url(path: String) -> Option<String> {
    let icon = crate::project::find_project_icon(&path)?;
    icon_data_url(&icon)
}

#[tauri::command]
pub fn get_readme(path: String) -> ReadmeInfo {
    get_readme_info(&path)
}

#[tauri::command]
pub fn save_readme_cmd(project_path: String, content: String) -> Result<String, String> {
    save_readme(&project_path, &content)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open_in_file_manager(&path)
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn pick_toe_files(
    app: AppHandle,
    multiple: bool,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let dialog = app.dialog().file().add_filter("TouchDesigner", &["toe"]);
    let picked = if multiple {
        dialog.blocking_pick_files()
    } else {
        dialog.blocking_pick_file().map(|p| vec![p])
    };

    Ok(picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub fn get_download_url(build_option: String) -> Option<String> {
    TDManager::generate_download_url(&build_option)
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    progress: f64,
    filename: String,
}

#[tauri::command]
pub fn download_td(
    app: AppHandle,
    url: String,
    dest_path: String,
) -> Result<(), String> {
    if Path::new(&dest_path).exists() {
        return Ok(());
    }
    if let Some(parent) = Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let filename = Path::new(&dest_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client.get(&url).send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut buffer = [0u8; 8192];

    use std::io::Read;
    loop {
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        let progress = if total > 0 {
            (downloaded as f64 / total as f64).min(1.0)
        } else {
            0.0
        };
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                progress,
                filename: filename.clone(),
            },
        );
    }

    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            progress: 1.0,
            filename,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn open_installer(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Installer not found".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn check_version_installed(
    version: String,
    use_touchplayer: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let td = state.td.lock().map_err(|e| e.to_string())?;
    Ok(if use_touchplayer {
        td.is_player_installed(&version)
    } else {
        td.is_version_installed(&version)
    })
}

#[tauri::command]
pub fn rediscover_and_check(
    version: String,
    use_touchplayer: bool,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut td = state.td.lock().map_err(|e| e.to_string())?;
    td.discover();
    Ok(if use_touchplayer {
        td.is_player_installed(&version)
    } else {
        td.is_version_installed(&version)
    })
}

#[tauri::command]
pub fn get_file_meta_cmd(path: String) -> FileMeta {
    get_file_meta(&path)
}

#[tauri::command]
pub fn get_files_meta_cmd(paths: Vec<String>) -> Vec<FileMeta> {
    get_files_meta(&paths)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn write_temp_html(content: String) -> Result<String, String> {
    let dir = std::env::temp_dir();
    let path = dir.join("td-launcher-readme.html");
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>README</title>
<style>body{{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.5;white-space:pre-wrap}}</style>
</head><body>{}</body></html>"#,
        html_escape(&content)
    );
    std::fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn parse_cli_toe() -> Option<String> {
    std::env::args().nth(1).and_then(|arg| {
        let p = Path::new(&arg);
        if p.exists() && arg.to_lowercase().ends_with(".toe") {
            Some(
                p.canonicalize()
                    .unwrap_or_else(|_| p.to_path_buf())
                    .to_string_lossy()
                    .strip_prefix(r"\\?\")
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| p.to_string_lossy().to_string()),
            )
        } else {
            None
        }
    })
}
