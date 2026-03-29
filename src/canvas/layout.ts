/**
 * Layout Engine — computes absolute (x, y, w, h) positions for all visual elements.
 *
 * Uses LayoutSession to bundle all layout state. Two passes:
 *   1. Height pass — all blocks, every resize, sub-millisecond
 *   2. Line pass   — visible blocks only, on paint
 */

import type {
  LayoutRow,
  LayoutBlock,
  LayoutLine,
  RowHeight,
  Decoration,
  CanvasTheme,
  FontConfig,
  StyledRun,
} from "./types.js";

import type { SerializedPair, BlockData } from "../serialize/types.js";

import {
  prepareSingleFontBlock,
  prepareMixedFontBlock,
  buildRunsWithDiff,
  buildRunsUniform,
  type PreparedBlock,
  type DiffRunContext,
} from "./measure.js";

import { parseInlineMarkdown } from "./markdown-spans.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const PADDING_H = 16;
const PADDING_V = 8;
const ROW_GAP = 2;
const GUTTER = 8;
const BORDER_WIDTH = 3;

const LONG_PARAGRAPH_WORDS = 20;
const MIN_SHARED_WORDS = 3;
const MIN_SHARED_RATIO = 0.15;

// ─── LayoutSession ──────────────────────────────────────────────────────────

/**
 * Bundles all layout state for a single diff view. Instance-based (not global),
 * so multiple diffs can be laid out concurrently.
 */
export class LayoutSession {
  readonly config: FontConfig;
  readonly theme: CanvasTheme;
  columnWidth: number;

  private blocks = new Map<string, PreparedBlock>();
  private mdCache = new Map<string, StyledRun[]>();

  constructor(config: FontConfig, theme: CanvasTheme, columnWidth: number) {
    this.config = config;
    this.theme = theme;
    this.columnWidth = columnWidth;
  }

  // ─── Block Cache ────────────────────────────────────────────────────────

  private key(i: number, side: "left" | "right"): string {
    return `${i}:${side}`;
  }

  getBlock(i: number, side: "left" | "right"): PreparedBlock {
    const b = this.blocks.get(this.key(i, side));
    if (!b) throw new Error(`Block cache miss: pair ${i} ${side}`);
    return b;
  }

  private setBlock(i: number, side: "left" | "right", b: PreparedBlock): void {
    this.blocks.set(this.key(i, side), b);
  }

  // ─── Markdown Cache ─────────────────────────────────────────────────────

  parseMarkdown(text: string): StyledRun[] {
    let runs = this.mdCache.get(text);
    if (!runs) {
      runs = parseInlineMarkdown(text);
      this.mdCache.set(text, runs);
    }
    return runs;
  }

  // ─── Block Preparation ──────────────────────────────────────────────────

