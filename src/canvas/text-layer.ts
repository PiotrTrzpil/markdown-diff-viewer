/**
 * Text Layer — real selectable DOM text at pretext-computed positions.
 *
 * Each LayoutLine → one absolutely-positioned div with inline spans.
 * pretext does ALL line breaking. Browser just renders glyphs.
 *
 * Data attributes for testing/debugging:
 * - div[data-line-y]: Y position of the line
 * - div[data-block-x]: X position of the containing block
 * - div[data-side]: "left" or "right" (derived from block.x position)
 * - span[data-diff]: "removed" | "added" | "minor" (only on colored spans)
 */

import type { LayoutRow, LayoutBlock, Viewport } from "./types.js";

export class TextLayer {
  private container: HTMLDivElement;
  private columnWidth = 0;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute; top:0; left:0; right:0; pointer-events:auto; user-select:text;";
    parent.appendChild(this.container);
  }

  update(rows: LayoutRow[], viewport: Viewport): void {
    this.container.textContent = "";
    const frag = document.createDocumentFragment();

    for (const row of rows) {
      if (row.y + row.height < viewport.top) continue;
      if (row.y > viewport.bottom) break;
      this.addBlock(row.leftBlock, "left", frag);
      this.addBlock(row.rightBlock, "right", frag);
    }

    this.container.appendChild(frag);
  }

  destroy(): void {
    this.container.remove();
  }

  private addBlock(block: LayoutBlock, side: "left" | "right", frag: DocumentFragment): void {
    if (block.spacer) return;

    for (const line of block.lines) {
      const div = document.createElement("div");
      div.style.cssText =
        "position:absolute; white-space:pre; overflow:hidden;" +
        `top:${line.y}px;` +
        `left:${block.x}px;` +
        `width:${block.width}px;` +
        `line-height:${line.height}px;` +
        `height:${line.height}px;` +
        `padding-left:${(line.segments[0]?.x ?? block.x) - block.x}px;`;

      div.dataset.lineY = String(Math.round(line.y));
      div.dataset.side = side;

      for (const seg of line.segments) {
        const span = document.createElement("span");
        span.textContent = seg.text;

        const isTransparent = seg.color === "transparent";
        let css = `font:${seg.font};color:${seg.color};`;
        if (seg.bgColor && !isTransparent) css += `background-color:${seg.bgColor};`;
        if (seg.opacity < 1 && !isTransparent) css += `opacity:${seg.opacity};`;
        span.style.cssText = css;

        // Tag non-equal spans with diff status for testing
        const isDefault = seg.color === "rgb(212, 212, 212)" || seg.color === "#d4d4d4" || seg.color === "transparent";
        if (!isDefault) {
          span.dataset.diff = seg.color.includes("115") || seg.color.includes("d47380") ? "removed" : "added";
        }

        div.appendChild(span);
      }

      frag.appendChild(div);
    }
  }
}
