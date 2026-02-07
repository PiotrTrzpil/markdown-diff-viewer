import type { RenderedRow } from "../render.js";
import { themes, themeVars, type ThemeName } from "./themes.js";

export interface FileDiff {
  path: string;
  rows: RenderedRow[];
}

// ── Components ─────────────────────────────────────────────────

function FileSelector({ files }: { files: FileDiff[] }) {
  return (
    <div class="file-selector">
      <select id="fileSelect">
        {files.map((f, i) => (
          <option value={String(i)}>{f.path}</option>
        ))}
      </select>
      <span class="file-count">{files.length} files</span>
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
      <body>
        <Header leftTitle={leftTitle} rightTitle={rightTitle} />
        {isMulti && <FileSelector files={files} />}
        {files.map((f, i) => (
          <FileDiffView file={f} idx={i} />
        ))}
        <div class="stats-bar" id="statsBar" />
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
    flex-direction: column;
    height: 100vh;
    transition: background 0.3s ease, color 0.3s ease;
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

  .file-selector {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 20px;
    background: var(--md-bg-alt);
    border-bottom: 1px solid var(--md-border);
    flex-shrink: 0;
  }

  .file-selector select {
    flex: 1;
    background: var(--md-bg);
    color: var(--md-text);
    border: 1px solid var(--md-border);
    border-radius: 4px;
    padding: 5px 10px;
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    font-size: 13px;
    cursor: pointer;
    outline: none;
  }

  .file-selector select:hover { border-color: var(--md-text-muted); }
  .file-selector select:focus { border-color: var(--md-link); }

  .file-count {
    font-size: 12px;
    color: var(--md-stat-text);
    white-space: nowrap;
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
  .diff-placeholder {
    visibility: hidden;
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
  const fileSelect = document.getElementById('fileSelect');

  fileDiffs.forEach(fd => {
    const lp = fd.querySelector('.left-pane');
    const rp = fd.querySelector('.right-pane');
    if (lp && rp) setupScrollSync(lp, rp);
  });

  function activateFile(idx) {
    fileDiffs.forEach((fd, i) => {
      fd.style.display = i === idx ? '' : 'none';
    });
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

  if (fileSelect) {
    fileSelect.addEventListener('change', (e) => {
      activateFile(parseInt(e.target.value, 10));
    });
  }

  activateFile(0);

  if (fileSelect) {
    document.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      const cur = parseInt(fileSelect.value, 10);
      if (e.key === 'ArrowDown' && cur < fileDiffs.length - 1) {
        fileSelect.value = cur + 1;
        activateFile(cur + 1);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && cur > 0) {
        fileSelect.value = cur - 1;
        activateFile(cur - 1);
        e.preventDefault();
      }
    });
  }
})();
`;
