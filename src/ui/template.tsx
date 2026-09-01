import type { RenderedRow } from "../render/render.js";
import { themes, themeVars, type ThemeName } from "./themes.js";
import { MATCHING_LEVEL_NAMES, type MatchingLevel } from "../config.js";
import { cssText } from "./styles.js";
import { SCRIPT } from "./client-script.js";

/** UI Settings that can be pre-configured via CLI */
export interface UISettings {
  theme?: "dark" | "solar";
  fontSize?: number;
  showMinimap?: boolean;
  matchLevel?: MatchingLevel;
  gapAlign?: boolean;
  showMinor?: boolean;
  mergeMinor?: "off" | "conservative" | "aggressive";
  compact?: boolean;
}

export interface FileDiff {
  path: string;
  rows: RenderedRow[];
  /** Lines added (from git) */
  added?: number;
  /** Lines removed (from git) */
  removed?: number;
  /** Pre-computed rows at different matching levels (for UI switching) */
  rowsByLevel?: Record<MatchingLevel, RenderedRow[]>;
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

function FileDiffView({ file, idx, initialLevel }: { file: FileDiff; idx: number; initialLevel: MatchingLevel }) {
  const hasMultipleLevels = file.rowsByLevel && Object.keys(file.rowsByLevel).length > 1;

  return (
    <div
      class="file-diff"
      data-file-idx={String(idx)}
      style={idx > 0 ? "display:none" : undefined}
    >
      {hasMultipleLevels ? (
        // Render all matching level variants
        <>
          {MATCHING_LEVEL_NAMES.map((level) => {
            const levelRows = file.rowsByLevel![level];
            if (!levelRows) return null;
            return (
              <div
                class="diff-container"
                data-match-level={level}
                style={level !== initialLevel ? "display:none" : undefined}
              >
                <DiffPane rows={levelRows} side="left" idx={idx} />
                <DiffPane rows={levelRows} side="right" idx={idx} />
              </div>
            );
          })}
        </>
      ) : (
        // Single level (default/CLI-specified)
        <div class="diff-container">
          <DiffPane rows={file.rows} side="left" idx={idx} />
          <DiffPane rows={file.rows} side="right" idx={idx} />
        </div>
      )}
    </div>
  );
}

function Header({
  leftTitle,
  rightTitle,
  projectRoot,
  command,
}: {
  leftTitle: string;
  rightTitle: string;
  projectRoot?: string;
  command?: string;
}) {
  return (
    <header>
      <div class="header-cell left-header">
        {leftTitle}
        {projectRoot && (
          <span class="project-root" title={projectRoot} data-path={projectRoot}>
            {projectRoot}
          </span>
        )}
      </div>
      <div class="header-cell right-header">
        <span class="header-title-group">
          {rightTitle}
          {command && (
            <span class="header-command" title={`md-diff ${command}`}>
              {"md-diff " + command}
            </span>
          )}
        </span>
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
            <label for="matchLevelSelect">Matching Sensitivity</label>
            <select id="matchLevelSelect">
              <option value="strict">Strict</option>
              <option value="normal" selected>Normal</option>
              <option value="loose">Loose</option>
              <option value="inline">Inline</option>
            </select>
          </div>
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

/** Page-level options shared by the HTML generators */
export interface HtmlOptions {
  leftTitle: string;
  rightTitle: string;
  theme?: ThemeName;
  uiSettings?: UISettings;
  projectRoot?: string;
  command?: string;
}

export function generateHtml(
  rows: RenderedRow[],
  options: HtmlOptions & { rowsByLevel?: Record<MatchingLevel, RenderedRow[]> },
): string {
  const { rowsByLevel, ...pageOptions } = options;
  return generateMultiFileHtml([{ path: "single", rows, rowsByLevel }], pageOptions);
}

export function generateMultiFileHtml(files: FileDiff[], options: HtmlOptions): string {
  const { leftTitle, rightTitle, theme = "dark", uiSettings, projectRoot, command } = options;
  const darkVars = themeVars(themes.dark);
  const solarVars = themeVars(themes.solar);
  const isMulti = files.length > 1;
  const initialLevel: MatchingLevel = uiSettings?.matchLevel ?? "normal";

  // Embed initial settings as a data attribute for JS to pick up
  const initialSettings = uiSettings ? JSON.stringify(uiSettings) : undefined;

  const page = (
    <html lang="en" data-theme={theme} data-initial-settings={initialSettings}>
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
          <Header leftTitle={leftTitle} rightTitle={rightTitle} projectRoot={projectRoot} command={command} />
          {isMulti && <FilePathDisplay files={files} />}
          {files.map((f, i) => (
            <FileDiffView file={f} idx={i} initialLevel={initialLevel} />
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
