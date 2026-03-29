/**
 * Module 6: Canvas Painter
 *
 * Paints background rectangles to a canvas. NO TEXT — text is handled by the
 * DOM text layer. The canvas draws: block backgrounds, inline diff highlights,
 * borders, decorations (blockquote bars, code block backgrounds, list bullets),
 * strikethrough lines, and the center divider.
 */

import type { LayoutRow, LayoutBlock, Decoration, CanvasTheme, Viewport } from "./types.js";

export class DiffPainter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.dpr = window.devicePixelRatio || 1;
  }

  /**
   * Resize the canvas backing store to match CSS size, accounting for
   * devicePixelRatio for crisp rendering on HiDPI / Retina screens.
   */
  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Paint visible rows — backgrounds and decorations only.
   * Text is never drawn here; the DOM text layer handles all glyphs.
   */
  paint(rows: LayoutRow[], viewport: Viewport, theme: CanvasTheme): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const logicalWidth = this.canvas.width / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear only the viewport band
    ctx.clearRect(0, viewport.top, logicalWidth, viewport.bottom - viewport.top);

    // Center divider line
    const centerX = logicalWidth / 2;
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, viewport.top);
    ctx.lineTo(centerX, viewport.bottom);
    ctx.stroke();

    for (const row of rows) {
      if (row.y + row.height < viewport.top) continue;
      if (row.y > viewport.bottom) break;

      this.paintBlock(row.leftBlock, ctx);
      this.paintBlock(row.rightBlock, ctx);
    }

    ctx.restore();
  }

  private paintBlock(block: LayoutBlock, ctx: CanvasRenderingContext2D): void {
    if (block.spacer) return;

    // Block background (added / removed / modified)
    if (block.bgColor) {
      ctx.fillStyle = block.bgColor;
      ctx.fillRect(block.x, block.y, block.width, block.height);
    }

    // Left border strip (3px wide)
    if (block.borderColor) {
      ctx.fillStyle = block.borderColor;
      ctx.fillRect(block.x, block.y, 3, block.height);
    }

    // Decorations: blockquote bars, code block backgrounds, list bullets
    for (const dec of block.decorations) {
      this.paintDecoration(dec, ctx);
    }

    // Inline diff highlights (background-color, strikethrough) are handled
    // by the DOM text layer's <span> elements — not canvas.
    // This ensures perfect alignment between text and its background.
  }

  private paintDecoration(dec: Decoration, ctx: CanvasRenderingContext2D): void {
    if (dec.kind === "rect") {
      ctx.globalAlpha = dec.opacity ?? 1;
      ctx.fillStyle = dec.color;
      ctx.fillRect(dec.x, dec.y, dec.w, dec.h);
      ctx.globalAlpha = 1;
    } else if (dec.kind === "line") {
      ctx.strokeStyle = dec.color;
      ctx.lineWidth = dec.width;
      ctx.beginPath();
      ctx.moveTo(dec.x1, dec.y1);
      ctx.lineTo(dec.x2, dec.y2);
      ctx.stroke();
    } else if (dec.kind === "bullet") {
      ctx.fillStyle = dec.color;
      ctx.beginPath();
      ctx.arc(dec.x, dec.y, dec.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
