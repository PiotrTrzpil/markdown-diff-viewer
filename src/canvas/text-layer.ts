/**
 * Module 7: Text Layer
 *
 * Places real, selectable DOM text at pre-computed positions. Each LayoutSegment
 * becomes an absolutely-positioned <span>. No CSS layout — the browser just
 * paints glyphs where we tell it.
 *
 * What this gives for free:
 * - Native text selection (click, drag, shift+click, double-click, triple-click)
 * - Native Cmd+F — browser find searches real DOM text
 * - Native Cmd+C — browser copy works on selected text
 * - Screen reader support — real DOM text is accessible
 * - Right-click context menu — native browser context menu
 * - No alignment risk — the text IS the text, not an invisible overlay
 */

import type { LayoutRow, LayoutBlock, Viewport } from "./types.js";

export class TextLayer {
  private container: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute; top:0; left:0; right:0; pointer-events:auto; user-select:text;";
    parent.appendChild(this.container);
  }

  /**
   * Rebuild text spans for visible rows.
   *
   * Performance: ~30 visible rows × 2 blocks × ~3 lines × ~4 segments = ~720
   * <span> elements. All position:absolute — the browser does zero layout
   * computation, just glyph painting.
   */
  update(rows: LayoutRow[], viewport: Viewport): void {
    // Clear previous spans
    this.container.textContent = "";

    const frag = document.createDocumentFragment();

    for (const row of rows) {
      // Skip rows entirely above the viewport
      if (row.y + row.height < viewport.top) continue;
      // Stop once we've passed the bottom of the viewport (rows are sorted by y)
      if (row.y > viewport.bottom) break;

      this.addBlock(row.leftBlock, frag);
      this.addBlock(row.rightBlock, frag);
    }

    this.container.appendChild(frag);
  }

  /** Clean up the container element from the DOM. */
  destroy(): void {
    this.container.remove();
  }

  private addBlock(block: LayoutBlock, frag: DocumentFragment): void {
    // Spacer blocks have no text content
    if (block.spacer) return;

    for (const line of block.lines) {
      for (const seg of line.segments) {
        const span = document.createElement("span");
        // Use textContent (not innerHTML) to avoid XSS and ensure correct rendering
        span.textContent = seg.text;
        span.style.cssText =
          "position:absolute;" +
          `top:${line.y}px;` +
          `left:${seg.x}px;` +
          `font:${seg.font};` +
          `color:${seg.color};` +
          `line-height:${line.height}px;` +
          "white-space:pre;" +
          `opacity:${seg.opacity};`;
        frag.appendChild(span);
      }
    }
  }
}
