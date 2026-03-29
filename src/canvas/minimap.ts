/**
 * Module 9: Minimap
 *
 * Renders a scrollable overview of the diff using row height data.
 * Non-equal rows are drawn as colored bars; the current viewport is
 * shown as a semi-transparent indicator rectangle.
 */

import type { RowHeight, CanvasTheme, DiffStatus } from "./types.js";

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number = 1;
  private scrollHandler: ((scrollRatio: number) => void) | null = null;
  private dragging = false;
  /** Offset from click point to viewport indicator center, in ratio units */
  private dragOffset = 0;
  /** Last-painted viewport position as ratio [0,1] */
  private lastVpRatio = 0;
  private lastVpSizeRatio = 0;
  private boundDown: (e: MouseEvent) => void;
  private boundMove: (e: MouseEvent) => void;
  private boundUp: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Minimap: failed to get 2D canvas context");
    this.ctx = ctx;

    const getClickRatio = (e: MouseEvent): number => {
      const rect = this.canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    };

    this.boundDown = (e: MouseEvent) => {
      this.dragging = true;
      const clickRatio = getClickRatio(e);
      const vpTop = this.lastVpRatio;
      const vpBottom = vpTop + this.lastVpSizeRatio;

      if (clickRatio >= vpTop && clickRatio <= vpBottom) {
        // Clicked inside the viewport indicator — anchor, don't jump
        this.dragOffset = clickRatio - (vpTop + this.lastVpSizeRatio / 2);
      } else {
        // Clicked outside — jump to that position
        this.dragOffset = 0;
        this.scrollHandler?.(Math.max(0, Math.min(1, clickRatio)));
      }
      e.preventDefault();
    };

    this.boundMove = (e: MouseEvent) => {
      if (!this.dragging || !this.scrollHandler) return;
      const ratio = getClickRatio(e) - this.dragOffset;
      this.scrollHandler(Math.max(0, Math.min(1, ratio)));
    };

    this.boundUp = () => {
      this.dragging = false;
    };

    this.canvas.addEventListener("mousedown", this.boundDown);
    document.addEventListener("mousemove", this.boundMove);
    document.addEventListener("mouseup", this.boundUp);
  }

  /**
   * Paint the minimap.
   *
   * @param rows        Row height data from the layout height pass.
   * @param totalHeight Total scrollable height in logical pixels.
   * @param viewportTop Current scroll offset in logical pixels.
   * @param viewportHeight Visible viewport height in logical pixels.
   * @param theme       Active canvas theme.
   */
  paint(rows: RowHeight[], totalHeight: number, viewportTop: number, viewportHeight: number, theme: CanvasTheme): void {
    const { ctx, canvas, dpr } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (totalHeight <= 0) return;

    // Logical height of the minimap canvas (CSS pixels mapped to physical via dpr)
    const logicalH = h / dpr;
    const scale = logicalH / totalHeight;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Draw diff bars for non-equal rows
    for (const row of rows) {
      if (row.status === "equal") continue;

      const barY = row.y * scale;
      const barH = Math.max(row.height * scale, 2);
      ctx.fillStyle = this.statusColor(row.status, theme);
      ctx.fillRect(0, barY, canvas.width / dpr, barH);
    }

    // Viewport indicator — clamped to minimap bounds
    const vpW = canvas.width / dpr;
    let vpY = viewportTop * scale;
    let vpH = Math.max(viewportHeight * scale, 4);
    if (vpY + vpH > logicalH) vpH = Math.max(4, logicalH - vpY);

    // Store for drag-anchor calculation
    this.lastVpRatio = vpY / logicalH;
    this.lastVpSizeRatio = vpH / logicalH;
    // Clamp: don't start above top
    if (vpY < 0) { vpH += vpY; vpY = 0; }

    ctx.fillStyle = theme.minimapViewport;
    ctx.fillRect(0, vpY, vpW, vpH);

    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, vpY + 0.5, vpW - 1, vpH - 1);

    ctx.restore();
  }

  /**
   * Resize the canvas, accounting for devicePixelRatio for crisp rendering.
   */
  resize(width: number, height: number): void {
    this.dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Register a callback that fires on click or drag.
   * The callback receives a scroll ratio in [0, 1].
   */
  onClick(callback: (scrollRatio: number) => void): void {
    this.scrollHandler = callback;
  }

  destroy(): void {
    this.canvas.removeEventListener("mousedown", this.boundDown);
    document.removeEventListener("mousemove", this.boundMove);
    document.removeEventListener("mouseup", this.boundUp);
    this.scrollHandler = null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private statusColor(status: DiffStatus, theme: CanvasTheme): string {
    switch (status) {
      case "added":
        return theme.addedBorder;
      case "removed":
        return theme.removedBorder;
      case "modified":
        return theme.modifiedBorder;
      case "split":
        // Split rows contain a modified paragraph — use modified color.
        return theme.modifiedBorder;
      default:
        return theme.mutedText;
    }
  }
}
