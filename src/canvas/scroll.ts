/**
 * Module 8 — Virtual Scroll
 *
 * Efficient scrolling: binary search for the first visible row, overscan of 3
 * rows above/below, and a sentinel div that drives the container's scroll height.
 */
import type { RowHeight } from "./types.js";

export class VirtualScroll {
  private container: HTMLDivElement;
  private sentinel: HTMLDivElement;
  private rowPositions: Array<{ y: number; height: number }>;
  private scrollHeight: number;

  constructor(container: HTMLDivElement, rowHeights: RowHeight[]) {
    this.container = container;
    this.rowPositions = rowHeights.map((r) => ({ y: r.y, height: r.height }));
    this.scrollHeight = VirtualScroll.computeTotalHeight(rowHeights);

    // Sentinel div: gives the container its scroll height without occupying
    // meaningful layout space.
    const sentinel = document.createElement("div");
    sentinel.style.position = "absolute";
    sentinel.style.top = "0";
    sentinel.style.left = "0";
    sentinel.style.width = "1px";
    sentinel.style.visibility = "hidden";
    sentinel.style.pointerEvents = "none";
    sentinel.style.height = `${this.scrollHeight}px`;
    container.appendChild(sentinel);
    this.sentinel = sentinel;
  }

  /**
   * Returns the half-open [start, end) index range of rows that should be
   * rendered for the given scroll position and viewport height.
   *
   * Overscan: 3 extra rows above and below the visible band.
   */
  getVisibleRange(scrollTop: number, viewportHeight: number): { start: number; end: number } {
    const bottom = scrollTop + viewportHeight;

    // First row whose bottom edge reaches into the viewport
    let start = this.binarySearch(scrollTop);
    start = Math.max(0, start - 3);

    // Walk forward until we pass the bottom of the viewport
    let end = start;
    while (end < this.rowPositions.length && this.rowPositions[end].y < bottom) {
      end++;
    }
    end = Math.min(this.rowPositions.length, end + 3);

    return { start, end };
  }

  /**
   * Called after a resize or relayout that may have changed row heights/positions.
   * Updates internal state and resizes the sentinel div.
   */
  updatePositions(rowHeights: RowHeight[]): void {
    this.rowPositions = rowHeights.map((r) => ({ y: r.y, height: r.height }));
    this.scrollHeight = VirtualScroll.computeTotalHeight(rowHeights);
    this.sentinel.style.height = `${this.scrollHeight}px`;
  }

  /** Total scrollable height in pixels. */
  getTotalHeight(): number {
    return this.scrollHeight;
  }

  /** Remove the sentinel div from the container. */
  destroy(): void {
    if (this.sentinel.parentNode === this.container) {
      this.container.removeChild(this.sentinel);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Binary search: returns the index of the first row whose bottom edge is
   * at or beyond `targetY` (i.e. the first row that intersects or follows the
   * top of the viewport).
   */
  private binarySearch(targetY: number): number {
    let lo = 0;
    let hi = this.rowPositions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rowBottom = this.rowPositions[mid].y + this.rowPositions[mid].height;
      if (rowBottom <= targetY) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  private static computeTotalHeight(rowHeights: RowHeight[]): number {
    if (rowHeights.length === 0) return 0;
    const last = rowHeights[rowHeights.length - 1];
    return last.y + last.height;
  }
}