  private prepareBlock(block: BlockData): PreparedBlock {
    const { type, headingLevel, innerText } = block;
    if (type !== "paragraph" && type !== "blockquote" && type !== "list") {
      return prepareSingleFontBlock(innerText, type, headingLevel, this.config, type === "code");
    }
    if (!/[*_`~[]/u.test(innerText)) {
      return prepareSingleFontBlock(innerText, type, headingLevel, this.config);
    }
    const runs = this.parseMarkdown(innerText);
    if (runs.length <= 1) {
      return prepareSingleFontBlock(innerText, type, headingLevel, this.config);
    }
    return prepareMixedFontBlock(runs, type, headingLevel, this.config);
  }

  prepareAllBlocks(pairs: SerializedPair[]): void {
    this.blocks.clear();
    this.mdCache.clear();
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i]!;
      if (p.status === "equal" || p.status === "modified") {
        this.setBlock(i, "left", this.prepareBlock(p.left));
        this.setBlock(i, "right", this.prepareBlock(p.right));
      } else if (p.status === "added") {
        this.setBlock(i, "right", this.prepareBlock(p.right));
      } else if (p.status === "removed") {
        this.setBlock(i, "left", this.prepareBlock(p.left));
      } else if (p.status === "split") {
        this.setBlock(i, "left", this.prepareBlock(p.original));
        this.setBlock(i, "right", this.prepareBlock(p.firstPart));
      }
    }
  }

  // ─── Height ─────────────────────────────────────────────────────────────

  blockHeight(block: PreparedBlock): number {
    const cw = Math.max(1, this.columnWidth - PADDING_H * 2);
    return block.getHeight(cw) + PADDING_V * 2;
  }

  // ─── Build Lines for a Block ────────────────────────────────────────────

  /**
   * Get parallel PreparedRun[] + DiffRunContext[] for a block side.
   * Modified pairs use the inline diff merge. Others get uniform diff status.
   */
  private getRunsAndContexts(
    block: BlockData,
    pair: SerializedPair,
    side: "left" | "right",
  ): { runs: import("./measure.js").PreparedRun[]; contexts: DiffRunContext[] } {
    const styledRuns = this.parseMarkdown(block.innerText);
    const { type, headingLevel } = block;

    // Modified: merge styled runs with inline diff
    if (pair.status === "modified" && pair.inlineDiff.length > 0) {
      return buildRunsWithDiff(styledRuns, pair.inlineDiff, side, type, headingLevel, this.config);
    }
    if (pair.status === "added" && pair.inlineDiff && pair.inlineDiff.length > 0 && side === "right") {
      return buildRunsWithDiff(styledRuns, pair.inlineDiff, side, type, headingLevel, this.config);
    }

    // Non-modified: uniform diff status, no merge needed
    const diffType =
      pair.status === "added"
        ? ("added" as const)
        : pair.status === "removed"
          ? ("removed" as const)
          : ("equal" as const);
    return buildRunsUniform(styledRuns, diffType, type, headingLevel, this.config);
  }

  /** Build a LayoutBlock for one side, vertically centered in the row */
  buildSide(opts: {
    block: BlockData;
    pairIndex: number;
    side: "left" | "right";
    pair: SerializedPair;
    x: number;
    rowY: number;
    rowH: number;
    status: SerializedPair["status"];
    prepared?: PreparedBlock;
  }): LayoutBlock {
    const { block, pairIndex, side, pair, x, rowY, rowH, status, prepared } = opts;
    const pb = prepared ?? this.getBlock(pairIndex, side);
    const h = this.blockHeight(pb);
    const y = rowY + Math.max(0, (rowH - h) / 2);

    // Get runs+contexts (no intermediate DiffStyledRun)
    const { runs, contexts } = this.getRunsAndContexts(block, pair, side);

    // Get lines from PreparedBlock (polymorphic — handles single/mixed font)
    const contentWidth = Math.max(1, this.columnWidth - PADDING_H * 2);
    const rawLines =
      runs.length > 0
        ? pb.getLines(contentWidth, contexts, block.type, this.theme)
        : pb.getLines(contentWidth, [{ diffType: "equal", minor: false }], block.type, this.theme);

    // Position lines absolutely
    let lineY = y + PADDING_V;
    const lines: LayoutLine[] = rawLines.map((line) => {
      const result: LayoutLine = {
        ...line,
        y: lineY,
        segments: line.segments.map((seg) => ({ ...seg, x: x + PADDING_H + seg.x })),
      };
      lineY += line.height;
      return result;
    });

    const { bgColor, borderColor } = blockColors(status, this.theme);
    const decs = buildDecorations(block, x, y, this.columnWidth, h, this.theme);

    return { x, y, width: this.columnWidth, height: h, bgColor, borderColor, lines, decorations: decs, spacer: false };
  }
}

// ─── Side-by-side Decision ──────────────────────────────────────────────────

export function isSideBySide(pair: SerializedPair): boolean {
  if (pair.status === "equal" || pair.status === "split") return true;
  if (pair.status === "modified") {
    const { sharedWords, totalWords } = pair.metrics;
    if (sharedWords === 0) return false;
    if (totalWords >= LONG_PARAGRAPH_WORDS) {
      if (sharedWords < MIN_SHARED_WORDS) return false;
      if (sharedWords / totalWords < MIN_SHARED_RATIO) return false;
    }
    return true;
  }
  return false;
}

// ─── Static Helpers ─────────────────────────────────────────────────────────

function spacerBlock(x: number, y: number, w: number, h: number): LayoutBlock {
  return { x, y, width: w, height: h, bgColor: null, borderColor: null, lines: [], decorations: [], spacer: true };
}

function blockColors(status: SerializedPair["status"], theme: CanvasTheme) {
  if (status === "added") return { bgColor: theme.addedBg, borderColor: theme.addedBorder };
  if (status === "removed") return { bgColor: theme.removedBg, borderColor: theme.removedBorder };
  if (status === "modified") return { bgColor: theme.modifiedBg, borderColor: theme.modifiedBorder };
  return { bgColor: null as string | null, borderColor: null as string | null };
}

function buildDecorations(
  block: BlockData,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: CanvasTheme,
): Decoration[] {
  if (block.type === "blockquote")
    return [
      {
        kind: "line",
        x1: x + BORDER_WIDTH,
        y1: y,
        x2: x + BORDER_WIDTH,
        y2: y + h,
        color: theme.quoteBorder,
        width: 3,
      },
    ];
  if (block.type === "code") return [{ kind: "rect", x, y, w, h, color: theme.codeBg, opacity: 1 }];
  if (block.type === "list")
    return [{ kind: "bullet", x: x + PADDING_H * 0.6, y: y + PADDING_V + 8, radius: 3, color: theme.textColor }];
  return [];
}

// ─── Height Pass ────────────────────────────────────────────────────────────

export function heightPass(session: LayoutSession, pairs: SerializedPair[]): RowHeight[] {
  const rows: RowHeight[] = [];
  let y = 0;

  const push = (h: number, status: SerializedPair["status"], i: number) => {
    rows.push({ y, height: h + ROW_GAP, status, pairIndex: i });
    y += h + ROW_GAP;
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;

    if (p.status === "equal" || (p.status === "modified" && isSideBySide(p))) {
      const h = Math.max(
        session.blockHeight(session.getBlock(i, "left")),
        session.blockHeight(session.getBlock(i, "right")),
      );
      push(h, p.status, i);
    } else if (p.status === "modified") {
      push(session.blockHeight(session.getBlock(i, "left")), "modified", i);
      push(session.blockHeight(session.getBlock(i, "right")), "modified", i);
    } else if (p.status === "added") {
      push(session.blockHeight(session.getBlock(i, "right")), "added", i);
    } else if (p.status === "removed") {
      push(session.blockHeight(session.getBlock(i, "left")), "removed", i);
    } else if (p.status === "split") {
      const firstH = Math.max(
        session.blockHeight(session.getBlock(i, "left")),
        session.blockHeight(session.getBlock(i, "right")),
      );
      push(firstH, "split", i);
      // secondPart not pre-cached; prepare on the fly (pretext caches internally)
      const secondBlock = prepareSingleFontBlock(
        p.secondPart.innerText,
        p.secondPart.type,
        p.secondPart.headingLevel,
        session.config,
      );
      push(secondBlock.getHeight(Math.max(1, session.columnWidth - PADDING_H * 2)) + PADDING_V * 2, "split", i);
    } else {
      throw new Error(`Unknown pair status: ${(p as SerializedPair).status}`);
    }
  }

  return rows;
}

// ─── Line Pass ──────────────────────────────────────────────────────────────

export function linePass(session: LayoutSession, rowHeights: RowHeight[], pairs: SerializedPair[]): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const leftX = 0;
  const rightX = session.columnWidth + GUTTER;
  const cw = session.columnWidth;

  const subRowIndex = new Map<number, number>();

  for (const rh of rowHeights) {
    const prev = subRowIndex.get(rh.pairIndex) ?? 0;
    subRowIndex.set(rh.pairIndex, prev + 1);

    const pair = pairs[rh.pairIndex]!;
    const rowY = rh.y;
    const rowH = rh.height - ROW_GAP;
    const pi = rh.pairIndex;
    const s = pair.status;

    const side = (
      block: BlockData,
      sd: "left" | "right",
      x: number,
      st: SerializedPair["status"],
      prep?: PreparedBlock,
    ) => session.buildSide({ block, pairIndex: pi, side: sd, pair, x, rowY, rowH, status: st, prepared: prep });
    const sL = () => spacerBlock(leftX, rowY, cw, rowH);
    const sR = () => spacerBlock(rightX, rowY, cw, rowH);
    const emit = (left: LayoutBlock, right: LayoutBlock, st = s) =>
      rows.push({ y: rowY, height: rowH, status: st, pairIndex: pi, leftBlock: left, rightBlock: right });

    if (s === "equal" || (s === "modified" && isSideBySide(pair))) {
      emit(side(pair.left, "left", leftX, s), side(pair.right, "right", rightX, s));
    } else if (s === "modified") {
      if (prev === 0) emit(side(pair.left, "left", leftX, "removed"), sR(), "modified");
      else emit(sL(), side(pair.right, "right", rightX, "added"), "modified");
    } else if (s === "added") {
      emit(sL(), side(pair.right, "right", rightX, "added"));
    } else if (s === "removed") {
      emit(side(pair.left, "left", leftX, "removed"), sR());
    } else if (s === "split") {
      if (prev === 0) {
        emit(side(pair.original, "left", leftX, "split"), side(pair.firstPart, "right", rightX, "split"));
      } else {
        const sp = prepareSingleFontBlock(
          pair.secondPart.innerText,
          pair.secondPart.type,
          pair.secondPart.headingLevel,
          session.config,
        );
        emit(sL(), side(pair.secondPart, "right", rightX, "split", sp));
      }
    }
  }

  return rows;
}
