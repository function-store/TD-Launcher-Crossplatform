import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type {
  AppConfig,
  DiscoverResult,
  FocusArea,
  ListItem,
  RecentEntry,
  TabId,
  ThemeId,
} from "./types";
import { DEFAULT_TEMPLATE, THEMES } from "./types";
import {
  basename,
  buildRecentItems,
  buildTemplateItems,
  dirname,
  displayBuildInfo,
  findMatchingVersionKey,
  plainSummary,
  versionNumeric,
} from "./utils";

type Modal = "settings" | "help" | "about" | "firstrun" | "install" | "clear" | "remove" | null;

const COUNTDOWN_SECS = 5; // matches original _update_countdown (hardcoded 5s)
const UTILITY_TOX_URL =
  "https://github.com/function-store/TD-Launcher-Plus/releases/latest/download/TDLauncherPlusUtility.tox";

function applyTheme(theme: string | undefined | null) {
  const id = THEMES.some((t) => t.id === theme) ? (theme as ThemeId) : "classic";
  document.documentElement.setAttribute("data-theme", id);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [version, setVersion] = useState("3.0.0");
  const [platform, setPlatform] = useState("windows");
  const [tab, setTab] = useState<TabId>("recent");
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, { exists: boolean; mtime: string }>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [discover, setDiscover] = useState<DiscoverResult>({ versions: [], players: [] });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeManual, setActiveManual] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [buildInfo, setBuildInfo] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [usePlayer, setUsePlayer] = useState(false);
  const [focus, setFocus] = useState<FocusArea>("picker");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [cliMode, setCliMode] = useState(false);
  const [readme, setReadme] = useState({ path: null as string | null, content: "", summary: "" });
  const [readmeEdit, setReadmeEdit] = useState(false);
  const [readmeDraft, setReadmeDraft] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [maxRecentDraft, setMaxRecentDraft] = useState(100);

  const searchRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<HTMLDivElement | null>(null);
  const analysisId = useRef(0);
  const versionCache = useRef(new Map<string, string | null>());
  const countdownTimer = useRef<number | null>(null);
  const installPoll = useRef<number | null>(null);
  const iconsRef = useRef<Record<string, string>>({});

  const isMac = platform === "macos";
  const mod = isMac ? "⌘" : "Ctrl";

  useEffect(() => {
    iconsRef.current = icons;
  }, [icons]);

  useEffect(() => {
    applyTheme(config?.theme);
  }, [config?.theme]);

  const refreshLists = useCallback(async (cfg?: AppConfig, opts?: { rediscover?: boolean }) => {
    const c = cfg ?? (await api.getConfig());
    setConfig(c);
    setMaxRecentDraft(c.max_recent_files);

    const rediscover = opts?.rediscover ?? true;
    const listTasks: [Promise<RecentEntry[]>, Promise<string[]>, Promise<DiscoverResult>?] = [
      api.getRecents(true),
      api.getTemplates(),
      rediscover ? api.discoverVersions() : undefined,
    ];

    const [r, t, d] = await Promise.all([
      listTasks[0],
      listTasks[1],
      listTasks[2] ?? Promise.resolve(null),
    ]);
    setRecents(r);
    setTemplates(t);
    if (d) setDiscover(d);

    const paths = [...r.map((x) => x.path), ...t];
    const metas = paths.length ? await api.getFilesMeta(paths) : [];
    const nextMeta: Record<string, { exists: boolean; mtime: string }> = {};
    paths.forEach((p, i) => {
      nextMeta[p] = { exists: metas[i]?.exists ?? false, mtime: metas[i]?.mtime ?? "" };
    });
    setMeta(nextMeta);

    if (c.show_icons) {
      const nextIcons = { ...iconsRef.current };
      const need = paths.filter((p) => nextMeta[p]?.exists && !nextIcons[p]).slice(0, 40);
      if (need.length) {
        await Promise.all(
          need.map(async (p) => {
            const url = await api.getIconDataUrl(p);
            if (url) nextIcons[p] = url;
          }),
        );
        setIcons(nextIcons);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const info = await api.getAppInfo();
      setVersion(info.version);
      setPlatform(info.platform);
      const cli = await api.getCliToe();
      const cfg = await api.getConfig();
      await refreshLists(cfg);

      if (cli) {
        // File-open mode: analyze/select the .toe, focus versions, auto-countdown
        setCliMode(true);
        setSelectedPath(cli);
        setActiveManual(cli);
        setFocus("versions");
        setTab("recent");
        // Warm meta for CLI file (may not be in recents yet)
        try {
          const m = await api.getFileMeta(cli);
          setMeta((prev) => ({ ...prev, [cli]: { exists: m.exists, mtime: m.mtime } }));
        } catch {
          /* ignore */
        }
      } else {
        // Dashboard mode: select most-recent file, show version panel, no countdown
        setCliMode(false);
        setFocus("picker");
        setTab("recent");
        const r = await api.getRecents(true);
        if (r[0]?.path) {
          setSelectedPath(r[0].path);
        }
        if (!cfg.has_prompted_file_assoc) setModal("firstrun");
      }

      setReady(true);

      // Size + show only after UI data is ready (avoids white/small flash)
      try {
        const win = getCurrentWindow();
        await win.setSize(new LogicalSize(cfg.show_readme ? 1190 : 640, 700));
        await win.show();
        await win.setFocus();
      } catch (e) {
        console.error(e);
      }
    })().catch(async (e) => {
      setStatusMsg(String(e));
      setReady(true);
      try {
        await getCurrentWindow().show();
      } catch {
        /* ignore */
      }
    });
  }, [refreshLists]);

  useEffect(() => {
    const un = listen<{ progress: number }>("download-progress", (e) => {
      setDownloadProgress(e.payload.progress);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Drag-drop .toe files onto the window
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "drop") {
          const toes = event.payload.paths.filter((p) =>
            p.toLowerCase().endsWith(".toe"),
          );
          if (toes[0]) {
            setSelectedPath(toes[0]);
            setActiveManual(toes[0]);
            setTab("recent");
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const sessionRecents = useMemo(() => {
    // Match original: pin active_manual (CLI / browse) to top of recents
    if (!activeManual) return recents;
    const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
    const target = norm(activeManual);
    const list = [...recents];
    const idx = list.findIndex((r) => norm(r.path) === target);
    if (idx > 0) {
      const [item] = list.splice(idx, 1);
      list.unshift(item);
    } else if (idx === -1) {
      list.unshift({
        path: activeManual,
        source: "launcher",
        last_opened: Date.now() / 1000,
      });
    }
    return list;
  }, [recents, activeManual]);

  const recentItems = useMemo(
    () =>
      buildRecentItems(
        sessionRecents,
        meta,
        !!config?.collapse_versions,
        search,
        activeManual,
      ),
    [sessionRecents, meta, config?.collapse_versions, search, activeManual],
  );

  const templateItems = useMemo(
    () => buildTemplateItems(templates, meta, search),
    [templates, meta, search],
  );

  const items: ListItem[] = tab === "recent" ? recentItems : templateItems;

  const nameColCh = useMemo(() => {
    const longest = items.reduce((m, i) => Math.max(m, i.displayName.length), 22);
    return Math.min(Math.max(longest + 1, 18), 42);
  }, [items]);

  // Keep selected file row in view (keyboard nav, search filter, tab switch, load)
  useEffect(() => {
    if (!selectedPath || !selectedFileRef.current) return;
    selectedFileRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedPath, items, tab, search, focus]);

  const versionKeys = useMemo(() => {
    const list = usePlayer ? discover.players : discover.versions;
    return list.map((v) => v.key);
  }, [discover, usePlayer]);

  const versionInstalled = useMemo(() => {
    if (!buildInfo) return true;
    if (selectedPath === DEFAULT_TEMPLATE) return versionKeys.length > 0;
    const target = versionNumeric(buildInfo);
    const list = usePlayer ? discover.players : discover.versions;
    return list.some((v) => versionNumeric(v.key) === target);
  }, [buildInfo, discover, usePlayer, selectedPath, versionKeys.length]);

  const applyBuildSelection = useCallback(
    (info: string | null, player: boolean) => {
      if (!info) {
        if (versionKeys.length) setSelectedVersion(versionKeys[versionKeys.length - 1]);
        return;
      }
      const keys = (player ? discover.players : discover.versions).map((v) => v.key);
      setSelectedVersion(findMatchingVersionKey(info, keys, player));
    },
    [discover.players, discover.versions, versionKeys],
  );

  // Analyze selected file (cached; TouchPlayer toggle does not re-inspect)
  useEffect(() => {
    if (!selectedPath || selectedPath === DEFAULT_TEMPLATE) {
      setBuildInfo(null);
      setAnalyzing(false);
      if (selectedPath === DEFAULT_TEMPLATE && versionKeys.length) {
        setSelectedVersion(versionKeys[versionKeys.length - 1]);
      }
      return;
    }
    if (meta[selectedPath] && !meta[selectedPath].exists) {
      setBuildInfo(null);
      setAnalyzing(false);
      return;
    }

    const cached = versionCache.current.get(selectedPath);
    if (cached !== undefined) {
      setBuildInfo(cached);
      setAnalyzing(false);
      applyBuildSelection(cached, usePlayer);
      return;
    }

    const id = ++analysisId.current;
    setAnalyzing(true);
    const t = window.setTimeout(async () => {
      try {
        const info = await api.inspectToe(selectedPath);
        if (analysisId.current !== id) return;
        versionCache.current.set(selectedPath, info);
        setBuildInfo(info);
        applyBuildSelection(info, usePlayer);
      } finally {
        if (analysisId.current === id) setAnalyzing(false);
      }
    }, 40);
    return () => clearTimeout(t);
  }, [selectedPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remap selected version when TouchPlayer toggles — no toeexpand
  useEffect(() => {
    if (!selectedPath || selectedPath === DEFAULT_TEMPLATE) {
      if (selectedPath === DEFAULT_TEMPLATE && versionKeys.length) {
        setSelectedVersion(versionKeys[versionKeys.length - 1]);
      }
      return;
    }
    applyBuildSelection(buildInfo, usePlayer);
  }, [usePlayer]); // eslint-disable-line react-hooks/exhaustive-deps

  // README
  useEffect(() => {
    if (!config?.show_readme || !selectedPath || selectedPath === DEFAULT_TEMPLATE) {
      setReadme({ path: null, content: "", summary: "" });
      setReadmeEdit(false);
      return;
    }
    let cancelled = false;
    api.getReadme(selectedPath).then((r) => {
      if (cancelled) return;
      setReadme(r);
      setReadmeDraft(r.content);
      setReadmeEdit(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, config?.show_readme]);

  // Countdown for CLI mode
  useEffect(() => {
    if (!cliMode || !selectedPath || !buildInfo || !versionInstalled || analyzing) {
      setCountdown(null);
      return;
    }
    setCountdown(COUNTDOWN_SECS);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [cliMode, selectedPath, buildInfo, versionInstalled, analyzing]);

  useEffect(() => {
    if (countdown === 0 && selectedPath && selectedVersion) {
      void doLaunch(true);
    }
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelCountdown = () => {
    setCountdown(null);
    setCliMode(false);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
  };

  const doLaunch = async (promote = true) => {
    if (!selectedPath || !selectedVersion) return;
    cancelCountdown();
    try {
      await api.launchProject(selectedPath, selectedVersion, usePlayer, promote);
    } catch (e) {
      setStatusMsg(String(e));
    }
  };

  const selectItem = (item: ListItem) => {
    cancelCountdown();
    if (item.missing) return;
    setSelectedPath(item.path);
    setFocus("picker");
  };

  const updatePref = async (patch: Partial<AppConfig>) => {
    // Resize window before React reflow when toggling info panel
    if ("show_readme" in patch && patch.show_readme !== config?.show_readme) {
      try {
        await getCurrentWindow().setSize(
          new LogicalSize(patch.show_readme ? 1190 : 640, 700),
        );
      } catch {
        /* ignore */
      }
    }

    const next = await api.updatePrefs(patch);
    setConfig(next);

    // Only reload icons when enabling them; collapse/readme are local UI
    if (patch.show_icons === true) {
      void refreshLists(next, { rediscover: false });
    }
  };

  const onBrowse = async () => {
    cancelCountdown();
    const files = await api.pickToeFiles(tab === "templates");
    if (!files.length) return;
    if (tab === "templates") {
      for (const f of files) await api.addTemplate(f);
      await refreshLists(undefined, { rediscover: false });
      setSelectedPath(files[0]);
    } else {
      setSelectedPath(files[0]);
      setActiveManual(files[0]);
      // warm meta for browsed file without full refresh
      void api.getFileMeta(files[0]).then((m) => {
        setMeta((prev) => ({ ...prev, [files[0]]: { exists: m.exists, mtime: m.mtime } }));
      });
    }
  };

  const onRemove = async (path: string, force = false) => {
    if (tab === "templates") {
      if (path === DEFAULT_TEMPLATE) return;
      await api.removeTemplate(path);
    } else {
      if (!force && config?.confirm_remove_from_list) {
        setRemoveTarget(path);
        setModal("remove");
        return;
      }
      await api.removeRecent(path);
    }
    await refreshLists(undefined, { rediscover: false });
    if (selectedPath === path) setSelectedPath(null);
  };

  const onDownload = async () => {
    if (!selectedPath || selectedPath === DEFAULT_TEMPLATE || !buildInfo) return;
    const display = displayBuildInfo(buildInfo, usePlayer);
    const url = await api.getDownloadUrl(display);
    if (!url) {
      setStatusMsg("Could not build download URL");
      return;
    }
    const sep = platform === "windows" ? "\\" : "/";
    const destPath = `${dirname(selectedPath)}${sep}${basename(url)}`;
    setInstallerPath(destPath);
    setDownloadProgress(0);
    try {
      await api.downloadTd(url, destPath);
      setDownloadProgress(1);
      setModal("install");
    } catch (e) {
      setStatusMsg(String(e));
      setDownloadProgress(null);
    }
  };

  const onInstall = async () => {
    if (!installerPath) return;
    setModal(null);
    await api.openInstaller(installerPath);
    if (buildInfo) {
      if (installPoll.current) clearInterval(installPoll.current);
      const started = Date.now();
      installPoll.current = window.setInterval(async () => {
        if (Date.now() - started > 600_000) {
          if (installPoll.current) clearInterval(installPoll.current);
          return;
        }
        const ok = await api.rediscoverAndCheck(buildInfo, usePlayer);
        if (ok) {
          if (installPoll.current) clearInterval(installPoll.current);
          const d = await api.discoverVersions();
          setDiscover(d);
          setStatusMsg(`${displayBuildInfo(buildInfo, usePlayer)} installed`);
          setDownloadProgress(null);
        }
      }, 3000);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = isMac ? e.metaKey : e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "Escape") {
        if (modal) {
          setModal(null);
          return;
        }
        if (searchOpen || search) {
          setSearch("");
          setSearchOpen(false);
          return;
        }
        if (readmeEdit) {
          setReadmeEdit(false);
          return;
        }
        void api.quitApp();
        return;
      }

      if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }

      if (meta && e.key.toLowerCase() === "e" && config?.show_readme) {
        e.preventDefault();
        setReadmeEdit(true);
        return;
      }

      if (meta && e.key.toLowerCase() === "s" && readmeEdit && selectedPath) {
        e.preventDefault();
        void api.saveReadme(selectedPath, readmeDraft).then((p) => {
          setReadme((r) => ({ ...r, path: p, content: readmeDraft }));
          setReadmeEdit(false);
        });
        return;
      }

      if (typing && !(searchOpen && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter"))) {
        return;
      }

      cancelCountdown();

      if (e.key === "Tab" && !meta) {
        e.preventDefault();
        setTab((t) => (t === "recent" ? "templates" : "recent"));
        return;
      }

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setFocus((f) => (f === "picker" ? "versions" : "picker"));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        void doLaunch(true);
        return;
      }

      if (e.key.toLowerCase() === "v") {
        void updatePref({ collapse_versions: !config?.collapse_versions });
        return;
      }
      if (e.key.toLowerCase() === "c") {
        void updatePref({ show_icons: !config?.show_icons });
        return;
      }
      if (e.key.toLowerCase() === "e" && !meta) {
        void updatePref({ show_readme: !config?.show_readme });
        return;
      }
      if (e.key.toLowerCase() === "r") {
        setUsePlayer((p) => !p);
        return;
      }

      if (e.key.toLowerCase() === "f" && !meta && selectedPath && selectedPath !== DEFAULT_TEMPLATE) {
        e.preventDefault();
        void api.openPath(selectedPath);
        return;
      }

      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const keys = usePlayer ? discover.players : discover.versions;
        const newest = keys[keys.length - 1]?.key;
        if (newest) {
          setSelectedPath(DEFAULT_TEMPLATE);
          setSelectedVersion(newest);
          setTab("templates");
          void api.launchProject(DEFAULT_TEMPLATE, newest, usePlayer, false);
        }
        return;
      }

      if (meta && e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key);
        const item = templateItems[idx - 1];
        if (item && !item.missing) {
          e.preventDefault();
          setTab("templates");
          setSelectedPath(item.path);
          setTimeout(() => void doLaunch(true), 50);
        }
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedPath && selectedPath !== DEFAULT_TEMPLATE) {
        void onRemove(selectedPath);
        return;
      }

      if (meta && (e.key === "ArrowUp" || e.key === "ArrowDown") && tab === "templates" && selectedPath && selectedPath !== DEFAULT_TEMPLATE) {
        e.preventDefault();
        void api.moveTemplate(selectedPath, e.key === "ArrowUp" ? "up" : "down").then(() => refreshLists(undefined, { rediscover: false }));
        return;
      }

      const navUp = e.key === "ArrowUp" || e.key.toLowerCase() === "w";
      const navDown = e.key === "ArrowDown" || e.key.toLowerCase() === "s";
      if (navUp || navDown) {
        e.preventDefault();
        if (focus === "versions") {
          const idx = Math.max(0, versionKeys.indexOf(selectedVersion ?? ""));
          const next = navUp
            ? Math.max(0, idx - 1)
            : Math.min(versionKeys.length - 1, idx + 1);
          setSelectedVersion(versionKeys[next] ?? null);
        } else {
          const visible = items.filter((i) => !i.missing);
          const idx = visible.findIndex((i) => i.path === selectedPath);
          const next = navUp
            ? Math.max(0, (idx < 0 ? 0 : idx) - 1)
            : Math.min(visible.length - 1, (idx < 0 ? -1 : idx) + 1);
          if (visible[next]) setSelectedPath(visible[next].path);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", cancelCountdown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", cancelCountdown);
    };
  });

  if (!ready || !config) {
    return (
      <div className="app">
        <div className="empty">Loading TD Launcher Plus…</div>
      </div>
    );
  }

  const launchLabel = (() => {
    if (countdown !== null && countdown > 0) {
      return `Open with selected version in ${countdown} seconds`;
    }
    if (!selectedPath) return "Select a file to launch";
    if (analyzing) return "Analyzing file…";
    if (selectedPath === DEFAULT_TEMPLATE)
      return `Launch ${usePlayer ? "TouchPlayer" : "TouchDesigner"}`;
    return `Launch ${basename(selectedPath)}`;
  })();

  return (
    <div className="app" onClick={cancelCountdown}>
      <header className="header">
        <div className="brand">
          <h1>TD Launcher Plus</h1>
          <span
            className="byline"
            onClick={() => api.openUrl("https://functionstore.xyz")}
            title="Visit functionstore.xyz"
          >
            by Function Store
          </span>
        </div>
        <div className="header-actions">
          <button className="small" onClick={() => setModal("settings")}>
            Settings
          </button>
          <button className="small" onClick={() => setModal("help")}>
            Help
          </button>
          <button className="small" onClick={() => setModal("about")}>
            About
          </button>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`tab ${tab === "recent" ? "active" : ""}`}
          onClick={() => setTab("recent")}
        >
          Recent Files
        </button>
        <button
          className={`tab ${tab === "templates" ? "active" : ""}`}
          onClick={() => setTab("templates")}
        >
          Templates
        </button>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          {searchOpen || search ? (
            <input
              ref={searchRef}
              type="text"
              placeholder="Search… (* ?)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (!search) setSearchOpen(false);
              }}
            />
          ) : (
            <button className="small" onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}>
              Search…
            </button>
          )}
        </div>
        <button className="small" onClick={() => void onBrowse()}>
          {tab === "templates" ? "Add Templates…" : "Browse…"}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={config.collapse_versions}
            onChange={(e) => void updatePref({ collapse_versions: e.target.checked })}
          />
          Collapse Versions
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.show_icons}
            onChange={(e) => void updatePref({ show_icons: e.target.checked })}
          />
          Show Icons
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={config.show_readme}
            onChange={(e) => void updatePref({ show_readme: e.target.checked })}
          />
          Show Info
        </label>
        <span className="spacer" />
        {tab === "recent" && (
          <button className="small" onClick={() => setModal("clear")}>
            Clear…
          </button>
        )}
      </div>

      <div className="content">
        <div className="left-col">
          <div
            className={`panel file-list ${config.show_icons ? "with-icons" : ""}`}
            style={{ ["--name-ch" as string]: String(nameColCh) }}
          >
            {items.length === 0 ? (
              <div className="empty">No files yet — Browse to add a project.</div>
            ) : (
              items.map((item) => {
                const canRemove =
                  !item.isDefault &&
                  !(item.source === "td" && platform !== "windows");
                return (
                  <div
                    key={item.path}
                    ref={item.path === selectedPath ? selectedFileRef : undefined}
                    className={[
                      "file-row",
                      item.path === selectedPath ? "selected" : "",
                      item.path === selectedPath && focus === "versions" ? "focus-version" : "",
                      item.missing ? "missing" : "",
                      item.source === "active"
                        ? "source-active"
                        : item.source === "td"
                          ? "source-td"
                          : item.source === "launcher"
                            ? "source-launcher"
                            : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => selectItem(item)}
                    onDoubleClick={() => {
                      if (!item.missing) void doLaunch(true);
                    }}
                    title={item.isDefault ? "Launch TD with default startup" : item.path}
                  >
                    {config.show_icons && (
                      icons[item.path] ? (
                        <img className="icon" src={icons[item.path]} alt="" />
                      ) : (
                        <div className="icon placeholder">TD</div>
                      )
                    )}
                    <span className="col-name">
                      {item.displayName}
                      {item.missing ? " (missing)" : ""}
                    </span>
                    <span className="col-actions" onClick={(e) => e.stopPropagation()}>
                      {!item.isDefault && tab === "templates" && (
                        <>
                          <button
                            className="ghost small"
                            title="Move up"
                            onClick={() =>
                              void api
                                .moveTemplate(item.path, "up")
                                .then(() => refreshLists(undefined, { rediscover: false }))
                            }
                          >
                            ▲
                          </button>
                          <button
                            className="ghost small"
                            title="Move down"
                            onClick={() =>
                              void api
                                .moveTemplate(item.path, "down")
                                .then(() => refreshLists(undefined, { rediscover: false }))
                            }
                          >
                            ▼
                          </button>
                        </>
                      )}
                      {canRemove && (
                        <button
                          className="ghost small"
                          title="Remove"
                          onClick={() => void onRemove(item.path)}
                        >
                          ×
                        </button>
                      )}
                    </span>
                    <span className="col-date">
                      {item.isDefault ? "" : item.missing ? "" : item.mtime || ""}
                    </span>
                    <span className="col-path">
                      {item.isDefault
                        ? "Opens TD with default startup"
                        : item.path}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className={`panel version-panel ${usePlayer ? "player" : ""}`}>
            {!selectedPath ? (
              <div className="hint">Select a file above to see version info</div>
            ) : selectedPath === DEFAULT_TEMPLATE ? (
              <>
                <div className="version-header">
                  <span className="req">
                    Launch {usePlayer ? "TouchPlayer" : "TouchDesigner"} with default startup
                  </span>
                  <label className="check">
                    <input type="checkbox" checked={usePlayer} onChange={(e) => setUsePlayer(e.target.checked)} />
                    Use TouchPlayer
                  </label>
                </div>
                <VersionList
                  keys={versionKeys}
                  selected={selectedVersion}
                  focus={focus}
                  onSelect={setSelectedVersion}
                />
              </>
            ) : analyzing ? (
              <div className="hint">Loading build info…</div>
            ) : (
              <>
                <div className="version-header">
                  <div>
                    <div className="file-label">File: {basename(selectedPath)}</div>
                    {buildInfo ? (
                      <div className={`req ${!versionInstalled ? "missing" : ""}`}>
                        Required: {displayBuildInfo(buildInfo, usePlayer)}
                        {!versionInstalled ? " (NOT INSTALLED)" : ""}
                      </div>
                    ) : (
                      <div className="req">Could not detect required TD version — pick manually:</div>
                    )}
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={usePlayer} onChange={(e) => setUsePlayer(e.target.checked)} />
                    Use TouchPlayer
                  </label>
                </div>

                {!versionInstalled && buildInfo && (
                  <div className="download-box">
                    <div>Download {displayBuildInfo(buildInfo, usePlayer)} from Derivative</div>
                    {downloadProgress !== null && (
                      <div className="progress">
                        <span style={{ width: `${Math.round(downloadProgress * 100)}%` }} />
                      </div>
                    )}
                    <button onClick={() => void onDownload()} disabled={downloadProgress !== null && downloadProgress < 1}>
                      {downloadProgress !== null && downloadProgress < 1
                        ? `Downloading ${Math.round(downloadProgress * 100)}%`
                        : "Download"}
                    </button>
                  </div>
                )}

                <VersionList
                  keys={versionKeys}
                  selected={selectedVersion}
                  focus={focus}
                  best={buildInfo}
                  layoutKey={versionInstalled ? "ok" : "missing"}
                  onSelect={setSelectedVersion}
                />
              </>
            )}
          </div>
        </div>

        {config.show_readme && (
          <div className="right-col">
            <div className="readme-header">
              <strong>Project Info</strong>
              {selectedPath && selectedPath !== DEFAULT_TEMPLATE && (
                <button className="small" onClick={() => setReadmeEdit((v) => !v)}>
                  {readmeEdit ? "View" : "Edit"}
                </button>
              )}
            </div>
            <div className="readme-status">
              {!selectedPath || selectedPath === DEFAULT_TEMPLATE
                ? "Select a file…"
                : readme.path
                  ? basename(readme.path)
                  : "No README.md — edit to create one"}
              {readme.summary ? ` — ${plainSummary(readme.summary)}` : ""}
            </div>
            <div
              className={`readme-body ${readmeEdit ? "is-editing" : "is-viewing"}`}
              onDoubleClick={() =>
                selectedPath &&
                selectedPath !== DEFAULT_TEMPLATE &&
                !readmeEdit &&
                setReadmeEdit(true)
              }
            >
              {readmeEdit ? (
                <textarea
                  value={readmeDraft}
                  onChange={(e) => setReadmeDraft(e.target.value)}
                  spellCheck={false}
                />
              ) : readme.content ? (
                <div className="markdown">
                  <ReactMarkdown>{readme.content}</ReactMarkdown>
                </div>
              ) : (
                <span className="hint">Double-click or press Edit to add a README</span>
              )}
            </div>
            <div className="readme-footer">
              <button
                className="small"
                disabled={!readmeEdit || !selectedPath}
                onClick={() => {
                  if (!selectedPath) return;
                  void api.saveReadme(selectedPath, readmeDraft).then((p) => {
                    setReadme((r) => ({ ...r, path: p, content: readmeDraft }));
                    setReadmeEdit(false);
                  });
                }}
              >
                Save
              </button>
              <button
                className="small"
                disabled={!readme.content}
                onClick={() => {
                  void api.writeTempHtml(readme.content).then((p) => api.openUrl(`file:///${p.replace(/\\/g, "/")}`));
                }}
              >
                View
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="footer">
        <button
          className="primary launch"
          disabled={!selectedPath || !selectedVersion || analyzing || (meta[selectedPath ?? ""] && !meta[selectedPath!].exists && selectedPath !== DEFAULT_TEMPLATE)}
          onClick={() => void doLaunch(true)}
        >
          {launchLabel}
        </button>
      </div>

      {statusMsg && (
        <div className="hint" onClick={() => setStatusMsg("")}>
          {statusMsg}
        </div>
      )}

      {modal === "settings" && (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="field">
            <label>Color theme</label>
            <select
              value={config.theme || "classic"}
              onChange={(e) => void updatePref({ theme: e.target.value })}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Max recent files (5–200)</label>
            <input
              type="number"
              min={5}
              max={200}
              value={maxRecentDraft}
              onChange={(e) => setMaxRecentDraft(Number(e.target.value))}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={config.confirm_remove_from_list}
              onChange={(e) => void updatePref({ confirm_remove_from_list: e.target.checked })}
            />
            Confirm before removing from list
          </label>
          <div className="actions">
            <button
              onClick={async () => {
                const n = await api.clearMissing();
                await refreshLists(undefined, { rediscover: false });
                setStatusMsg(`Removed ${n} missing entries`);
              }}
            >
              Clear Missing Files
            </button>
            <button
              className="primary"
              onClick={async () => {
                await updatePref({ max_recent_files: maxRecentDraft });
                setModal(null);
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {modal === "help" && (
        <Modal title="Help" onClose={() => setModal(null)} wide>
          <h3 className="help-section">Keyboard Shortcuts</h3>
          <table className="help-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  cat: "Navigation",
                  bindings: [
                    ["Tab", "Switch tabs (Recent / Templates)"],
                    ["Up / W", "Select previous file"],
                    ["Down / S", "Select next file"],
                    ["Space", "Toggle focus: File List / Versions"],
                    ["Enter", "Launch selected project"],
                    ["Esc", "Quit"],
                  ],
                },
                {
                  cat: "Search",
                  bindings: [
                    [`${mod}+F`, "Open / close search"],
                    ["* / ?", "Wildcards (* any, ? one char)"],
                    ["Esc", "Clear search and close"],
                    ["Enter", "Close search (keep filter)"],
                    ["Up / Down", "Navigate filtered list"],
                  ],
                },
                {
                  cat: "Interface",
                  bindings: [
                    ["V", "Toggle collapse versions"],
                    ["C", "Toggle icons"],
                    ["R", "Toggle TouchPlayer"],
                    ["F", "Open file's folder"],
                    ["E", "Toggle info panel"],
                    [`${mod}+E`, "Edit README"],
                  ],
                },
                {
                  cat: "File Management",
                  bindings: [
                    ["Del / Backspace", "Remove selected file"],
                    [`${mod}+Up/Down`, "Reorder templates"],
                    [`${mod}+S`, "Save README"],
                  ],
                },
                {
                  cat: "Quick Launch",
                  bindings: [
                    [`${mod}+D`, "Launch TD (default startup)"],
                    [`${mod}+1–9`, "Launch template by position"],
                  ],
                },
              ].flatMap(({ cat, bindings }) => [
                <tr key={`cat-${cat}`} className="help-cat">
                  <td colSpan={2}>{cat}</td>
                </tr>,
                ...bindings.map(([key, action]) => (
                  <tr key={`${cat}-${key}`}>
                    <td>
                      <span className="kbd">{key}</span>
                    </td>
                    <td>{action}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>

          <p className="help-tip">
            {isMac
              ? "On macOS, the companion utility TOX is needed to sync recent files from TouchDesigner."
              : "Recent files are read directly from the Windows Registry — no setup needed."}
          </p>
          <p className="help-tip">
            Use the TouchPlayer checkbox in the version panel to launch projects in TouchPlayer instead.
          </p>

          <h3 className="help-section">
            Companion Utility TOX {isMac ? "(recommended)" : "(optional)"}
          </h3>
          <p className="help-tip">
            {isMac
              ? "Syncs recent files from TouchDesigner and auto-generates project icons from /perform."
              : "Auto-generates project icons from /perform when you save. Not needed for recent files."}
          </p>
          <p className="help-tip">
            Download{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => void api.openUrl(UTILITY_TOX_URL)}
            >
              TDLauncherPlusUtility.tox
            </button>{" "}
            from Releases and add it to your default startup file.
          </p>

          <div className="actions">
            <button onClick={() => void api.openUrl(UTILITY_TOX_URL)}>
              Download Utility TOX
            </button>
            <button className="primary" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {modal === "about" && (
        <Modal title="About" onClose={() => setModal(null)}>
          <p>
            <strong>TD Launcher Plus</strong> v{version}
          </p>
          <p>
            A project dashboard for TouchDesigner — launch .toe files with the correct build,
            browse recents & templates, edit README docs.
          </p>
          <p>
            Based on TD Launcher by EnviralDesign. Maintained by Function Store.
          </p>
          <div className="actions">
            <button onClick={() => api.openUrl("https://github.com/function-store/TD-Launcher-Plus")}>
              GitHub
            </button>
            <button onClick={() => api.openUrl("https://github.com/function-store/TD-Launcher-Plus/releases")}>
              Updates
            </button>
            <button className="primary" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {modal === "firstrun" && (
        <Modal title="Welcome" onClose={() => { void updatePref({ has_prompted_file_assoc: true }); setModal(null); }}>
          <p>
            Set <strong>TD Launcher Plus</strong> as the default app for <code>.toe</code> files so
            double-clicking projects opens the launcher with auto-version detection.
          </p>
          {isMac ? (
            <p>
              Right-click any <code>.toe</code> → Get Info → Open with → TD Launcher Plus → Change
              All…
            </p>
          ) : (
            <p>
              Windows file association is registered with the installer. You can also right-click a{" "}
              <code>.toe</code> → Open with → Choose another app.
            </p>
          )}
          <p>
            Optional: add{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => void api.openUrl(UTILITY_TOX_URL)}
            >
              TDLauncherPlusUtility.tox
            </button>{" "}
            to your startup file for icons
            {isMac ? " and recent-file sync" : ""}.
          </p>
          <div className="actions">
            <button
              className="primary"
              onClick={() => {
                void updatePref({ has_prompted_file_assoc: true });
                setModal(null);
              }}
            >
              Got it
            </button>
          </div>
        </Modal>
      )}

      {modal === "clear" && (
        <Modal title="Clear Recent Files" onClose={() => setModal(null)}>
          <p>
            Clear all Recent Files history? This removes launcher-opened and synced TouchDesigner
            history from the list (not your files on disk).
          </p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button
              className="primary"
              onClick={async () => {
                await api.clearRecents();
                await refreshLists(undefined, { rediscover: false });
                setSelectedPath(null);
                setModal(null);
              }}
            >
              Clear History
            </button>
          </div>
        </Modal>
      )}

      {modal === "remove" && removeTarget && (
        <Modal title="Remove from List" onClose={() => setModal(null)}>
          <p>
            Remove <strong>{basename(removeTarget)}</strong> from this list? This only removes it
            from TD Launcher Plus, not from your file system.
          </p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button
              onClick={async () => {
                await updatePref({ confirm_remove_from_list: false });
                await onRemove(removeTarget, true);
                setModal(null);
              }}
            >
              Remove &amp; Don&apos;t Ask
            </button>
            <button
              className="primary"
              onClick={async () => {
                await onRemove(removeTarget, true);
                setModal(null);
              }}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}

      {modal === "install" && (
        <Modal title="Download Complete" onClose={() => setModal(null)}>
          <p>Ready to install {displayBuildInfo(buildInfo, usePlayer)}</p>
          <p className="hint">{installerPath && basename(installerPath)}</p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Later</button>
            <button className="primary" onClick={() => void onInstall()}>
              Install
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function scrollSelectedIntoList(el: HTMLElement) {
  const parent = el.parentElement;
  if (!parent) return;
  const pRect = parent.getBoundingClientRect();
  const cRect = el.getBoundingClientRect();
  if (cRect.top < pRect.top) {
    parent.scrollTop -= pRect.top - cRect.top;
  } else if (cRect.bottom > pRect.bottom) {
    parent.scrollTop += cRect.bottom - pRect.bottom;
  }
}

function VersionList({
  keys,
  selected,
  focus,
  best,
  layoutKey,
  onSelect,
}: {
  keys: string[];
  selected: string | null;
  focus: FocusArea;
  best?: string | null;
  /** Changes when download box appears/disappears so we re-scroll after layout. */
  layoutKey?: string;
  onSelect: (k: string) => void;
}) {
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!selected || !selectedRef.current) return;
    const el = selectedRef.current;
    scrollSelectedIntoList(el);
    // Download box / flex height can settle a frame later
    const id = requestAnimationFrame(() => scrollSelectedIntoList(el));
    return () => cancelAnimationFrame(id);
  }, [selected, keys, focus, layoutKey]);

  if (!keys.length) return <div className="hint">No versions found!</div>;
  const bestNum = best?.replace(/^Touch(Designer|Player)\./, "");
  return (
    <div className="version-list">
      {keys.map((k) => {
        const num = k.replace(/^Touch(Designer|Player)\./, "");
        const isSelected = k === selected;
        return (
          <div
            key={k}
            ref={isSelected ? selectedRef : undefined}
            className={[
              "version-item",
              isSelected ? "selected" : "",
              isSelected && focus === "versions" ? "focus-version" : "",
              bestNum && num === bestNum ? "best" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelect(k)}
          >
            {k}
          </div>
        );
      })}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
