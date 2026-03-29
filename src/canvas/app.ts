/**
 * Module 12: App Controller
 *
 * Orchestrates initialization, event handling, settings, resize, and multi-file
 * support. Created once when the HTML page loads, wires all canvas modules.
 */

import type { DiffData, SerializedPair, UISettings } from "../serialize/types.js";
import type { MatchingLevel } from "../config.js";
import type { CanvasTheme, FontConfig, RowHeight, Viewport } from "./types.js";

import { DiffPainter } from "./painter.js";
import { TextLayer } from "./text-layer.js";
import { VirtualScroll } from "./scroll.js";
import { Minimap } from "./minimap.js";
import { getTheme } from "./theme.js";
import { defaultFontConfig } from "./fonts.js";
import { LayoutSession, heightPass, linePass } from "./layout.js";
import { clearCache } from "@chenglou/pretext";

// ─── Constants ───────────────────────────────────────────────────────────────

const MINIMAP_WIDTH = 80;
const HEADER_HEIGHT = 48;
const LAYOUT_GUTTER = 8; // must match GUTTER in layout.ts

function getColumnWidth(containerWidth: number): number {
  return Math.floor((containerWidth - LAYOUT_GUTTER) / 2);
}

// ─── DiffApp ─────────────────────────────────────────────────────────────────

export class DiffApp {
  // Data
  private data: DiffData;
  private currentFileIdx: number = 0;
  private currentPairs: SerializedPair[];
  private rowHeights: RowHeight[] = [];

  // Rendering
  private painter!: DiffPainter;
  private textLayer!: TextLayer;
  private scroll!: VirtualScroll;
  private minimap!: Minimap;

  // Config
  private theme: CanvasTheme;
  private fontConfig: FontConfig;
  private matchLevel: MatchingLevel;

  // DOM
  private appEl!: HTMLDivElement;
  private canvasEl!: HTMLCanvasElement;
  private minimapEl!: HTMLCanvasElement;

  // Layout state
  private session!: LayoutSession;
  private containerWidth: number = 0;
  private columnWidth: number = 0;
  private viewportHeight: number = 0;

  // Multi-file scroll positions (save/restore per file)
  private scrollPositions: number[] = [];

  // Resize debounce
  private resizeRaf: number | null = null;

