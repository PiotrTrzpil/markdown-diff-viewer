import type { RenderedRow } from "../render/render.js";
import { themes, themeVars, type ThemeName } from "./themes.js";

export interface FileDiff {
  path: string;
  rows: RenderedRow[];
  /** Lines added (from git) */
  added?: number;
  /** Lines removed (from git) */
  removed?: number;
}

// ── Components ─────────────────────────────────────────────────

/** Extract filename from path (handles rename format "old → new") */
function getFilename(path: string): string {
  if (path.includes(" → ")) {
    const [oldPath, newPath] = path.split(" → ");
    const oldName = oldPath.split("/").pop() || oldPath;
    const newName = newPath.split("/").pop() || newPath;
    return oldName === newName ? newName : `${oldName} → ${newName}`;
  }
  return path.split("/").pop() || path;
}

/** Get directory from path (handles rename format) */
function getDirectory(path: string): string {
  // For renames, use the new path's directory
  const effectivePath = path.includes(" → ") ? path.split(" → ")[1] : path;
  const parts = effectivePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

/** Group files by directory with collapsed single-child paths */
interface FileGroup {
  dir: string;       // Display directory (collapsed)
  files: Array<{ file: FileDiff; idx: number }>;
}

function groupFilesByDirectory(files: FileDiff[]): FileGroup[] {
  // Group by directory
  const byDir = new Map<string, Array<{ file: FileDiff; idx: number }>>();

  files.forEach((file, idx) => {
    const dir = getDirectory(file.path);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push({ file, idx });
  });

  // Convert to array and sort by directory
  const groups: FileGroup[] = [];
  const sortedDirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b));

  for (const dir of sortedDirs) {
    groups.push({ dir, files: byDir.get(dir)! });
  }

  return groups;
}

