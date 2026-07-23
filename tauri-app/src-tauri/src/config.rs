//! Configuration management — schema compatible with TDLauncherPlusUtility.tox

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PathEntry {
    Path(String),
    Rich {
        path: String,
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        last_opened: Option<f64>,
    },
}

impl PathEntry {
    pub fn path(&self) -> &str {
        match self {
            PathEntry::Path(p) => p,
            PathEntry::Rich { path, .. } => path,
        }
    }

    pub fn into_rich(self, source: &str) -> RecentEntry {
        match self {
            PathEntry::Path(path) => RecentEntry {
                path,
                source: Some(source.to_string()),
                last_opened: Some(0.0),
            },
            PathEntry::Rich {
                path,
                source: s,
                last_opened,
            } => RecentEntry {
                path,
                source: s.or_else(|| Some(source.to_string())),
                last_opened: last_opened.or(Some(0.0)),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub launcher_recents: Vec<PathEntry>,
    #[serde(default)]
    pub td_recents: Vec<PathEntry>,
    #[serde(default)]
    pub td_recents_timestamp: f64,
    #[serde(default)]
    pub templates: Vec<PathEntry>,
    #[serde(default = "default_max_recent")]
    pub max_recent_files: u32,
    #[serde(default = "default_true")]
    pub confirm_remove_from_list: bool,
    #[serde(default)]
    pub show_icons: bool,
    #[serde(default)]
    pub show_readme: bool,
    #[serde(default)]
    pub collapse_versions: bool,
    #[serde(default = "default_true")]
    pub show_full_history: bool,
    #[serde(default)]
    pub has_prompted_file_assoc: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Legacy field — migrated on load
    #[serde(default, skip_serializing)]
    pub recent_files: Option<Vec<PathEntry>>,
}

fn default_version() -> u32 {
    1
}
fn default_max_recent() -> u32 {
    100
}
fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "classic".into()
}

fn normalize_theme(theme: &str) -> String {
    match theme {
        "ocean" | "amber" | "ember" | "frost" | "violet" | "mono" => theme.to_string(),
        _ => "classic".into(),
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            launcher_recents: vec![],
            td_recents: vec![],
            td_recents_timestamp: 0.0,
            templates: vec![],
            max_recent_files: 100,
            confirm_remove_from_list: true,
            show_icons: false,
            show_readme: false,
            collapse_versions: false,
            show_full_history: true,
            has_prompted_file_assoc: false,
            theme: default_theme(),
            recent_files: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrefsUpdate {
    pub max_recent_files: Option<u32>,
    pub confirm_remove_from_list: Option<bool>,
    pub show_icons: Option<bool>,
    pub show_readme: Option<bool>,
    pub collapse_versions: Option<bool>,
    pub show_full_history: Option<bool>,
    pub has_prompted_file_assoc: Option<bool>,
    pub theme: Option<String>,
}

pub struct ConfigManager {
    config_dir: PathBuf,
    config_file: PathBuf,
    pub config: AppConfig,
}

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn normalize_path(p: &str) -> String {
    let path = Path::new(p);
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join(path)
    };
    let canon = abs.canonicalize().unwrap_or(abs);
    let s = canon.to_string_lossy().to_string();
    // Strip Windows \\?\ prefix
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
    #[cfg(windows)]
    {
        s.to_lowercase().replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        s
    }
}

impl ConfigManager {
    pub fn new() -> Self {
        let config_dir = Self::config_dir();
        let config_file = config_dir.join("config.json");
        let mut mgr = Self {
            config_dir,
            config_file,
            config: AppConfig::default(),
        };
        mgr.load();
        mgr
    }

    pub fn config_dir() -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            dirs::data_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("TD Launcher Plus")
        }
        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
                .join("td-launcher")
        }
    }

    pub fn load(&mut self) {
        if let Ok(text) = fs::read_to_string(&self.config_file) {
            if let Ok(mut loaded) = serde_json::from_str::<AppConfig>(&text) {
                if loaded.launcher_recents.is_empty() {
                    if let Some(legacy) = loaded.recent_files.take() {
                        loaded.launcher_recents = legacy;
                    }
                }
                self.config = loaded;
                return;
            }
        }
        self.config = AppConfig::default();
    }

