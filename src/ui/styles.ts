/**
 * CSS for the diff viewer page.
 * Receives pre-rendered theme variable blocks for the dark and solar themes.
 */
export function cssText(darkVars: string, solarVars: string): string {
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
    padding: 6px 20px;
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--md-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .left-header {
    border-right: 1px solid var(--md-border);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .project-root {
    font-weight: 400;
    font-size: 11px;
    text-transform: none;
    color: var(--md-text-muted);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    min-width: 0;
    flex: 1;
  }

  .header-title-group {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    overflow: hidden;
  }

  .header-command {
    font-weight: 400;
    font-size: 11px;
    font-family: var(--font-mono, 'SF Mono', 'Fira Code', 'Fira Mono', monospace);
    text-transform: none;
    letter-spacing: 0;
    color: var(--md-text-muted);
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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

  /* Merge minor changes - style absorbable equals as removed/added based on side */
  /* Conservative: style stop-word absorbables */
  [data-merge-minor="conservative"] .absorbable-stopword.left,
  [data-merge-minor="aggressive"] .absorbable-stopword.left {
    background-color: var(--md-removed-bg);
    color: var(--md-del-text);
    text-decoration: line-through;
  }
  [data-merge-minor="conservative"] .absorbable-stopword.right,
  [data-merge-minor="aggressive"] .absorbable-stopword.right {
    background-color: var(--md-added-bg);
    color: var(--md-ins-text);
  }
  /* Aggressive: also style single-word absorbables */
  [data-merge-minor="aggressive"] .absorbable-single.left {
    background-color: var(--md-removed-bg);
    color: var(--md-del-text);
    text-decoration: line-through;
  }
  [data-merge-minor="aggressive"] .absorbable-single.right {
    background-color: var(--md-added-bg);
    color: var(--md-ins-text);
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

  .right-pane .diff-block.added {
    background: var(--md-added-bg);
    border-left: 3px solid var(--md-added-border);
    padding-left: 8px;
  }

  .left-pane .diff-block.removed {
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
  .moved-block {
    color: var(--md-moved-text);
    text-decoration: none;
  }
  .moved-block.moved-from {
    color: var(--md-moved-from-text);
  }
  .removed-block .moved-block,
  .removed-block .moved-block * {
    color: var(--md-moved-from-text);
    text-decoration: none;
  }
  /* Inner edits inside a relocated paragraph keep add/delete paint. */
  .removed-block .moved-block del,
  .moved-block del {
    color: var(--md-del-text);
    background: var(--md-del-bg);
    text-decoration: line-through 1px;
    text-decoration-color: color-mix(in srgb, var(--md-del-text) 45%, transparent);
  }
  .removed-block .moved-block del *,
  .moved-block del * {
    color: inherit;
    text-decoration: inherit;
  }
  .removed-block .moved-block ins,
  .moved-block ins {
    color: var(--md-ins-text);
    background: var(--md-ins-bg);
    text-decoration: none;
  }
  .removed-block .moved-block ins *,
  .moved-block ins * {
    color: inherit;
  }
  .removed-block .diff-equal {
    text-decoration: none;
    color: var(--md-text);
  }
  .diff-pane del strong, .diff-pane del em, .diff-pane del a {
    color: inherit;
  }
  .modified-block { }
  .modified-block.gap-aligned {
    line-height: 1.6;
  }

  /* Inline diff parts */
  .diff-part {
    display: inline;
  }
  .diff-part.diff-removed {
    color: var(--md-del-text);
  }
  .diff-part.diff-added {
    color: var(--md-ins-text);
  }
  .diff-part.diff-moved,
  .change-layer.diff-moved,
  .change-layer.diff-moved del,
  .change-layer.diff-moved ins {
    color: var(--md-moved-text);
    background: var(--md-moved-bg);
    text-decoration: none;
  }
  .diff-part.diff-moved-from,
  .change-layer.diff-moved-from,
  .change-layer.diff-moved-from del,
  .change-layer.diff-moved-from ins {
    color: var(--md-moved-from-text);
    background: var(--md-moved-from-bg);
    text-decoration: none;
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

  /* Overlay-based alignment: removed+added pairs share the same grid cell,
     so container sizes to max(removed_height, added_height) */
  .change-group {
    display: inline;
  }
  .change-pair {
    display: inline-grid;
    vertical-align: baseline;
    /* Ensure grid properly contains both layers */
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
  .change-pair > .change-layer {
    grid-area: 1 / 1;
    /* Preserve trailing whitespace that would otherwise collapse in grid */
    white-space: pre-wrap;
    /* Ensure proper wrapping within the grid cell */
    min-width: 0;
  }
  .change-layer.hidden {
    /* Use opacity instead of visibility for more reliable layout */
    opacity: 0;
    pointer-events: none;
  }
  .change-layer.diff-removed {
    color: var(--md-del-text);
  }
  .change-layer.diff-added {
    color: var(--md-ins-text);
  }
  .change-layer.diff-moved {
    color: var(--md-moved-text);
  }

  /* When gap alignment is disabled - collapse hidden layers entirely */
  [data-gap-align="off"] .change-layer.hidden {
    display: none;
  }
  [data-gap-align="off"] .change-pair {
    display: inline;
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

  /* Sidebar file list scrollbar — track matches the sidebar's bg-alt surface */
  .file-list { scrollbar-width: thin; scrollbar-color: var(--md-scroll-thumb) var(--md-bg-alt); }
  .file-list::-webkit-scrollbar { width: 8px; }
  .file-list::-webkit-scrollbar-track { background: var(--md-bg-alt); }
  .file-list::-webkit-scrollbar-thumb { background: var(--md-scroll-thumb); border-radius: var(--radius-1, 4px); }
  .file-list::-webkit-scrollbar-thumb:hover { background: var(--md-scroll-thumb-hover); }

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