function FileStats({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null;
  return (
    <span class="file-stats">
      {added ? <span class="stat-added">+{added}</span> : null}
      {removed ? <span class="stat-removed">-{removed}</span> : null}
    </span>
  );
}

function FileSidebar({ files }: { files: FileDiff[] }) {
  const groups = groupFilesByDirectory(files);

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

function FilePathDisplay({ files }: { files: FileDiff[] }) {
  return (
    <div class="file-path-display" id="filePathDisplay">
      <span class="current-file-path">{files[0]?.path || ""}</span>
    </div>
  );
}

function _DiffBlock({ row }: { row: RenderedRow }) {
  return <div class={`diff-block ${row.status}`}>{row.leftHtml as "safe"}</div>;
}

function DiffPane({
  rows,
  side,
  idx,
}: {
  rows: RenderedRow[];
  side: "left" | "right";
  idx: number;
}) {
  return (
    <div class={`diff-pane ${side}-pane`} data-left={side === "left" ? String(idx) : undefined} data-right={side === "right" ? String(idx) : undefined}>
      {rows.map((r) => (
        <div
          class={`diff-block ${r.status}`}
          data-line-left={r.leftLine ? String(r.leftLine) : undefined}
          data-line-right={r.rightLine ? String(r.rightLine) : undefined}
        >
          {(side === "left" ? r.leftHtml : r.rightHtml) as "safe"}
        </div>
      ))}
    </div>
  );
}

function FileDiffView({ file, idx }: { file: FileDiff; idx: number }) {
  return (
    <div
      class="file-diff"
      data-file-idx={String(idx)}
      style={idx > 0 ? "display:none" : undefined}
    >
      <div class="diff-container">
        <DiffPane rows={file.rows} side="left" idx={idx} />
        <DiffPane rows={file.rows} side="right" idx={idx} />
      </div>
    </div>
  );
}

function Header({
  leftTitle,
  rightTitle,
}: {
  leftTitle: string;
  rightTitle: string;
}) {
  return (
    <header>
      <div class="header-cell left-header">{leftTitle}</div>
      <div class="header-cell right-header">
        {rightTitle}
        <div class="header-controls">
          <button
            class="settings-toggle"
            id="settingsToggle"
            title="Settings"
            aria-label="Open settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>
          </button>
          <button
            class="theme-toggle"
            id="themeToggle"
            title="Switch theme"
            aria-label="Switch theme"
          />
        </div>
      </div>
    </header>
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
          <div class="setting-row">
            <label for="showMinimapCheck">Show Minimap</label>
            <input type="checkbox" id="showMinimapCheck" checked />
          </div>
        </section>

        <section class="settings-section">
          <h4>Diff Display</h4>
          <div class="setting-row">
            <label for="gapAlignCheck">Align Paragraphs</label>
            <input type="checkbox" id="gapAlignCheck" checked />
          </div>
          <div class="setting-row">
            <label for="showMinorCheck">Highlight Inline Changes</label>
            <input type="checkbox" id="showMinorCheck" checked />
          </div>
          <div class="setting-row">
            <label for="mergeMinorSelect">Merge Minor Changes</label>
            <select id="mergeMinorSelect">
              <option value="off">Off</option>
              <option value="conservative" selected>Conservative</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
          <div class="setting-row">
            <label for="compactModeCheck">Compact Mode</label>
            <input type="checkbox" id="compactModeCheck" />
          </div>
        </section>

        <section class="settings-section">
          <h4>Keyboard Shortcuts</h4>
          <div class="shortcuts-list">
            <div class="shortcut-item"><kbd>↑</kbd> / <kbd>k</kbd> Previous file</div>
            <div class="shortcut-item"><kbd>↓</kbd> / <kbd>j</kbd> Next file</div>
            <div class="shortcut-item"><kbd>⌘⇧C</kbd> Copy with context</div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Public API ──────────────────────────────────────────────────

export function generateHtml(
  rows: RenderedRow[],
  leftTitle: string,
  rightTitle: string,
  theme: ThemeName = "dark",
): string {
  return generateMultiFileHtml(
    [{ path: "single", rows }],
    leftTitle,
    rightTitle,
    theme,
  );
}

export function generateMultiFileHtml(
  files: FileDiff[],
  leftTitle: string,
  rightTitle: string,
  theme: ThemeName = "dark",
): string {
  const darkVars = themeVars(themes.dark);
  const solarVars = themeVars(themes.solar);
  const isMulti = files.length > 1;

  const page = (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title safe>{"Markdown Diff: " + leftTitle + " ↔ " + rightTitle}</title>
        <link
          rel="stylesheet"
          href="https://unpkg.com/open-props/open-props.min.css"
        />
        <style>{cssText(darkVars, solarVars) as "safe"}</style>
      </head>
      <body class={isMulti ? "multi-file" : ""}>
        {isMulti && <FileSidebar files={files} />}
        <div class="main-content">
          <Header leftTitle={leftTitle} rightTitle={rightTitle} />
          {isMulti && <FilePathDisplay files={files} />}
          {files.map((f, i) => (
            <FileDiffView file={f} idx={i} />
          ))}
          <div class="stats-bar" id="statsBar" />
        </div>
        <div id="minimap">
          <canvas id="minimapCanvas"></canvas>
          <div id="minimapViewport"></div>
        </div>
        <SettingsPanel />
        <div class="settings-overlay" id="settingsOverlay"></div>
        <script>{SCRIPT as "safe"}</script>
      </body>
    </html>
  );

  return "<!DOCTYPE html>" + page;
}

// ── CSS ─────────────────────────────────────────────────────────

function cssText(darkVars: string, solarVars: string): string {
  return `
  [data-theme="dark"] { ${darkVars} }
  [data-theme="solar"] { ${solarVars} }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    background: var(--md-bg);
    color: var(--md-text);
    display: flex;
    flex-direction: row;
    height: 100vh;
    transition: background 0.3s ease, color 0.3s ease;
  }

  body.multi-file {
    --sidebar-width: 200px;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100vh;
  }

  /* File sidebar */
  .file-sidebar {
    width: var(--sidebar-width, 200px);
    min-width: 120px;
    max-width: 400px;
    background: var(--md-bg-alt);
    border-right: 1px solid var(--md-border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    position: relative;
    height: 100vh;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--md-border);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-text-muted);
  }

  .sidebar-header .file-count {
    background: var(--md-border);
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 11px;
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }

  .dir-header {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--md-text-muted);
    text-transform: none;
    letter-spacing: 0;
  }

  .dir-header:not(:first-child) {
    margin-top: 8px;
    border-top: 1px solid var(--md-border);
    padding-top: 12px;
  }

  .dir-name {
    opacity: 0.8;
  }

  .file-item.indented {
    padding-left: 20px;
  }

  .file-item {
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    border-left: 3px solid transparent;
    transition: background 0.1s ease, border-color 0.1s ease;
    outline: none;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .file-item:hover {
    background: var(--md-bg);
  }

  .file-item:focus {
    background: var(--md-bg);
  }

  .file-item.active {
    background: var(--md-bg);
    border-left-color: var(--md-link);
  }

  .file-item.active .file-name {
    color: var(--md-link);
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-stats {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    font-size: 11px;
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
  }

  .file-stats .stat-added {
    color: var(--md-added-border);
  }

  .file-stats .stat-removed {
    color: var(--md-removed-border);
  }

  /* Sidebar resize handle */
  .sidebar-resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
  }

  .sidebar-resize:hover,
  .sidebar-resize.dragging {
    background: var(--md-link);
    opacity: 0.5;
  }

  /* File path display (replaces dropdown) */
  .file-path-display {
    padding: 8px 20px;
    background: var(--md-bg-alt);
    border-bottom: 1px solid var(--md-border);
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 13px;
    color: var(--md-text);
    flex-shrink: 0;
  }

  .current-file-path {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header {
    display: flex;
    border-bottom: 2px solid var(--md-border);
    background: var(--md-bg-alt);
    flex-shrink: 0;
  }

  .header-cell {
    flex: 1;
    padding: 10px 20px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--md-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .left-header { border-right: 1px solid var(--md-border); }

  .right-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .file-diff {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .file-diff .diff-container { flex: 1; }

  .theme-toggle {
    background: none;
    border: 1px solid var(--md-border);
    border-radius: var(--radius-round, 50%);
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s ease;
    flex-shrink: 0;
  }

  .theme-toggle:hover { border-color: var(--md-text-muted); }

  [data-theme="dark"] .theme-toggle::after { content: "\\1F319"; }
  [data-theme="solar"] .theme-toggle::after { content: "\\2600"; }

  .settings-toggle {
    background: none;
    border: 1px solid var(--md-border);
    border-radius: var(--radius-round, 50%);
    width: 28px;
    height: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s ease;
    flex-shrink: 0;
    color: var(--md-text-muted);
  }
  .settings-toggle:hover {
    border-color: var(--md-text-muted);
    color: var(--md-text);
  }
  .settings-toggle svg { pointer-events: none; }

  /* Settings Panel */
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 1999;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  .settings-overlay.open {
    opacity: 1;
    visibility: visible;
  }

  .settings-panel {
    position: fixed;
    top: 0;
    right: -320px;
    width: 320px;
    height: 100vh;
    background: var(--md-bg);
    border-left: 1px solid var(--md-border);
    z-index: 2000;
    display: flex;
    flex-direction: column;
    transition: right 0.25s ease;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
  }
  .settings-panel.open { right: 0; }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--md-border);
    flex-shrink: 0;
  }
  .settings-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--md-text);
  }
  .settings-close {
    background: none;
    border: none;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    color: var(--md-text-muted);
    padding: 0 4px;
  }
  .settings-close:hover { color: var(--md-text); }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .settings-section {
    margin-bottom: 24px;
  }
  .settings-section h4 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-text-muted);
    margin: 0 0 12px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--md-border);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    gap: 12px;
  }
  .setting-row label {
    font-size: 13px;
    color: var(--md-text);
    flex-shrink: 0;
  }
  .setting-row select {
    background: var(--md-bg-alt);
    border: 1px solid var(--md-border);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--md-text);
    cursor: pointer;
  }
  .setting-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
    accent-color: var(--md-link);
  }
  .setting-row input[type="range"] {
    flex: 1;
    accent-color: var(--md-link);
  }

  .range-with-value {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    max-width: 140px;
  }
  .range-with-value span {
    font-size: 12px;
    color: var(--md-text-muted);
    min-width: 32px;
    text-align: right;
  }

  .shortcuts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .shortcut-item {
    font-size: 12px;
    color: var(--md-text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .shortcut-item kbd {
    background: var(--md-bg-alt);
    border: 1px solid var(--md-border);
    border-radius: 3px;
    padding: 2px 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--md-text);
  }

  /* Compact mode */
  [data-compact="on"] .diff-pane {
    padding: var(--size-2, 8px) var(--size-3, 16px);
    line-height: 1.5;
  }
  [data-compact="on"] .diff-block { margin: 0; }

  /* Hide minor changes styling when disabled */
  [data-show-minor="off"] del,
  [data-show-minor="off"] ins {
    background: none;
    color: inherit;
    text-decoration: none;
    padding: 0;
  }
  [data-show-minor="off"] .char-removed,
  [data-show-minor="off"] .char-added,
  [data-show-minor="off"] .char-removed.minor,
  [data-show-minor="off"] .char-added.minor {
    background: none;
    color: inherit;
    border: none;
  }

  /* Merge minor changes - hide absorbable parts based on level */
  /* Off: show all parts separately (default rendering) */
  /* Conservative: hide stop-word absorbable parts */
  [data-merge-minor="conservative"] .absorbable-stopword,
  [data-merge-minor="aggressive"] .absorbable-stopword {
    display: none;
  }
  /* Aggressive: also hide single-word absorbable parts */
  [data-merge-minor="aggressive"] .absorbable-single {
    display: none;
  }

  /* Hide minimap */
  [data-show-minimap="off"] #minimap { display: none; }
  [data-show-minimap="off"] .main-content { padding-right: 0; }

  .diff-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .diff-pane {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--size-3, 16px) var(--size-5, 24px);
    line-height: var(--font-lineheight-4, 1.7);
  }

  .left-pane { border-right: 1px solid var(--md-border); }

  .diff-pane h1 { font-size: var(--font-size-5, 1.8em); margin: 0.6em 0 0.3em; color: var(--md-h1); border-bottom: 1px solid var(--md-border); padding-bottom: 0.2em; }
  .diff-pane h2 { font-size: var(--font-size-4, 1.5em); margin: 0.5em 0 0.3em; color: var(--md-h2); }
  .diff-pane h3 { font-size: var(--font-size-3, 1.25em); margin: 0.4em 0 0.2em; color: var(--md-h3); }
  .diff-pane h4 { font-size: var(--font-size-2, 1.1em); margin: 0.3em 0 0.2em; color: var(--md-h4); }
  .diff-pane h5, .diff-pane h6 { font-size: var(--font-size-1, 1em); margin: 0.2em 0; color: var(--md-h5); }
  .diff-pane p { margin: 0.5em 0; }
  .diff-pane ul, .diff-pane ol { margin: 0.5em 0 0.5em 1.5em; }
  .diff-pane li { margin: 0.2em 0; }
  .diff-pane blockquote { border-left: 3px solid var(--md-blockquote-border); padding-left: 12px; color: var(--md-blockquote-text); margin: 0.5em 0; }
  .diff-pane pre { background: var(--md-code-block-bg); padding: var(--size-2, 12px); border-radius: var(--radius-2, 6px); overflow-x: auto; margin: 0.5em 0; }
  .diff-pane code { font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace); font-size: 0.9em; }
  .diff-pane :not(pre) > code { background: var(--md-code-bg); padding: 2px 5px; border-radius: var(--radius-1, 3px); }
  .diff-pane a { color: var(--md-link); text-decoration: underline; }
  .diff-pane strong { color: inherit; }
  .diff-pane em { color: inherit; }
  .diff-pane table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
  .diff-pane th, .diff-pane td { border: 1px solid var(--md-border); padding: 6px 10px; text-align: left; }
  .diff-pane th { background: var(--md-table-header-bg); }
  .diff-pane hr { border: none; border-top: 1px solid var(--md-border); margin: 1em 0; }
  .diff-pane img { max-width: 100%; }

  /* HTML comments - visible but muted */
  .diff-pane .html-comment {
    color: var(--md-comment-text, #6b7280);
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 0.85em;
    opacity: 0.6;
    white-space: pre-wrap;
    margin: 0.5em 0;
  }

  .diff-block {
    padding: 2px 0;
    border-radius: var(--radius-1, 4px);
    margin: 1px 0;
  }

  .diff-block.equal { }

  .diff-block.added {
    background: var(--md-added-bg);
    border-left: 3px solid var(--md-added-border);
    padding-left: 8px;
  }

  .diff-block.removed {
    background: var(--md-removed-bg);
    border-left: 3px solid var(--md-removed-border);
    padding-left: 8px;
  }

  .diff-block.modified {
    background: var(--md-modified-bg);
    border-left: 3px solid var(--md-modified-border);
    padding-left: 8px;
  }

  .spacer {
    min-height: 2em;
    background: var(--md-spacer-bg);
    border-radius: var(--radius-1, 4px);
    margin: 2px 0;
  }

  del {
    background: var(--md-del-bg);
    color: var(--md-del-text);
    text-decoration: line-through 1px;
    text-decoration-color: color-mix(in srgb, var(--md-del-text) 45%, transparent);
    border-radius: 2px;
    padding: 0 2px;
  }

  ins {
    background: var(--md-ins-bg);
    color: var(--md-ins-text);
    text-decoration: none;
    border-radius: 2px;
    padding: 0 2px;
  }

  .char-removed {
    background: none;
    color: var(--md-char-removed-text);
    border-bottom: 2px solid var(--md-char-removed-text);
  }

  .char-added {
    background: none;
    color: var(--md-char-added-text);
    border-bottom: 2px solid var(--md-char-added-text);
  }

  .char-removed.minor {
    background: none;
    color: var(--md-char-removed-minor-text);
    border-bottom: 1.5px solid var(--md-char-removed-minor-border);
  }

  .char-added.minor {
    background: none;
    color: var(--md-char-added-minor-text);
    border-bottom: 1.5px solid var(--md-char-added-minor-border);
  }

  .added-block { }
  .removed-block {
    text-decoration: line-through 1px;
    text-decoration-color: color-mix(in srgb, var(--md-del-text) 45%, transparent);
    color: var(--md-del-text);
  }
  .removed-block * {
    color: inherit;
  }
  .diff-pane del strong, .diff-pane del em, .diff-pane del a {
    color: inherit;
  }
  .modified-block { }
  .modified-block.gap-aligned {
    line-height: 1.6;
  }

  /* Gap-based alignment: placeholders are invisible text that preserves space inline */
  .diff-part {
    display: inline;
  }
  .diff-part.diff-removed {
    color: var(--md-del-text);
  }
  .diff-part.diff-added {
    color: var(--md-ins-text);
  }
  /* Paragraph split marker - shows where a paragraph break was inserted */
  .diff-part.paragraph-split {
    display: block;
    margin: 0.4em 0;
    color: var(--md-ins-text);
    font-style: italic;
    opacity: 0.8;
  }
  .diff-part.paragraph-split ins {
    text-decoration: none;
  }
  .diff-placeholder {
    visibility: hidden;
  }
  .diff-placeholder.paragraph-split {
    display: block;
    margin: 0.4em 0;
  }
  /* When gap alignment is disabled - hide placeholders entirely */
  [data-gap-align="off"] .diff-placeholder {
    display: none;
  }

  .stats-bar {
    display: flex;
    gap: var(--size-3, 16px);
    padding: 6px 20px;
    background: var(--md-bg-alt);
    border-top: 1px solid var(--md-border);
    font-size: 12px;
    color: var(--md-stat-text);
    flex-shrink: 0;
  }

  .stat-item { display: flex; align-items: center; gap: 4px; }
  .stat-dot { width: 8px; height: 8px; border-radius: var(--radius-round, 50%); }
  .stat-dot.equal { background: var(--md-stat-equal-dot); }
  .stat-dot.added { background: var(--md-added-border); }
  .stat-dot.removed { background: var(--md-removed-border); }
  .stat-dot.modified { background: var(--md-modified-border); }

  .diff-pane::-webkit-scrollbar { width: 8px; }
  .diff-pane::-webkit-scrollbar-track { background: var(--md-scroll-track); }
  .diff-pane::-webkit-scrollbar-thumb { background: var(--md-scroll-thumb); border-radius: var(--radius-1, 4px); }
  .diff-pane::-webkit-scrollbar-thumb:hover { background: var(--md-scroll-thumb-hover); }

  #minimap {
    position: fixed;
    right: 0;
    width: 80px;
    z-index: 1000;
    background: var(--md-bg-alt);
    border-left: 1px solid var(--md-border);
    cursor: pointer;
    /* top/height set by JS to align with diff panes */
  }

  #minimapCanvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  #minimapViewport {
    position: absolute;
    left: 2px;
    right: 2px;
    background: var(--md-minimap-viewport, rgba(128, 128, 128, 0.25));
    border: 1px solid var(--md-minimap-viewport-border, rgba(128, 128, 128, 0.4));
    border-radius: 2px;
    pointer-events: none;
    transition: top 0.05s ease-out, height 0.05s ease-out;
  }

  [data-theme="dark"] {
    --md-minimap-viewport: rgba(255, 255, 255, 0.15);
    --md-minimap-viewport-border: rgba(255, 255, 255, 0.3);
  }

  [data-theme="solar"] {
    --md-minimap-viewport: rgba(0, 0, 0, 0.1);
    --md-minimap-viewport-border: rgba(0, 0, 0, 0.2);
  }

  /* Adjust main-content to make room for minimap */
  .main-content {
    padding-right: 80px;
  }
`;
}

// ── Client-side script ──────────────────────────────────────────

const SCRIPT = `
(function() {
  const html = document.documentElement;

  // ── Settings Panel ──────────────────────────────────────────────
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsClose = document.getElementById('settingsClose');

  function openSettings() {
    settingsPanel.classList.add('open');
    settingsOverlay.classList.add('open');
  }

  function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('open');
  }

  settingsToggle.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', closeSettings);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPanel.classList.contains('open')) {
      closeSettings();
    }
  });

  // ── Storage Keys ────────────────────────────────────────────────
  const STORAGE = {
    theme: 'md-diff-theme',
    fontSize: 'md-diff-font-size',
    minimap: 'md-diff-show-minimap',
    gapAlign: 'md-diff-gap-align',
    inlineHighlight: 'md-diff-show-minor',
    mergeMinor: 'md-diff-merge-minor',
    compact: 'md-diff-compact',
    sidebarWidth: 'md-diff-sidebar-width',
  };

  const DEFAULT_FONT_SIZE = 14;

  // Helper for boolean settings with data attribute
  function initBooleanSetting(checkboxId, storageKey, dataAttr, defaultOn = true) {
    const checkbox = document.getElementById(checkboxId);
    const saved = localStorage.getItem(storageKey);
    const isOn = saved ? saved === 'on' : defaultOn;
    html.setAttribute(dataAttr, isOn ? 'on' : 'off');
    checkbox.checked = isOn;
    checkbox.addEventListener('change', () => {
      const val = checkbox.checked ? 'on' : 'off';
      html.setAttribute(dataAttr, val);
      localStorage.setItem(storageKey, val);
    });
    return checkbox;
  }

  // ── Theme Setting ───────────────────────────────────────────────
  const themeToggle = document.getElementById('themeToggle');
  const themeSelect = document.getElementById('themeSelect');

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE.theme, theme);
    themeSelect.value = theme;
  }

  const savedTheme = localStorage.getItem(STORAGE.theme);
  if (savedTheme) setTheme(savedTheme);
  else themeSelect.value = html.getAttribute('data-theme');

  themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'solar' : 'dark';
    setTheme(next);
  });

  themeSelect.addEventListener('change', () => setTheme(themeSelect.value));

  // ── Merge Minor Setting ────────────────────────────────────────
  const mergeMinorSelect = document.getElementById('mergeMinorSelect');

  function setMergeMinor(level) {
    html.setAttribute('data-merge-minor', level);
    localStorage.setItem(STORAGE.mergeMinor, level);
    mergeMinorSelect.value = level;
  }

  const savedMergeMinor = localStorage.getItem(STORAGE.mergeMinor);
  if (savedMergeMinor) setMergeMinor(savedMergeMinor);
  else html.setAttribute('data-merge-minor', 'conservative');

  mergeMinorSelect.addEventListener('change', () => setMergeMinor(mergeMinorSelect.value));

  // ── Font Size Setting ───────────────────────────────────────────
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeValue = document.getElementById('fontSizeValue');

  function setFontSize(size) {
    document.body.style.fontSize = size + 'px';
    fontSizeRange.value = size;
    fontSizeValue.textContent = size + 'px';
    localStorage.setItem(STORAGE.fontSize, size);
  }

  const savedFontSize = localStorage.getItem(STORAGE.fontSize);
  if (savedFontSize) setFontSize(parseInt(savedFontSize, 10));
  else {
    fontSizeRange.value = DEFAULT_FONT_SIZE;
    fontSizeValue.textContent = DEFAULT_FONT_SIZE + 'px';
  }

  fontSizeRange.addEventListener('input', () => setFontSize(parseInt(fontSizeRange.value, 10)));

  // ── Boolean Settings ───────────────────────────────────────────
  initBooleanSetting('showMinimapCheck', STORAGE.minimap, 'data-show-minimap', true);
  initBooleanSetting('showMinorCheck', STORAGE.inlineHighlight, 'data-show-minor', true);
  initBooleanSetting('compactModeCheck', STORAGE.compact, 'data-compact', false);

  // Gap alignment needs special handling for realignment
  const gapAlignCheck = document.getElementById('gapAlignCheck');
  const savedGap = localStorage.getItem(STORAGE.gapAlign);
  const gapOn = savedGap ? savedGap === 'on' : true;
  html.setAttribute('data-gap-align', gapOn ? 'on' : 'off');
  gapAlignCheck.checked = gapOn;

  gapAlignCheck.addEventListener('change', () => {
    const active = document.querySelector('.file-diff:not([style*="display: none"])') || document.querySelector('.file-diff');
    const lp = active && active.querySelector('.left-pane');
    const scrollRatio = lp ? lp.scrollTop / (lp.scrollHeight - lp.clientHeight || 1) : 0;

    const isOn = gapAlignCheck.checked;
    html.setAttribute('data-gap-align', isOn ? 'on' : 'off');
    localStorage.setItem(STORAGE.gapAlign, isOn ? 'on' : 'off');

    if (active) {
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        alignBlocks(lp, rp);
        lp.scrollTop = scrollRatio * (lp.scrollHeight - lp.clientHeight);
      }
    }
  });

  function alignBlocks(leftPane, rightPane) {
    const lb = leftPane.querySelectorAll('.diff-block');
    const rb = rightPane.querySelectorAll('.diff-block');
    const n = Math.min(lb.length, rb.length);

    // Reset all heights first
    for (let i = 0; i < n; i++) {
      lb[i].style.minHeight = '';
      rb[i].style.minHeight = '';
    }

    // Align blocks (gap alignment within blocks is handled by invisible placeholders)
    for (let i = 0; i < n; i++) {
      const maxH = Math.max(lb[i].getBoundingClientRect().height, rb[i].getBoundingClientRect().height);
      lb[i].style.minHeight = maxH + 'px';
      rb[i].style.minHeight = maxH + 'px';
    }
  }

  function computeStats(leftPane) {
    const s = { equal: 0, added: 0, removed: 0, modified: 0 };
    leftPane.querySelectorAll('.diff-block').forEach(b => {
      if (b.classList.contains('equal')) s.equal++;
      else if (b.classList.contains('added')) s.added++;
      else if (b.classList.contains('removed')) s.removed++;
      else if (b.classList.contains('modified')) s.modified++;
    });
    return s;
  }

  function renderStats(stats) {
    document.getElementById('statsBar').innerHTML = [
      ['equal', 'Unchanged'],
      ['modified', 'Modified'],
      ['added', 'Added'],
      ['removed', 'Removed'],
    ].map(([cls, label]) =>
      '<span class="stat-item"><span class="stat-dot ' + cls + '"></span>' + stats[cls] + ' ' + label + '</span>'
    ).join('');
  }

  function setupScrollSync(leftPane, rightPane) {
    let syncing = false;
    function sync(src, tgt) {
      if (syncing) return;
      syncing = true;
      const r = src.scrollTop / (src.scrollHeight - src.clientHeight || 1);
      tgt.scrollTop = r * (tgt.scrollHeight - tgt.clientHeight);
      syncing = false;
    }
    leftPane.addEventListener('scroll', () => sync(leftPane, rightPane));
    rightPane.addEventListener('scroll', () => sync(rightPane, leftPane));
  }

  const fileDiffs = document.querySelectorAll('.file-diff');
  const fileList = document.getElementById('fileList');
  const fileItems = fileList ? fileList.querySelectorAll('.file-item') : [];
  const filePathDisplay = document.getElementById('filePathDisplay');
  const sidebar = document.getElementById('fileSidebar');
  let currentFileIdx = 0;
  const scrollPositions = {};  // In-memory only, resets on page reload

  function saveScrollPosition(idx, scrollTop) {
    scrollPositions[idx] = scrollTop;
  }

  function getSavedScrollPosition(idx) {
    return scrollPositions[idx];
  }

  function findFirstChange(pane) {
    const blocks = pane.querySelectorAll('.diff-block');
    for (const block of blocks) {
      if (block.classList.contains('added') ||
          block.classList.contains('removed') ||
          block.classList.contains('modified')) {
        return block;
      }
    }
    return null;
  }

  function scrollToFirstChange(pane) {
    const firstChange = findFirstChange(pane);
    if (firstChange) {
      // Scroll so the change appears ~20% down from the top of the viewport
      const padding = Math.max(100, pane.clientHeight * 0.2);
      const targetTop = firstChange.offsetTop - padding;
      pane.scrollTop = Math.max(0, targetTop);
    }
  }

  fileDiffs.forEach(fd => {
    const lp = fd.querySelector('.left-pane');
    const rp = fd.querySelector('.right-pane');
    if (lp && rp) setupScrollSync(lp, rp);
  });

  function activateFile(idx) {
    if (idx < 0 || idx >= fileDiffs.length) return;

    // Save scroll position of current file before switching (but not on same-file activation)
    if (idx !== currentFileIdx) {
      const prevActive = fileDiffs[currentFileIdx];
      if (prevActive) {
        const prevPane = prevActive.querySelector('.left-pane');
        if (prevPane) {
          saveScrollPosition(currentFileIdx, prevPane.scrollTop);
        }
      }
    }

    currentFileIdx = idx;

    fileDiffs.forEach((fd, i) => {
      fd.style.display = i === idx ? '' : 'none';
    });

    // Update sidebar selection - find item by data-file-idx, not DOM order
    let activeItem = null;
    fileItems.forEach((item) => {
      const itemIdx = parseInt(item.getAttribute('data-file-idx') || '-1', 10);
      const isActive = itemIdx === idx;
      item.classList.toggle('active', isActive);
      if (isActive) {
        activeItem = item;
        item.scrollIntoView({ block: 'nearest' });
      }
    });

    // Update file path display
    if (filePathDisplay && activeItem) {
      const fullPath = activeItem.getAttribute('data-full-path');
      filePathDisplay.querySelector('.current-file-path').textContent = fullPath;
    }

    const active = fileDiffs[idx];
    if (active) {
      const lp = active.querySelector('.left-pane');
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        alignBlocks(lp, rp);
        renderStats(computeStats(lp));

        // Restore scroll position or scroll to first change
        // Use setTimeout to ensure layout is complete (especially on initial load)
        setTimeout(() => {
          const savedPos = getSavedScrollPosition(idx);
          if (savedPos !== undefined) {
            lp.scrollTop = savedPos;
          } else {
            scrollToFirstChange(lp);
          }
        }, 0);
      }
    }
  }

  // File list click handlers
  fileItems.forEach((item) => {
    const fileIdx = parseInt(item.getAttribute('data-file-idx') || '0', 10);
    item.addEventListener('click', () => activateFile(fileIdx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateFile(fileIdx);
      }
    });
  });

  activateFile(0);

  // Keyboard navigation (arrow keys, no modifier needed)
  document.addEventListener('keydown', (e) => {
    // Only handle if not in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Only handle if we have multiple files
    if (fileDiffs.length <= 1) return;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      if (currentFileIdx < fileDiffs.length - 1) {
        activateFile(currentFileIdx + 1);
        // Dispatch custom event for minimap update
        document.dispatchEvent(new CustomEvent('filechange'));
        e.preventDefault();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      if (currentFileIdx > 0) {
        activateFile(currentFileIdx - 1);
        // Dispatch custom event for minimap update
        document.dispatchEvent(new CustomEvent('filechange'));
        e.preventDefault();
      }
    }
  });

  // Save scroll position on scroll (debounced)
  let scrollSaveTimeout = null;
  fileDiffs.forEach((fd, idx) => {
    const lp = fd.querySelector('.left-pane');
    if (lp) {
      lp.addEventListener('scroll', () => {
        if (idx !== currentFileIdx) return;
        clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => saveScrollPosition(idx, lp.scrollTop), 200);
      });
    }
  });

  // Sidebar resize functionality
  const resizeHandle = document.getElementById('sidebarResize');
  if (resizeHandle && sidebar) {
    const savedWidth = localStorage.getItem(STORAGE.sidebarWidth);
    if (savedWidth) {
      document.body.style.setProperty('--sidebar-width', savedWidth + 'px');
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(400, startWidth + delta));
      document.body.style.setProperty('--sidebar-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(STORAGE.sidebarWidth, sidebar.offsetWidth);
      }
    });
  }

  // Custom minimap for dual-pane synchronized scrolling
  (function initMinimap() {
    const minimapEl = document.getElementById('minimap');
    const canvas = document.getElementById('minimapCanvas');
    const viewport = document.getElementById('minimapViewport');
    if (!canvas || !viewport || !minimapEl) return;

    const ctx = canvas.getContext('2d');
    let currentPane = null;
    let isDragging = false;
    let pendingRender = null;
    // Cache block data per file index: { scrollHeight, blocks: [{top, height, status}] }
    const blockCache = new Map();

    const colors = {
      dark: { added: '#22c55e', removed: '#ef4444', modified: '#eab308', equal: 'rgba(160, 160, 160, 0.2)', bg: '#2b2b2b' },
      solar: { added: '#16a34a', removed: '#dc2626', modified: '#ca8a04', equal: 'rgba(120, 113, 108, 0.15)', bg: '#faf4e8' }
    };
    const getColors = () => colors[html.getAttribute('data-theme')] || colors.dark;

    function getActivePane() {
      const active = fileDiffs[currentFileIdx];
      return active ? active.querySelector('.left-pane') : null;
    }

    function positionMinimap() {
      const pane = getActivePane();
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      minimapEl.style.top = paneRect.top + 'px';
      minimapEl.style.height = paneRect.height + 'px';
    }

    function computeBlockData(pane) {
      const blocks = pane.querySelectorAll('.diff-block');
      const data = [];
      // Batch read all positions to avoid layout thrashing
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        let status = 'equal';
        if (block.classList.contains('added')) status = 'added';
        else if (block.classList.contains('removed')) status = 'removed';
        else if (block.classList.contains('modified')) status = 'modified';
        data.push({ top: block.offsetTop, height: block.offsetHeight, status });
      }
      return { scrollHeight: pane.scrollHeight, blocks: data };
    }

    function renderMinimap(forceRecompute) {
      const pane = getActivePane();
      if (!pane) return;
      currentPane = pane;
      positionMinimap();

      const dpr = window.devicePixelRatio || 1;
      const rect = minimapEl.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const cols = getColors();
      ctx.fillStyle = cols.bg;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Use cached block data or compute it
      let cached = blockCache.get(currentFileIdx);
      if (!cached || forceRecompute) {
        cached = computeBlockData(pane);
        blockCache.set(currentFileIdx, cached);
      }

      const { scrollHeight, blocks } = cached;
      if (!blocks.length) return;

      const scale = rect.height / scrollHeight;
      const halfW = rect.width / 2;

      // Draw all blocks
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const y = b.top * scale;
        const h = Math.max(b.height * scale, 2);
        ctx.fillStyle = cols[b.status];
        ctx.fillRect(4, y, halfW - 6, h);
        ctx.fillRect(halfW + 2, y, halfW - 6, h);
      }

      updateViewport();
    }

    function scheduleRender(forceRecompute) {
      if (pendingRender) return;
      pendingRender = requestAnimationFrame(() => {
        pendingRender = null;
        renderMinimap(forceRecompute);
      });
    }

    function invalidateCache(fileIdx) {
      if (fileIdx !== undefined) blockCache.delete(fileIdx);
      else blockCache.clear();
    }

    function updateViewport() {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const scrollHeight = pane.scrollHeight;
      const clientHeight = pane.clientHeight;
      const scrollTop = pane.scrollTop;
      const minimapHeight = minimapEl.getBoundingClientRect().height;

      const scale = minimapHeight / scrollHeight;
      viewport.style.top = (scrollTop * scale) + 'px';
      viewport.style.height = Math.max(clientHeight * scale, 20) + 'px';
    }

    function scrollToPosition(e) {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const rect = minimapEl.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const maxScroll = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.max(0, Math.min(ratio * pane.scrollHeight - pane.clientHeight / 2, maxScroll));
    }

    // Event listeners
    minimapEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      scrollToPosition(e);
    });
    document.addEventListener('mousemove', (e) => { if (isDragging) scrollToPosition(e); });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Update viewport on scroll
    let scrollListenerPane = null;
    function attachScrollListener() {
      const pane = getActivePane();
      if (pane && pane !== scrollListenerPane) {
        if (scrollListenerPane) scrollListenerPane.removeEventListener('scroll', updateViewport);
        scrollListenerPane = pane;
        pane.addEventListener('scroll', updateViewport);
      }
    }

    // Initial render - use double rAF to ensure layout is ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderMinimap();
        attachScrollListener();
      });
    });

    // Re-render on theme change (no recompute needed, just redraw)
    themeToggle.addEventListener('click', () => scheduleRender(false));

    // Re-render on file change
    document.addEventListener('filechange', () => {
      scheduleRender(false);
      attachScrollListener();
    });
    fileItems.forEach(item => {
      item.addEventListener('click', () => {
        scheduleRender(false);
        attachScrollListener();
      });
    });

    // Re-render on gap alignment toggle (invalidate cache - heights change)
    gapAlignCheck.addEventListener('change', () => {
      invalidateCache(currentFileIdx);
      scheduleRender(true);
    });

    // Re-render on resize (invalidate all caches)
    window.addEventListener('resize', () => {
      invalidateCache();
      positionMinimap();
      scheduleRender(true);
    });
  })();

  // Copy with context (Cmd-Shift-C)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.shiftKey && e.key === 'c') {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const text = sel.toString();
      const range = sel.getRangeAt(0);
      const startEl = range.startContainer.parentElement;
      const block = startEl?.closest('.diff-block');
      const pane = block?.closest('.diff-pane');

      if (!block || !pane) return;

      // Determine side and get line number
      const isLeft = pane.classList.contains('left-pane');
      const lineAttr = isLeft ? 'data-line-left' : 'data-line-right';

      // First try block-level line number, then look for inner data-line span
      let line = block.getAttribute(lineAttr);
      if (!line) {
        const lineSpan = startEl?.closest('[data-line]');
        line = lineSpan?.getAttribute('data-line') || '?';
      }

      // Get file name (just the basename, not full path)
      const fullPath = fileItems[currentFileIdx]?.getAttribute('data-full-path') || 'unknown';
      const fileName = fullPath.split('/').pop() || fullPath;

      // Format: file:line + newline + selected text
      const formatted = fileName + ':' + line + '\\n' + text;

      navigator.clipboard.writeText(formatted);
      e.preventDefault();
    }
  });
})();
`;
