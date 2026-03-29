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
  LayoutSegment,
  RowHeight,
  Decoration,
  CanvasTheme,
  FontConfig,
  StyledRun,
  DiffRunContext,
} from "./types.js";

import type { SerializedPair, BlockData, InlinePart } from "../serialize/types.js";

import {
  prepareSingleFontBlock,
  prepareMixedFontBlock,
  type PreparedBlock,
} from "./measure.js";
import { buildFullText, buildCharColors, prepareFullTextBlock } from "./diff-runs.js";
import { segmentColors } from "./segment-style.js";
import type { GeometryLine } from "./measure.js";

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

  // ─── Block Preparation ──────────────────────────────────────────────────

  private prepareBlock(block: BlockData): PreparedBlock {
    const { type, headingLevel, innerText, styledRuns } = block;
    // Single-font: code blocks, or blocks with only one styled run (no formatting)
    if (type === "code" || styledRuns.length <= 1) {
      return prepareSingleFontBlock(innerText, type, headingLevel, this.config, type === "code");
    }
    return prepareMixedFontBlock(styledRuns, type, headingLevel, this.config);
  }

  prepareAllBlocks(pairs: SerializedPair[]): void {
    this.blocks.clear();
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
    const contentWidth = Math.max(1, this.columnWidth - PADDING_H * 2);

    // Check if this pair has inline diff (modified with per-word diff parts)
    const hasInlineDiff =
      (pair.status === "modified" && pair.inlineDiff.length > 0) ||
      (pair.status === "added" && pair.inlineDiff && pair.inlineDiff.length > 0 && side === "right");

    let rawLines: LayoutLine[];
    let pb: PreparedBlock;

    if (hasInlineDiff) {
      // Modified block: BOTH sides render the SAME full text (all diff parts).
      // Each char gets colored: equal=white, own change=colored, other side=transparent.
      // This ensures identical line breaks on both sides.
      const parts = pair.status === "modified" ? pair.inlineDiff : (pair as { inlineDiff: InlinePart[] }).inlineDiff;
      const fullText = buildFullText(parts);
      pb = prepareFullTextBlock(fullText, block.type, block.headingLevel, this.config);
      const charColors = buildCharColors(parts, side, block.type, this.theme);
      const geom = pb.getLines(contentWidth);
      rawLines = applyCharColors(geom, charColors);
    } else {
      // Uniform color — equal, added, or removed block
      pb = prepared ?? this.getBlock(pairIndex, side);
      const geom = pb.getLines(contentWidth);
      const diffType =
        pair.status === "added" ? ("added" as const) : pair.status === "removed" ? ("removed" as const) : ("equal" as const);
      const diff: DiffRunContext = { diffType, minor: false };
      const bareRun: StyledRun = { text: "", bold: false, italic: false, code: false, strikethrough: false };
      const c = segmentColors(diff, bareRun, block.type, this.theme);
      rawLines = geom.map((gl) => ({
        y: 0,
        height: gl.height,
        baseline: gl.height * 0.8,
        segments: gl.segments.map((gs) => ({
          x: 0, width: gs.width, text: gs.text, font: gs.font,
          color: c.color, bgColor: c.bgColor, decoration: "none" as const, opacity: c.opacity,
        })),
      }));
    }

    const h = this.blockHeight(pb);
    const y = rowY + Math.max(0, (rowH - h) / 2);

    // Position lines absolutely
    let lineY = y + PADDING_V;
    const lines: LayoutLine[] = rawLines.map((line) => {
      const positioned: LayoutLine = {
        ...line,
        y: lineY,
        segments: line.segments.map((seg) => ({ ...seg, x: x + PADDING_H + seg.x })),
      };
      lineY += line.height;
      return positioned;
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

// ─── Char-color application ─────────────────────────────────────────────────

interface CharColor {
  color: string;
  bgColor: string | null;
  opacity: number;
}

/**
 * Apply per-character colors to geometry lines.
 * Groups consecutive characters with the same color into one LayoutSegment.
 * The geometry text and charColors must have the same total length.
 */
function applyCharColors(geom: GeometryLine[], charColors: CharColor[]): LayoutLine[] {
  let charIdx = 0;

  return geom.map((gl) => {
    const segments: LayoutSegment[] = [];

    for (const gs of gl.segments) {
      // Walk this segment's characters and group by color
      let runStart = 0;
      let currentColor = charIdx < charColors.length ? charColors[charIdx] : { color: "#d4d4d4", bgColor: null, opacity: 1 };

      for (let i = 0; i <= gs.text.length; i++) {
        const atEnd = i === gs.text.length;
        const nextColor = (!atEnd && charIdx + i < charColors.length)
          ? charColors[charIdx + i]
          : currentColor;

        if (atEnd || nextColor.color !== currentColor.color || nextColor.bgColor !== currentColor.bgColor) {
          const text = gs.text.slice(runStart, i);
          if (text.length > 0) {
            segments.push({
              x: 0, // x is unused — text layer uses inline flow
              width: gs.width * (text.length / gs.text.length), // approximate for canvas bg
              text,
              font: gs.font,
              color: currentColor.color,
              bgColor: currentColor.bgColor,
              decoration: "none",
              opacity: currentColor.opacity,
            });
          }
          runStart = i;
          currentColor = nextColor;
        }
      }

      charIdx += gs.text.length;
    }

    return { y: 0, height: gl.height, baseline: gl.height * 0.8, segments };
  });
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
