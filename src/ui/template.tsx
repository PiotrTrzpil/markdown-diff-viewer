import type { RenderedRow } from "../render.js";
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
  return (
    <aside id="fileSidebar" class="file-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Files</span>
        <span class="file-count">{files.length}</span>
      </div>
      <ul class="file-list" id="fileList">
        {files.map((f, i) => (
          <li
            class={`file-item${i === 0 ? " active" : ""}`}
            data-file-idx={String(i)}
            data-full-path={f.path}
            tabindex="0"
          >
            <span class="file-name">{getFilename(f.path)}</span>
            <FileStats added={f.added} removed={f.removed} />
          </li>
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
        <div class={`diff-block ${r.status}`}>
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
          <label class="align-toggle" title="Align modified paragraphs exactly">
            <input type="checkbox" id="gapAlignToggle" checked />
            <span>Align modified paragraphs exactly</span>
          </label>
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

  .file-item {
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    border-left: 3px solid transparent;
    transition: background 0.1s ease, border-color 0.1s ease;
    outline: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-stats {
    display: flex;
    gap: 8px;
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

  .align-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: normal;
    text-transform: none;
    letter-spacing: normal;
  }
  .align-toggle input {
    cursor: pointer;
    accent-color: var(--md-link);
    width: 14px;
    height: 14px;
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
  const toggle = document.getElementById('themeToggle');
  const STORAGE_KEY = 'md-diff-theme';

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved !== html.getAttribute('data-theme')) {
    html.setAttribute('data-theme', saved);
  }

  toggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'solar' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY, next);
  });

  // Gap alignment toggle
  const gapToggle = document.getElementById('gapAlignToggle');
  const GAP_STORAGE_KEY = 'md-diff-gap-align';
  const savedGap = localStorage.getItem(GAP_STORAGE_KEY);
  if (savedGap === 'off') {
    html.setAttribute('data-gap-align', 'off');
    gapToggle.checked = false;
  }
  gapToggle.addEventListener('change', () => {
    const active = document.querySelector('.file-diff:not([style*="display: none"])') || document.querySelector('.file-diff');
    const lp = active && active.querySelector('.left-pane');

    // Save scroll position as ratio before toggle
    const scrollRatio = lp ? lp.scrollTop / (lp.scrollHeight - lp.clientHeight || 1) : 0;

    const isOn = gapToggle.checked;
    html.setAttribute('data-gap-align', isOn ? 'on' : 'off');
    localStorage.setItem(GAP_STORAGE_KEY, isOn ? 'on' : 'off');

    // Re-align after toggle
    if (active) {
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        alignBlocks(lp, rp);
        // Restore scroll position using saved ratio
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

  fileDiffs.forEach(fd => {
    const lp = fd.querySelector('.left-pane');
    const rp = fd.querySelector('.right-pane');
    if (lp && rp) setupScrollSync(lp, rp);
  });

  function activateFile(idx) {
    if (idx < 0 || idx >= fileDiffs.length) return;
    currentFileIdx = idx;

    fileDiffs.forEach((fd, i) => {
      fd.style.display = i === idx ? '' : 'none';
    });

    // Update sidebar selection
    fileItems.forEach((item, i) => {
      item.classList.toggle('active', i === idx);
      if (i === idx) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });

    // Update file path display
    if (filePathDisplay && fileItems[idx]) {
      const fullPath = fileItems[idx].getAttribute('data-full-path');
      filePathDisplay.querySelector('.current-file-path').textContent = fullPath;
    }

    const active = fileDiffs[idx];
    if (active) {
      const lp = active.querySelector('.left-pane');
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        alignBlocks(lp, rp);
        renderStats(computeStats(lp));
      }
    }
  }

  // File list click handlers
  fileItems.forEach((item, idx) => {
    item.addEventListener('click', () => activateFile(idx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateFile(idx);
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

  // Sidebar resize functionality
  const resizeHandle = document.getElementById('sidebarResize');
  if (resizeHandle && sidebar) {
    const SIDEBAR_WIDTH_KEY = 'md-diff-sidebar-width';
    const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
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
        localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.offsetWidth);
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

    const getColors = () => html.getAttribute('data-theme') === 'dark' ? {
      added: '#22c55e',
      removed: '#ef4444',
      modified: '#eab308',
      equal: 'rgba(160, 160, 160, 0.2)',
      bg: '#2b2b2b'
    } : {
      added: '#16a34a',
      removed: '#dc2626',
      modified: '#ca8a04',
      equal: 'rgba(120, 113, 108, 0.15)',
      bg: '#faf4e8'
    };

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

    function renderMinimap() {
      const pane = getActivePane();
      if (!pane) return;
      currentPane = pane;

      // Position minimap to align with diff pane
      positionMinimap();

      const dpr = window.devicePixelRatio || 1;
      const rect = minimapEl.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const colors = getColors();
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, rect.width, rect.height);

      const blocks = pane.querySelectorAll('.diff-block');
      if (!blocks.length) return;

      const scrollHeight = pane.scrollHeight;
      const scale = rect.height / scrollHeight;

      // Draw each block as a colored bar
      blocks.forEach(block => {
        const blockTop = block.offsetTop;
        const blockHeight = block.offsetHeight;

        // Determine color based on status
        let color = colors.equal;
        if (block.classList.contains('added')) color = colors.added;
        else if (block.classList.contains('removed')) color = colors.removed;
        else if (block.classList.contains('modified')) color = colors.modified;

        const y = blockTop * scale;
        const h = Math.max(blockHeight * scale, 2); // min 2px height

        ctx.fillStyle = color;
        // Draw on both sides to represent both panes
        ctx.fillRect(4, y, rect.width / 2 - 6, h);
        ctx.fillRect(rect.width / 2 + 2, y, rect.width / 2 - 6, h);
      });

      updateViewport();
    }

    function updateViewport() {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const scrollHeight = pane.scrollHeight;
      const clientHeight = pane.clientHeight;
      const scrollTop = pane.scrollTop;
      const minimapHeight = minimapEl.getBoundingClientRect().height;

      const scale = minimapHeight / scrollHeight;
      const viewportTop = scrollTop * scale;
      const viewportHeight = Math.max(clientHeight * scale, 20); // min 20px

      viewport.style.top = viewportTop + 'px';
      viewport.style.height = viewportHeight + 'px';
    }

    function scrollToPosition(e) {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const rect = minimapEl.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;

      const scrollHeight = pane.scrollHeight;
      const clientHeight = pane.clientHeight;
      const maxScroll = scrollHeight - clientHeight;

      pane.scrollTop = Math.max(0, Math.min(ratio * scrollHeight - clientHeight / 2, maxScroll));
    }

    // Event listeners
    minimapEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      scrollToPosition(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) scrollToPosition(e);
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Update viewport on scroll (both panes trigger this due to sync)
    let scrollListenerPane = null;
    function attachScrollListener() {
      const pane = getActivePane();
      if (pane && pane !== scrollListenerPane) {
        if (scrollListenerPane) {
          scrollListenerPane.removeEventListener('scroll', updateViewport);
        }
        scrollListenerPane = pane;
        pane.addEventListener('scroll', updateViewport);
      }
    }

    // Initial render
    setTimeout(() => {
      renderMinimap();
      attachScrollListener();
    }, 100);

    // Re-render on theme change
    toggle.addEventListener('click', () => setTimeout(renderMinimap, 50));

    // Re-render on file change (listen for custom event + clicks)
    document.addEventListener('filechange', () => {
      setTimeout(() => {
        renderMinimap();
        attachScrollListener();
      }, 50);
    });
    fileItems.forEach(item => {
      item.addEventListener('click', () => {
        setTimeout(() => {
          renderMinimap();
          attachScrollListener();
        }, 50);
      });
    });

    // Re-render on gap alignment toggle
    gapToggle.addEventListener('change', () => setTimeout(renderMinimap, 100));

    // Re-render on resize
    window.addEventListener('resize', () => {
      positionMinimap();
      setTimeout(renderMinimap, 100);
    });
  })();
})();
`;
