//! Project helpers: icons, README, file metadata.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Local};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize)]
pub struct FileMeta {
    pub exists: bool,
    pub name: String,
    pub dir: String,
    pub mtime: String,
    pub mtime_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadmeInfo {
    pub path: Option<String>,
    pub content: String,
    pub summary: String,
}

pub fn get_file_meta(path: &str) -> FileMeta {
    let p = Path::new(path);
    let exists = p.exists();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir = p
        .parent()
        .map(|d| d.to_string_lossy().to_string())
        .unwrap_or_default();
    let (mtime, mtime_secs) = if exists {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .map(|t| {
                let secs = t
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                let dt: DateTime<Local> = t.into();
                (dt.format("%Y-%m-%d %H:%M").to_string(), secs)
            })
            .unwrap_or_else(|_| (String::new(), 0.0))
    } else {
        (String::new(), 0.0)
    };
    FileMeta {
        exists,
        name,
        dir,
        mtime,
        mtime_secs,
    }
}

fn project_bases(project_path: &str) -> (PathBuf, Vec<String>) {
    let project_path = Path::new(project_path);
    let project_dir = project_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let filename = project_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let project_base = if filename.to_lowercase().ends_with(".toe") {
        filename[..filename.len() - 4].to_string()
    } else {
        project_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(filename)
    };

    let mut names = Vec::new();
    if let Some((base, ver)) = project_base.rsplit_once('.') {
        if ver.chars().all(|c| c.is_ascii_digit()) {
            names.push(base.to_string());
        }
    }
    names.push(project_base);
    (project_dir, names)
}

pub fn find_project_icon(project_path: &str) -> Option<String> {
    if !Path::new(project_path).exists() {
        return None;
    }
    let (project_dir, names) = project_bases(project_path);
    let exts = [".png", ".jpg", ".jpeg"];

    // 1. {name}_icon
    for name in &names {
        for ext in &exts {
            let p = project_dir.join(format!("{name}_icon{ext}"));
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    // 2. {name}_icon_temp
    for name in &names {
        for ext in &exts {
            let p = project_dir.join(format!("{name}_icon_temp{ext}"));
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    // 3. icon_{name}
    for name in &names {
        for ext in &exts {
            let p = project_dir.join(format!("icon_{name}{ext}"));
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    // 4. icon_temp_{name}
    for name in &names {
        for ext in &exts {
            let p = project_dir.join(format!("icon_temp_{name}{ext}"));
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    // 5. icon.*
    for ext in &exts {
        let p = project_dir.join(format!("icon{ext}"));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    // 6. newest image not starting with icon_
    if let Ok(entries) = fs::read_dir(&project_dir) {
        let mut candidates: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| matches!(e.to_lowercase().as_str(), "png" | "jpg" | "jpeg"))
                        .unwrap_or(false)
                    && !p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().starts_with("icon_"))
                        .unwrap_or(true)
            })
            .collect();
        candidates.sort_by_key(|p| {
            std::cmp::Reverse(
                fs::metadata(p)
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH),
            )
        });
        if let Some(p) = candidates.first() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

pub fn icon_data_url(icon_path: &str) -> Option<String> {
    let bytes = fs::read(icon_path).ok()?;
    let mime = if icon_path.to_lowercase().ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes)
    ))
}

pub fn find_readme(project_path: &str) -> Option<String> {
    if !Path::new(project_path).exists() {
        return None;
    }
    let dir = Path::new(project_path).parent()?;
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.starts_with("readme") && lower.ends_with(".md") {
            return Some(entry.path().to_string_lossy().to_string());
        }
    }
    None
}

pub fn read_readme_content(readme_path: &str, max_length: usize) -> String {
    match fs::read_to_string(readme_path) {
        Ok(mut content) => {
            if content.len() > max_length {
                content.truncate(max_length);
                content.push_str("\n\n... (content truncated)");
            }
            content
        }
        Err(e) => format!("Error reading README: {e}"),
    }
}

pub fn get_project_summary(project_path: &str) -> String {
    let Some(readme_path) = find_readme(project_path) else {
        return String::new();
    };
    let Ok(content) = fs::read_to_string(readme_path) else {
        return String::new();
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with('*')
            || line.starts_with('-')
            || line.starts_with('>')
            || line.starts_with('=')
            || line.starts_with('[')
            || line.starts_with("```")
            || line.starts_with('!')
        {
            continue;
        }
        let cleaned = strip_inline_markdown(line);
        if cleaned.is_empty() {
            continue;
        }
        if cleaned.len() > 250 {
            return format!("{}...", &cleaned[..247]);
        }
        return cleaned;
    }
    String::new()
}

fn strip_inline_markdown(s: &str) -> String {
    let mut out = s.to_string();
    // [text](url) -> text
    if let Ok(re) = regex::Regex::new(r"\[([^\]]+)\]\([^)]+\)") {
        out = re.replace_all(&out, "$1").to_string();
    }
    // bare URLs in angle brackets
    if let Ok(re) = regex::Regex::new(r"<([^>]+)>") {
        out = re.replace_all(&out, "$1").to_string();
    }
    out = out.replace("**", "").replace("__", "").replace('`', "");
    out.trim().to_string()
}

pub fn get_files_meta(paths: &[String]) -> Vec<FileMeta> {
    paths.iter().map(|p| get_file_meta(p)).collect()
}

pub fn get_readme_info(project_path: &str) -> ReadmeInfo {
    let path = find_readme(project_path);
    let content = path
        .as_ref()
        .map(|p| read_readme_content(p, 50000))
        .unwrap_or_default();
    let summary = get_project_summary(project_path);
    ReadmeInfo {
        path,
        content,
        summary,
    }
}

pub fn save_readme(project_path: &str, content: &str) -> Result<String, String> {
    let dir = Path::new(project_path)
        .parent()
        .ok_or_else(|| "Invalid project path".to_string())?;
    let readme_path = find_readme(project_path)
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("README.md"));
    fs::write(&readme_path, content).map_err(|e| e.to_string())?;
    Ok(readme_path.to_string_lossy().to_string())
}

pub fn open_in_file_manager(path: &str) -> Result<(), String> {
#[cfg(windows)]
{
    command_open_windows(path)
}
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let dir = Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(windows)]
fn command_open_windows(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