  constructor(data: DiffData) {
    this.data = data;

    const settings: UISettings = data.settings ?? {};
    this.theme = getTheme(settings.theme ?? "dark");
    this.fontConfig = defaultFontConfig(settings.fontSize ?? 16);
    this.matchLevel = settings.matchLevel ?? "normal";

    this.currentPairs = this.getPairs(0);
    this.scrollPositions = data.files.map(() => 0);

    this.init();
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  private init(): void {
    // Async init — wait for fonts before measuring
    document.fonts.ready.then(() => {
      this.setupDOM();
      this.buildLayout();
      this.buildUI();
      this.attachEvents();
      this.onScroll();
    });
  }

  private setupDOM(): void {
    this.appEl = document.getElementById("app") as HTMLDivElement;
    this.canvasEl = document.getElementById("canvas") as HTMLCanvasElement;
    const textEl = document.getElementById("text") as HTMLDivElement;
    this.minimapEl = document.getElementById("minimap") as HTMLCanvasElement;

    this.containerWidth = this.appEl.clientWidth;
    this.viewportHeight = this.appEl.clientHeight;
    this.columnWidth = getColumnWidth(this.containerWidth);

    this.painter = new DiffPainter(this.canvasEl);
    this.textLayer = new TextLayer(textEl);
    this.scroll = new VirtualScroll(this.appEl, []);
    this.minimap = new Minimap(this.minimapEl);

    this.resizeCanvas();
    this.resizeMinimap();

    // Minimap click → scroll to ratio
    this.minimap.onClick((ratio) => {
      const totalHeight = this.scroll.getTotalHeight();
      this.appEl.scrollTop = ratio * (totalHeight - this.viewportHeight);
    });
  }

  private rebuildSession(): void {
    this.session = new LayoutSession(this.fontConfig, this.theme, this.columnWidth);
    this.session.prepareAllBlocks(this.currentPairs);
  }

  private buildLayout(): void {
    this.rebuildSession();
    this.rowHeights = heightPass(this.session, this.currentPairs);
    this.scroll.updatePositions(this.rowHeights);
  }

  // ─── Canvas / Minimap Resize ─────────────────────────────────────────────────

  private resizeCanvas(): void {
    const h = this.scroll.getTotalHeight();
    // Canvas height = full scrollable height so paint doesn't clip
    // (We only clear/paint the visible viewport band)
    this.painter.resize(this.containerWidth, Math.max(h, this.viewportHeight));
  }

  private resizeMinimap(): void {
    const availableHeight = window.innerHeight - HEADER_HEIGHT;
    this.minimap.resize(MINIMAP_WIDTH, availableHeight);
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────────

  private onScroll(): void {
    const scrollTop = this.appEl.scrollTop;
    const { start, end } = this.scroll.getVisibleRange(scrollTop, this.viewportHeight);

    const viewport: Viewport = {
      top: scrollTop,
      bottom: scrollTop + this.viewportHeight,
    };

    const visibleRows = linePass(this.session, this.rowHeights.slice(start, end), this.currentPairs);

    this.painter.paint(visibleRows, viewport, this.theme);
    this.textLayer.update(visibleRows, viewport);

    const totalHeight = this.scroll.getTotalHeight();
    this.minimap.paint(this.rowHeights, totalHeight, scrollTop, this.viewportHeight, this.theme);
  }

  private onResize(): void {
    this.containerWidth = this.appEl.clientWidth;
    this.viewportHeight = this.appEl.clientHeight;
    this.columnWidth = getColumnWidth(this.containerWidth);
    this.session.columnWidth = this.columnWidth;

    this.rowHeights = heightPass(this.session, this.currentPairs);
    this.scroll.updatePositions(this.rowHeights);

    this.resizeCanvas();
    this.resizeMinimap();

    this.onScroll();
  }

  // ─── Settings ────────────────────────────────────────────────────────────────

  setTheme(name: "dark" | "solar"): void {
    this.theme = getTheme(name);
    document.documentElement.setAttribute("data-theme", name);
    this.onScroll();
    this.syncThemeUI();
  }

  private syncThemeUI(): void {
    const sel = document.getElementById("themeSelect") as HTMLSelectElement | null;
    if (sel) sel.value = this.theme.name;
  }

  setFontSize(size: number): void {
    this.fontConfig = { ...this.fontConfig, baseFontSize: size };
    clearCache();
    this.buildLayout();
    this.resizeCanvas();
    this.onScroll();
  }

  setMatchLevel(level: MatchingLevel): void {
    this.matchLevel = level;
    this.currentPairs = this.getPairs(this.currentFileIdx);
    this.buildLayout();
    this.resizeCanvas();
    this.onScroll();
  }

  // ─── Multi-file support ───────────────────────────────────────────────────────

  activateFile(idx: number): void {
    if (idx < 0 || idx >= this.data.files.length) return;
    if (idx === this.currentFileIdx) return;

    // Save current scroll position
    this.scrollPositions[this.currentFileIdx] = this.appEl.scrollTop;

    this.currentFileIdx = idx;
    this.currentPairs = this.getPairs(idx);

    this.buildLayout();
    this.resizeCanvas();

    // Restore or jump to first change
    const savedPos = this.scrollPositions[idx];
    if (savedPos > 0) {
      this.appEl.scrollTop = savedPos;
    } else {
      this.appEl.scrollTop = this.findFirstChange();
    }

    this.onScroll();
    this.updateSidebarSelection();
  }

  private findFirstChange(): number {
    for (const row of this.rowHeights) {
      if (row.status !== "equal") return Math.max(0, row.y - HEADER_HEIGHT);
    }
    return 0;
  }

  // ─── Data helpers ─────────────────────────────────────────────────────────────

  private getPairs(fileIdx: number): SerializedPair[] {
    const file = this.data.files[fileIdx];
    if (!file) return [];
    if (this.matchLevel !== "normal" && file.pairsByLevel?.[this.matchLevel]) {
      return file.pairsByLevel[this.matchLevel];
    }
    return file.pairs;
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────────

  private attachEvents(): void {
    this.appEl.addEventListener("scroll", () => this.onScroll(), { passive: true });

    window.addEventListener("resize", () => {
      if (this.resizeRaf !== null) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = null;
        this.onResize();
      });
    });

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Ignore when typing in an input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    // t — toggle theme
    if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const next = this.theme.name === "dark" ? "solar" : "dark";
      this.setTheme(next);
      this.syncThemeUI();
      return;
    }

    // [ / ] — prev / next file (multi-file mode)
    if (e.key === "[" && !e.metaKey && !e.ctrlKey) {
      this.activateFile(this.currentFileIdx - 1);
      return;
    }
    if (e.key === "]" && !e.metaKey && !e.ctrlKey) {
      this.activateFile(this.currentFileIdx + 1);
      return;
    }

    // Cmd+Shift+X — copy with context
    if ((e.key === "X" || e.key === "x") && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      this.copyWithContext();
      return;
    }
  }