    pub fn save(&self) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(&self.config).map_err(|e| e.to_string())?;
        fs::write(&self.config_file, text).map_err(|e| e.to_string())
    }

    pub fn apply_prefs(&mut self, prefs: PrefsUpdate) -> Result<(), String> {
        if let Some(v) = prefs.max_recent_files {
            self.config.max_recent_files = v.clamp(5, 200);
        }
        if let Some(v) = prefs.confirm_remove_from_list {
            self.config.confirm_remove_from_list = v;
        }
        if let Some(v) = prefs.show_icons {
            self.config.show_icons = v;
        }
        if let Some(v) = prefs.show_readme {
            self.config.show_readme = v;
        }
        if let Some(v) = prefs.collapse_versions {
            self.config.collapse_versions = v;
        }
        if let Some(v) = prefs.show_full_history {
            self.config.show_full_history = v;
        }
        if let Some(v) = prefs.has_prompted_file_assoc {
            self.config.has_prompted_file_assoc = v;
        }
        if let Some(v) = prefs.theme {
            self.config.theme = normalize_theme(&v);
        }
        self.save()
    }

    pub fn add_recent_file(&mut self, file_path: &str) -> Result<(), String> {
        let abs = Path::new(file_path)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(file_path));
        let abs_str = abs
            .to_string_lossy()
            .strip_prefix(r"\\?\")
            .map(|s| s.to_string())
            .unwrap_or_else(|| abs.to_string_lossy().to_string());
        let norm = normalize_path(&abs_str);

        self.config.launcher_recents.retain(|e| normalize_path(e.path()) != norm);
        self.config.launcher_recents.insert(
            0,
            PathEntry::Rich {
                path: abs_str,
                source: Some("launcher".into()),
                last_opened: Some(now_secs()),
            },
        );
        let max = self.config.max_recent_files as usize;
        self.config.launcher_recents.truncate(max);
        self.save()
    }

    pub fn remove_recent_file(&mut self, file_path: &str) -> Result<(), String> {
        let norm = normalize_path(file_path);
        self.config
            .launcher_recents
            .retain(|e| normalize_path(e.path()) != norm);
        self.config
            .td_recents
            .retain(|e| normalize_path(e.path()) != norm);

        #[cfg(windows)]
        {
            blank_windows_td_recent(file_path);
        }

        self.save()
    }

    pub fn clear_recents(&mut self) -> Result<(), String> {
        self.config.launcher_recents.clear();
        self.config.td_recents.clear();
        self.save()
    }

    pub fn clear_missing_files(&mut self) -> Result<u32, String> {
        let mut removed = 0u32;

        let before = self.config.launcher_recents.len();
        self.config
            .launcher_recents
            .retain(|e| Path::new(e.path()).exists());
        removed += (before - self.config.launcher_recents.len()) as u32;

        let before = self.config.td_recents.len();
        self.config
            .td_recents
            .retain(|e| Path::new(e.path()).exists());
        removed += (before - self.config.td_recents.len()) as u32;

        #[cfg(windows)]
        {
            for entry in read_windows_td_recents() {
                if !Path::new(&entry.path).exists() {
                    blank_windows_td_recent(&entry.path);
                    removed += 1;
                }
            }
        }

        let before = self.config.templates.len();
        self.config
            .templates
            .retain(|e| Path::new(e.path()).exists());
        removed += (before - self.config.templates.len()) as u32;

        self.save()?;
        Ok(removed)
    }

    pub fn get_merged_recents(&self) -> Vec<RecentEntry> {
        let launcher: Vec<RecentEntry> = self
            .config
            .launcher_recents
            .iter()
            .cloned()
            .map(|e| e.into_rich("launcher"))
            .collect();

        #[cfg(windows)]
        let td_recents = read_windows_td_recents();

        #[cfg(target_os = "macos")]
        let mut td_recents = {
            let mut list = read_mac_td_recents();
            let sfl_paths: std::collections::HashSet<String> =
                list.iter().map(|e| normalize_path(&e.path)).collect();
            for entry in &self.config.td_recents {
                let p = entry.path().to_string();
                if !p.is_empty() && !sfl_paths.contains(&normalize_path(&p)) {
                    list.push(RecentEntry {
                        path: p,
                        source: Some("td".into()),
                        last_opened: None,
                    });
                }
            }
            list
        };

        #[cfg(not(any(windows, target_os = "macos")))]
        let mut td_recents: Vec<RecentEntry> = self
            .config
            .td_recents
            .iter()
            .cloned()
            .map(|e| e.into_rich("td"))
            .collect();

        let mut seen = std::collections::HashSet::new();
        let mut merged = Vec::new();

        let mut append = |items: Vec<RecentEntry>, force_source: Option<&str>| {
            for mut item in items {
                let norm = normalize_path(&item.path);
                if item.path.is_empty() || seen.contains(&norm) {
                    continue;
                }
                if let Some(s) = force_source {
                    item.source = Some(s.to_string());
                }
                seen.insert(norm);
                merged.push(item);
            }
        };

        #[cfg(target_os = "macos")]
        {
            let ts = self.config.td_recents_timestamp;
            let mut recent_launcher = Vec::new();
            let mut older_launcher = Vec::new();
            for item in launcher {
                if item.last_opened.unwrap_or(0.0) > ts {
                    recent_launcher.push(item);
                } else {
                    older_launcher.push(item);
                }
            }
            recent_launcher.sort_by(|a, b| {
                b.last_opened
                    .partial_cmp(&a.last_opened)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            append(recent_launcher, None);
            append(td_recents, Some("td"));
            append(older_launcher, None);
        }

        #[cfg(not(target_os = "macos"))]
        {
            append(td_recents, Some("td"));
            append(launcher, None);
        }

        merged
    }

    pub fn get_launcher_recents_only(&self) -> Vec<RecentEntry> {
        self.config
            .launcher_recents
            .iter()
            .cloned()
            .map(|e| e.into_rich("launcher"))
            .collect()
    }

    pub fn get_templates(&self) -> Vec<String> {
        self.config
            .templates
            .iter()
            .map(|e| e.path().to_string())
            .collect()
    }

    pub fn add_template(&mut self, file_path: &str) -> Result<(), String> {
        let abs = Path::new(file_path)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(file_path));
        let abs_str = abs
            .to_string_lossy()
            .strip_prefix(r"\\?\")
            .map(|s| s.to_string())
            .unwrap_or_else(|| abs.to_string_lossy().to_string());
        let norm = normalize_path(&abs_str);
        if self
            .config
            .templates
            .iter()
            .any(|t| normalize_path(t.path()) == norm)
        {
            return Ok(());
        }
        self.config.templates.insert(0, PathEntry::Path(abs_str));
        self.save()
    }

    pub fn remove_template(&mut self, file_path: &str) -> Result<(), String> {
        let norm = normalize_path(file_path);
        self.config
            .templates
            .retain(|t| normalize_path(t.path()) != norm);
        self.save()
    }

    pub fn move_template(&mut self, file_path: &str, direction: &str) -> Result<(), String> {
        let norm = normalize_path(file_path);
        let idx = self
            .config
            .templates
            .iter()
            .position(|t| normalize_path(t.path()) == norm)
            .ok_or_else(|| "Template not found".to_string())?;
        let len = self.config.templates.len();
        if len == 0 {
            return Ok(());
        }
        match direction {
            "up" => {
                if idx == 0 {
                    let item = self.config.templates.remove(0);
                    self.config.templates.push(item);
                } else {
                    self.config.templates.swap(idx, idx - 1);
                }
            }
            "down" => {
                if idx >= len - 1 {
                    let item = self.config.templates.remove(idx);
                    self.config.templates.insert(0, item);
                } else {
                    self.config.templates.swap(idx, idx + 1);
                }
            }
            _ => return Err("direction must be up or down".into()),
        }
        self.save()
    }
}

#[cfg(windows)]
fn read_windows_td_recents() -> Vec<RecentEntry> {
    use winreg::enums::*;
    use winreg::types::FromRegValue;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey(r"Software\Derivative\recent files") {
        Ok(k) => k,
        Err(_) => return vec![],
    };

    let mut raw: Vec<(u32, String)> = vec![];
    for (name, value) in key.enum_values().filter_map(|x| x.ok()) {
        if !name.starts_with("file") {
            continue;
        }
        let Ok(path) = String::from_reg_value(&value) else {
            continue;
        };
        if path.trim().is_empty() {
            continue;
        }
        let idx: u32 = name[4..].parse().unwrap_or(9999);
        raw.push((idx, path));
    }
    raw.sort_by_key(|(i, _)| *i);
    raw.into_iter()
        .map(|(_, path)| RecentEntry {
            path,
            source: Some("td".into()),
            last_opened: None,
        })
        .collect()
}

#[cfg(windows)]
fn blank_windows_td_recent(file_path: &str) -> bool {
    use winreg::enums::*;
    use winreg::types::FromRegValue;
    use winreg::RegKey;

    let norm = normalize_path(file_path);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey_with_flags(
        r"Software\Derivative\recent files",
        KEY_READ | KEY_SET_VALUE,
    ) {
        Ok(k) => k,
        Err(_) => return false,
    };

    for (name, value) in key.enum_values().filter_map(|x| x.ok()) {
        if !name.starts_with("file") {
            continue;
        }
        let Ok(path) = String::from_reg_value(&value) else {
            continue;
        };
        if !path.is_empty() && normalize_path(&path) == norm {
            let _ = key.set_value(&name, &"");
            return true;
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn read_mac_td_recents() -> Vec<RecentEntry> {
    use regex::Regex;
    use std::collections::HashSet;

    let sfl_path = dirs::home_dir()
        .unwrap_or_default()
        .join("Library/Application Support/com.apple.sharedfilelist")
        .join("com.apple.LSSharedFileList.ApplicationRecentDocuments")
        .join("ca.derivative.touchdesigner.sfl4");

    if !sfl_path.exists() {
        return vec![];
    }

    let data = match fs::read(&sfl_path) {
        Ok(d) => d,
        Err(_) => return vec![],
    };

    let plist_data: plist::Value = match plist::from_bytes(&data) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let objects = match plist_data.as_dictionary().and_then(|d| d.get("$objects")) {
        Some(plist::Value::Array(arr)) => arr,
        _ => return vec![],
    };

    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    for obj in objects {
        if let plist::Value::Data(bytes) = obj {
            if bytes.starts_with(b"book") {
                if let Some(path) = extract_path_from_bookmark(bytes) {
                    if seen.insert(path.clone()) {
                        entries.push(RecentEntry {
                            path,
                            source: Some("td".into()),
                            last_opened: None,
                        });
                    }
                }
            }
        }
    }
    entries
}

#[cfg(target_os = "macos")]
fn extract_path_from_bookmark(bookmark_data: &[u8]) -> Option<String> {
    let decoded: String = bookmark_data.iter().map(|&b| b as char).collect();
    let re = Regex::new(r"[^\x20-\x7e]+").ok()?;
    let parts: Vec<&str> = re
        .split(&decoded)
        .filter(|p| !p.is_empty() && !p.to_lowercase().starts_with("book"))
        .collect();

    let candidates: Vec<&str> = if let Some(idx) = parts.iter().position(|p| *p == "file:///") {
        parts[..idx].to_vec()
    } else {
        parts
    };

    let mut filename_idx = None;
    for i in (0..candidates.len()).rev() {
        let comp = candidates[i];
        if let Some(ext) = comp.rsplit('.').next() {
            if ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) && comp.contains('.')
            {
                filename_idx = Some(i);
                break;
            }
        }
    }
    let filename_idx = filename_idx?;

    let root_dirs = [
        "Users", "Volumes", "Applications", "Library", "System", "private", "tmp", "var", "opt",
        "usr", "etc", "Network", "bin", "sbin", "cores", "dev",
    ];
    let mut start_idx = None;
    for i in 0..filename_idx {
        if root_dirs.contains(&candidates[i]) {
            start_idx = Some(i);
            break;
        }
    }
    let start_idx = start_idx?;
    let path_parts = &candidates[start_idx..=filename_idx];
    if path_parts.len() >= 2 {
        Some(format!("/{}", path_parts.join("/")))
    } else {
        None
    }
}
