import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  AppInfo,
  DiscoverResult,
  FileMeta,
  PrefsUpdate,
  ReadmeInfo,
  RecentEntry,
} from "./types";

export const api = {
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  getCliToe: () => invoke<string | null>("get_cli_toe_file"),
  discoverVersions: () => invoke<DiscoverResult>("discover_versions"),
  inspectToe: (path: string) => invoke<string | null>("inspect_toe", { path }),
  launchProject: (
    path: string,
    versionKey: string,
    useTouchplayer: boolean,
    promote = true,
  ) =>
    invoke<void>("launch_project", {
      path,
      versionKey,
      useTouchplayer,
      promote,
    }),
  getConfig: () => invoke<AppConfig>("get_config"),
  updatePrefs: (prefs: PrefsUpdate) => invoke<AppConfig>("update_prefs", { prefs }),
  getRecents: (merged = true) => invoke<RecentEntry[]>("get_recents", { merged }),
  addRecent: (path: string) => invoke<void>("add_recent", { path }),
  removeRecent: (path: string) => invoke<void>("remove_recent", { path }),
  clearRecents: () => invoke<void>("clear_recents"),
  clearMissing: () => invoke<number>("clear_missing"),
  getTemplates: () => invoke<string[]>("get_templates"),
  addTemplate: (path: string) => invoke<void>("add_template", { path }),
  removeTemplate: (path: string) => invoke<void>("remove_template", { path }),
  moveTemplate: (path: string, direction: "up" | "down") =>
    invoke<void>("move_template", { path, direction }),
  getIconDataUrl: (path: string) => invoke<string | null>("get_icon_data_url", { path }),
  getReadme: (path: string) => invoke<ReadmeInfo>("get_readme", { path }),
  saveReadme: (projectPath: string, content: string) =>
    invoke<string>("save_readme_cmd", { projectPath, content }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  pickToeFiles: (multiple: boolean) =>
    invoke<string[]>("pick_toe_files", { multiple }),
  getDownloadUrl: (buildOption: string) =>
    invoke<string | null>("get_download_url", { buildOption }),
  downloadTd: (url: string, destPath: string) =>
    invoke<void>("download_td", { url, destPath }),
  openInstaller: (path: string) => invoke<void>("open_installer", { path }),
  checkVersionInstalled: (version: string, useTouchplayer: boolean) =>
    invoke<boolean>("check_version_installed", { version, useTouchplayer }),
  rediscoverAndCheck: (version: string, useTouchplayer: boolean) =>
    invoke<boolean>("rediscover_and_check", { version, useTouchplayer }),
  getFileMeta: (path: string) => invoke<FileMeta>("get_file_meta_cmd", { path }),
  getFilesMeta: (paths: string[]) => invoke<FileMeta[]>("get_files_meta_cmd", { paths }),
  quitApp: () => invoke<void>("quit_app"),
  writeTempHtml: (content: string) => invoke<string>("write_temp_html", { content }),
};