  private copyWithContext(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString();
    if (!text) return;

    // Find which row contains the selection anchor by Y coordinate
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const scrollTop = this.appEl.scrollTop;
    const anchorY = rect.top + scrollTop;

    // Binary search for the row at anchorY
    const row = this.findRowAtY(anchorY);
    const file = this.data.files[this.currentFileIdx];
    const filename = file?.path ?? "";

    let line: number | undefined;
    if (row !== null) {
      const pair = this.currentPairs[row.pairIndex];
      if (pair) {
        if (pair.status === "equal" || pair.status === "modified") line = pair.left?.line;
        else if (pair.status === "added") line = pair.right?.line;
        else if (pair.status === "removed") line = pair.left?.line;
        else if (pair.status === "split") line = pair.original?.line;
      }
    }

    const location = line !== undefined ? `${filename}:${line}` : filename;
    const dir = this.data.meta.projectRoot ?? "";
    const command = this.data.meta.command ? `$ cd ${dir} && md-diff ${this.data.meta.command}` : "";
    const parts = [command, location, text].filter(Boolean);
    const full = parts.join("\n");

    // navigator.clipboard fails on file:// protocol — use execCommand fallback
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(full).catch(() => this.copyFallback(full));
    } else {
      this.copyFallback(full);
    }
  }

  private copyFallback(text: string): void {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }

  private findRowAtY(y: number): RowHeight | null {
    let lo = 0;
    let hi = this.rowHeights.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const row = this.rowHeights[mid];
      if (y < row.y) {
        hi = mid - 1;
      } else if (y > row.y + row.height) {
        lo = mid + 1;
      } else {
        return row;
      }
    }
    return null;
  }

  // ─── Header UI ───────────────────────────────────────────────────────────────

  /** Wire event listeners onto server-rendered HTML elements */
  private buildUI(): void {
    this.wireHeader();
    this.wireSettingsPanel();
    if (this.data.files.length > 1) {
      this.wireSidebar();
    }
  }

  /** Wire click handlers onto the server-rendered header buttons */
  private wireHeader(): void {
    document.getElementById("themeToggle")?.addEventListener("click", () => {
      this.setTheme(this.theme.name === "dark" ? "solar" : "dark");
    });
    document.getElementById("settingsToggle")?.addEventListener("click", () => {
      const panel = document.getElementById("settingsPanel");
      if (panel) panel.style.display = panel.style.display === "none" ? "" : "none";
    });
  }

  /** Wire change handlers onto the server-rendered settings panel */
  private wireSettingsPanel(): void {
    document.getElementById("settingsClose")?.addEventListener("click", () => {
      const panel = document.getElementById("settingsPanel");
      if (panel) panel.style.display = "none";
    });

    const themeSelect = document.getElementById("themeSelect") as HTMLSelectElement | null;
    themeSelect?.addEventListener("change", () => this.setTheme(themeSelect.value as "dark" | "solar"));

    const fontRange = document.getElementById("fontSizeRange") as HTMLInputElement | null;
    const fontValue = document.getElementById("fontSizeValue");
    fontRange?.addEventListener("input", () => {
      this.setFontSize(Number(fontRange.value));
      if (fontValue) fontValue.textContent = fontRange.value + "px";
    });

    const matchSelect = document.getElementById("matchLevelSelect") as HTMLSelectElement | null;
    matchSelect?.addEventListener("change", () => this.setMatchLevel(matchSelect.value as MatchingLevel));
  }

  /** Wire click handlers onto the server-rendered file sidebar */
  private wireSidebar(): void {
    const fileList = document.getElementById("fileList");
    if (!fileList) return;

    fileList.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(".file-item");
      if (!item) return;
      const idx = Number(item.dataset.fileIdx);
      if (!isNaN(idx)) this.activateFile(idx);
    });

    fileList.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        this.activateFile(this.currentFileIdx + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        this.activateFile(this.currentFileIdx - 1);
      }
    });

    // Resize handle
    const handle = document.getElementById("sidebarResize");
    const sidebar = document.getElementById("fileSidebar");
    if (handle && sidebar) this.setupSidebarResize(handle, sidebar);
  }

  private setupSidebarResize(handle: HTMLElement, sidebar: HTMLElement): void {
    let dragging = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const w = Math.max(120, Math.min(400, startW + e.clientX - startX));
      document.body.style.setProperty("--sidebar-width", w + "px");
      this.onResize();
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  }

  private updateSidebarSelection(): void {
    document.querySelectorAll<HTMLElement>("#fileList .file-item").forEach((item) => {
      const idx = Number(item.dataset.fileIdx);
      item.classList.toggle("active", idx === this.currentFileIdx);
      if (idx === this.currentFileIdx) item.scrollIntoView({ block: "nearest" });
    });

    const pathEl = document.querySelector<HTMLElement>(".current-file-path");
    if (pathEl) pathEl.textContent = this.data.files[this.currentFileIdx]?.path ?? "";
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Called from the HTML shell's inline script.
 * Reads the DIFF_DATA global and creates the DiffApp.
 */
export function boot(): void {
  const el = document.getElementById("diff-data");
  if (!el?.textContent) {
    document.body.textContent = "Error: diff-data element not found.";
    return;
  }
  const data = JSON.parse(el.textContent) as DiffData;
  new DiffApp(data);
}
