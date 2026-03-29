/**
 * HTML Shell — server-renders the full page via @kitajs/html JSX.
 *
 * Static HTML: sidebar, header, settings panel, CSS.
 * Dynamic (client JS): canvas backgrounds + text layer in #app.
 */
import type { DiffData, FileDiffData } from "../serialize/types.js";
import { darkTheme, solarTheme } from "./theme.js";
import type { CanvasTheme } from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getFilename(path: string): string {
  if (path.includes(" → ")) {
    const [oldPath, newPath] = path.split(" → ");
    const oldName = oldPath.split("/").pop() || oldPath;
    const newName = newPath.split("/").pop() || newPath;
    return oldName === newName ? newName : `${oldName} → ${newName}`;
  }
  return path.split("/").pop() || path;
}

function getDirectory(path: string): string {
  const effectivePath = path.includes(" → ") ? path.split(" → ")[1] : path;
  const parts = effectivePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

interface FileGroup {
  dir: string;
  files: Array<{ file: FileDiffData; idx: number }>;
}

function groupByDirectory(files: FileDiffData[]): FileGroup[] {
  const byDir = new Map<string, Array<{ file: FileDiffData; idx: number }>>();
  files.forEach((file, idx) => {
    const dir = getDirectory(file.path);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push({ file, idx });
  });
  return [...byDir.keys()].sort().map((dir) => ({ dir, files: byDir.get(dir)! }));
}

// ─── Components ─────────────────────────────────────────────────────────────

function FileStats({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null;
  return (
    <span class="file-stats">
      {added ? <span class="stat-added">+{added}</span> : null}
      {removed ? <span class="stat-removed">-{removed}</span> : null}
    </span>
  );
}

function FileSidebar({ files }: { files: FileDiffData[] }) {
  const groups = groupByDirectory(files);
  return (
    <aside id="fileSidebar" class="file-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Files</span>
        <span class="file-count">{files.length}</span>
      </div>
      <ul class="file-list" id="fileList">
        {groups.map((group) => (
          <>
            {group.dir && (
              <li class="dir-header">
                <span class="dir-name">{group.dir}/</span>
              </li>
            )}
            {group.files.map(({ file, idx }) => (
              <li
                class={`file-item${idx === 0 ? " active" : ""}${group.dir ? " indented" : ""}`}
                data-file-idx={String(idx)}
                data-full-path={file.path}
                tabindex="0"
              >
                <span class="file-name">{getFilename(file.path)}</span>
                <FileStats added={file.added} removed={file.removed} />
              </li>
            ))}
          </>
        ))}
      </ul>
      <div class="sidebar-resize" id="sidebarResize"></div>
    </aside>
  );
}

function Header({ leftTitle, rightTitle }: { leftTitle: string; rightTitle: string }) {
  return (
    <header id="header">
      <div class="header-cell left-header">{leftTitle}</div>
      <div class="header-cell right-header">
        {rightTitle}
        <div class="header-controls">
          <button class="settings-toggle" id="settingsToggle" title="Settings" aria-label="Open settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>
          </button>
          <button class="theme-toggle" id="themeToggle" title="Switch theme" aria-label="Switch theme" />
        </div>
      </div>
    </header>
  );
}

function FilePathDisplay({ path }: { path: string }) {
  return (
    <div class="file-path-display" id="filePathDisplay">
      <span class="current-file-path">{path}</span>
    </div>
  );
}

function SettingsPanel() {
  return (
    <div class="settings-panel" id="settingsPanel">
      <div class="settings-header">
        <h3>Settings</h3>
        <button class="settings-close" id="settingsClose" aria-label="Close settings">×</button>
      </div>
      <div class="settings-content">
        <section class="settings-section">
          <h4>Display</h4>
          <div class="setting-row">
            <label for="themeSelect">Theme</label>
            <select id="themeSelect">
              <option value="dark">Dark</option>
              <option value="solar">Solar (Light)</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="fontSizeRange">Font Size</label>
            <div class="range-with-value">
              <input type="range" id="fontSizeRange" min="12" max="20" step="1" />
              <span id="fontSizeValue">14px</span>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <h4>Diff Display</h4>
          <div class="setting-row">
            <label for="matchLevelSelect">Matching Sensitivity</label>
            <select id="matchLevelSelect">
              <option value="strict">Strict</option>
              <option value="normal" selected>Normal</option>
              <option value="loose">Loose</option>
            </select>
          </div>
        </section>
        <section class="settings-section">
          <h4>Keyboard Shortcuts</h4>
          <div class="shortcuts-list">
            <div class="shortcut-item"><kbd>↑</kbd> / <kbd>k</kbd> Previous file</div>
            <div class="shortcut-item"><kbd>↓</kbd> / <kbd>j</kbd> Next file</div>
            <div class="shortcut-item"><kbd>t</kbd> Toggle theme</div>
            <div class="shortcut-item"><kbd>⌘⇧X</kbd> Copy with context</div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────

function themeVars(t: CanvasTheme): string {
  return [
    `--bg:${t.bg}`, `--bg-alt:${t.paneBg}`, `--text:${t.textColor}`, `--text-muted:${t.mutedText}`,
    `--border:${t.border}`, `--link:${t.linkColor}`,
    `--added-border:${t.addedBorder}`, `--removed-border:${t.removedBorder}`,
    `--scroll-track:${t.bg}`, `--scroll-thumb:${t.scrollThumb}`,
  ].join(";");
}

function cssText(): string {
  return `
  [data-theme="dark"] { ${themeVars(darkTheme)} }
  [data-theme="solar"] { ${themeVars(solarTheme)} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
    display: flex; flex-direction: row; height: 100vh;
  }
  .main-content { flex:1; display:flex; flex-direction:column; min-width:0; height:100vh; margin-right:80px; }

  /* Header */
  header { display:flex; border-bottom:1px solid var(--border); flex-shrink:0; }
  .header-cell { padding:10px 20px; font-size:13px; flex:1; display:flex; align-items:center; }
  .left-header { border-right:1px solid var(--border); direction:rtl; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .right-header { justify-content:space-between; overflow:hidden; }
  .header-controls { display:flex; gap:6px; flex-shrink:0; }
  .header-controls button { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:4px; }
  .header-controls button:hover { background:var(--border); color:var(--text); }

  /* Diff viewport */
  #app { position:relative; flex:1; overflow-y:auto; overflow-x:hidden; }
  #canvas { position:absolute; top:0; left:0; pointer-events:none; }
  #text { position:absolute; top:0; left:0; right:0; user-select:text; }

  /* File sidebar */
  .file-sidebar {
    width:var(--sidebar-width,200px); min-width:120px; max-width:400px;
    background:var(--bg-alt); border-right:1px solid var(--border);
    display:flex; flex-direction:column; flex-shrink:0; position:relative; height:100vh;
  }
  .sidebar-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 12px; border-bottom:1px solid var(--border);
    font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted);
  }
  .file-count { background:var(--border); padding:2px 6px; border-radius:10px; font-size:11px; }
  .file-list { list-style:none; margin:0; padding:4px 0; overflow-y:auto; flex:1; }
  .dir-header { padding:8px 12px 4px; font-size:11px; font-weight:600; color:var(--text-muted); }
  .dir-header:not(:first-child) { margin-top:8px; border-top:1px solid var(--border); padding-top:12px; }
  .dir-name { opacity:0.8; }
  .file-item { padding:6px 12px; cursor:pointer; font-size:12px; border-left:3px solid transparent; outline:none; display:flex; align-items:center; gap:8px; }
  .file-item.indented { padding-left:20px; }
  .file-item:hover, .file-item:focus { background:var(--bg); }
  .file-item.active { background:var(--bg); border-left-color:var(--link); }
  .file-item.active .file-name { color:var(--link); }
  .file-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .file-stats { flex-shrink:0; display:flex; gap:6px; font-size:11px; }
  .stat-added { color:var(--added-border); }
  .stat-removed { color:var(--removed-border); }
  .sidebar-resize { position:absolute; top:0; right:-3px; width:6px; height:100%; cursor:col-resize; z-index:10; }
  .sidebar-resize:hover, .sidebar-resize.dragging { background:var(--link); opacity:0.5; }
  .file-path-display { padding:8px 20px; background:var(--bg-alt); border-bottom:1px solid var(--border); font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; }

  /* Minimap */
  #minimap { position:fixed; right:0; top:0; bottom:0; width:80px; }

  /* Settings panel */
  .settings-panel { position:fixed; right:80px; top:0; bottom:0; width:300px; background:var(--bg-alt); border-left:1px solid var(--border); z-index:20; display:none; overflow-y:auto; }
  .settings-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); }
  .settings-header h3 { font-size:14px; font-weight:600; }
  .settings-close { background:none; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:4px; }
  .settings-content { padding:16px; }
  .settings-section { margin-bottom:20px; }
  .settings-section h4 { font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px; }
  .setting-row { display:flex; align-items:center; justify-content:space-between; padding:6px 0; font-size:13px; }
  .setting-row label { flex:1; }
  .setting-row select, .setting-row input[type="range"] { max-width:140px; }
  .range-with-value { display:flex; align-items:center; gap:8px; }
  .shortcuts-list { font-size:12px; color:var(--text-muted); }
  .shortcut-item { padding:3px 0; }
  kbd { background:var(--border); padding:1px 5px; border-radius:3px; font-size:11px; }

  /* Scrollbar */
  ::-webkit-scrollbar { width:8px; height:8px; }
  ::-webkit-scrollbar-track { background:var(--scroll-track); }
  ::-webkit-scrollbar-thumb { background:var(--scroll-thumb); border-radius:4px; }
  `;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function generateCanvasHtml(data: DiffData, bundledClientJs: string): string {
  const theme = data.settings.theme ?? "dark";
  const isMulti = data.files.length > 1;
  const { leftTitle, rightTitle } = data.meta;

  const page = (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title safe>{"md-diff: " + leftTitle + " ↔ " + rightTitle}</title>
        <style>{cssText() as "safe"}</style>
      </head>
      <body>
        {isMulti && <FileSidebar files={data.files} />}
        <div class="main-content">
          <Header leftTitle={leftTitle} rightTitle={rightTitle} />
          {isMulti && <FilePathDisplay path={data.files[0]?.path || ""} />}
          <div id="app">
            <canvas id="canvas"></canvas>
            <div id="text"></div>
          </div>
        </div>
        <canvas id="minimap"></canvas>
        <SettingsPanel />
        <script id="diff-data" type="application/json">{JSON.stringify(data).replace(/</g, "\\u003c") as "safe"}</script>
        <script>{bundledClientJs as "safe"}</script>
      </body>
    </html>
  );

  return "<!DOCTYPE html>" + page;
}
