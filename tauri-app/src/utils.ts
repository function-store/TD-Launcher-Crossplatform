import type { ListItem, RecentEntry } from "./types";
import { DEFAULT_TEMPLATE } from "./types";

/** Collapse numbered autosaves: project.7.toe → project.toe group key */
export function collapseKey(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || path;
  const m = name.match(/^(.*)\.(\d+)\.toe$/i);
  if (m) {
    const dir = path.slice(0, path.length - name.length);
    return dir + m[1] + ".toe";
  }
  return path;
}

export function displayName(path: string, isDefault = false): string {
  if (isDefault || path === DEFAULT_TEMPLATE) return "Default (new project)";
  const name = path.replace(/\\/g, "/").split("/").pop() || path;
  return name;
}

export function matchesSearch(path: string, filter: string): boolean {
  if (!filter.trim()) return true;
  const name = displayName(path).toLowerCase();
  const full = path.toLowerCase();
  const q = filter.trim().toLowerCase();
  if (q.includes("*") || q.includes("?")) {
    const re = new RegExp(
      "^" +
        q
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
      "i",
    );
    return re.test(name) || re.test(full);
  }
  return name.includes(q) || full.includes(q);
}

export function buildRecentItems(
  recents: RecentEntry[],
  meta: Record<string, { exists: boolean; mtime: string }>,
  collapse: boolean,
  filter: string,
  activePath?: string | null,
): ListItem[] {
  let paths = recents.map((r) => r.path);
  if (collapse) {
    const seen = new Set<string>();
    const collapsed: string[] = [];
    for (const p of paths) {
      const key = collapseKey(p);
      if (!seen.has(key.toLowerCase())) {
        seen.add(key.toLowerCase());
        // Prefer the base name entry if present, else first seen
        const base = recents.find((r) => r.path.toLowerCase() === key.toLowerCase());
        collapsed.push(base?.path ?? p);
      }
    }
    paths = collapsed;
  }

  const byPath = new Map(recents.map((r) => [r.path, r]));
  const items: ListItem[] = [];
  for (const path of paths) {
    if (!matchesSearch(path, filter)) continue;
    const entry = byPath.get(path);
    const m = meta[path];
    items.push({
      path,
      displayName: displayName(path),
      source: path === activePath ? "active" : entry?.source ?? "launcher",
      missing: m ? !m.exists : false,
      mtime: m?.mtime,
    });
  }
  return items;
}

export function buildTemplateItems(
  templates: string[],
  meta: Record<string, { exists: boolean; mtime: string }>,
  filter: string,
): ListItem[] {
  const items: ListItem[] = [
    {
      path: DEFAULT_TEMPLATE,
      displayName: "Default (new project)",
      source: "default",
      missing: false,
      isDefault: true,
    },
  ];
  for (const path of templates) {
    if (!matchesSearch(path, filter)) continue;
    const m = meta[path];
    items.push({
      path,
      displayName: displayName(path),
      source: "template",
      missing: m ? !m.exists : false,
      mtime: m?.mtime,
    });
  }
  return items.filter(
    (i) => i.isDefault || matchesSearch(i.path, filter) || !filter.trim(),
  );
}

export function displayBuildInfo(build: string | null, usePlayer: boolean): string {
  if (!build) return "";
  if (usePlayer) return build.replace(/^TouchDesigner\./, "TouchPlayer.");
  return build;
}

export function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

export function dirname(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? path.slice(0, path.length - (norm.length - i)) : path;
}
