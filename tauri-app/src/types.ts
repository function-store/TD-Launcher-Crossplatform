export const DEFAULT_TEMPLATE = "__default__";

export interface AppInfo {
  version: string;
  platform: string;
  default_template: string;
}

export interface RecentEntry {
  path: string;
  source?: string | null;
  last_opened?: number | null;
}

export interface VersionInfo {
  key: string;
  executable: string;
  install_path?: string | null;
  app_path?: string | null;
  bundle_version?: string | null;
}

export interface DiscoverResult {
  versions: VersionInfo[];
  players: VersionInfo[];
}

export interface AppConfig {
  version: number;
  launcher_recents: unknown[];
  td_recents: unknown[];
  td_recents_timestamp: number;
  templates: unknown[];
  max_recent_files: number;
  confirm_remove_from_list: boolean;
  show_icons: boolean;
  show_readme: boolean;
  collapse_versions: boolean;
  show_full_history: boolean;
  has_prompted_file_assoc: boolean;
  theme: string;
}

export interface PrefsUpdate {
  max_recent_files?: number;
  confirm_remove_from_list?: boolean;
  show_icons?: boolean;
  show_readme?: boolean;
  collapse_versions?: boolean;
  show_full_history?: boolean;
  has_prompted_file_assoc?: boolean;
  theme?: string;
}

export type ThemeId = "classic" | "ocean" | "amber" | "ember" | "frost" | "violet" | "mono";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "ocean", label: "Ocean" },
  { id: "amber", label: "Amber" },
  { id: "ember", label: "Ember" },
  { id: "frost", label: "Frost" },
  { id: "violet", label: "Violet" },
  { id: "mono", label: "Mono" },
];

export interface FileMeta {
  exists: boolean;
  name: string;
  dir: string;
  mtime: string;
  mtime_secs: number;
}

export interface ReadmeInfo {
  path: string | null;
  content: string;
  summary: string;
}

export type TabId = "recent" | "templates";
export type FocusArea = "picker" | "versions";

export interface ListItem {
  path: string;
  displayName: string;
  source?: string;
  missing: boolean;
  mtime?: string;
  isDefault?: boolean;
}
