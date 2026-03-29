/**
 * Text measurement via pretext — prepares text for height and line passes.
 * Pure measurement: no colors, no themes, no rendering concerns.
 */

import {
  prepare,
  layout as pretextLayout,
  prepareWithSegments,
  layoutWithLines,
  layoutNextLine,
  walkLineRanges,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from "@chenglou/pretext";

import type { StyledRun, FontSpec, FontConfig, BlockType } from "./types.js";
import { resolveFont, toCanvasFont } from "./fonts.js";

// ─── Constants ──────────────────────────────────────────────────────────────

export const LINE_START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
export const UNBOUNDED = 100_000;

// ─── PreparedRun ────────────────────────────────────────────────────────────

export interface PreparedRun extends StyledRun {
  font: FontSpec;
  canvasFont: string;
  prepared: PreparedTextWithSegments;
  fullWidth: number;
  endCursor: LayoutCursor;
}

export function prepareRun(
  run: StyledRun,
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
): PreparedRun {
  const font = resolveFont(blockType, headingLevel, run, config);
  const canvasFont = toCanvasFont(font);
  const prepared = prepareWithSegments(run.text, canvasFont, { whiteSpace: "pre-wrap" });
  const wholeLine = layoutNextLine(prepared, LINE_START, UNBOUNDED);
  return {
    ...run,
    font,
    canvasFont,
    prepared,
    fullWidth: wholeLine?.width ?? 0,
    endCursor: wholeLine?.end ?? LINE_START,
  };
}

// ─── Width / Space Helpers ──────────────────────────────────────────────────

export function measureFullWidth(prepared: PreparedTextWithSegments): number {
  let w = 0;
  walkLineRanges(prepared, UNBOUNDED, (line) => {
    w = line.width;
  });
  return w;
}

const spaceWidthCache = new Map<string, number>();

export function collapsedSpaceWidth(canvasFont: string): number {
  let w = spaceWidthCache.get(canvasFont);
  if (w !== undefined) return w;
  const opts = { whiteSpace: "pre-wrap" as const };
  const joined = measureFullWidth(prepareWithSegments("A A", canvasFont, opts));
  const compact = measureFullWidth(prepareWithSegments("AA", canvasFont, opts));
  w = Math.max(0, joined - compact);
  spaceWidthCache.set(canvasFont, w);
  return w;
}

export function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex;
}

// ─── GeometryLine (unstyled line output from PreparedBlock) ─────────────────

/** A line of text with geometry only — no colors. */
export interface GeometrySegment {
  text: string;
  width: number;
  font: string;
  lineHeight: number;
}

export interface GeometryLine {
  segments: GeometrySegment[];
  height: number;
}

// ─── PreparedBlock (unified interface) ──────────────────────────────────────

/**
 * Unified interface for measured blocks.
 * Returns pure geometry — no colors, no theme knowledge.
 */
export interface PreparedBlock {
  getHeight(contentWidth: number): number;
  /** Get line geometry. Returns text + width + font per segment, no colors. */
  getLines(contentWidth: number): GeometryLine[];
  lineHeight: number;
}

/** Single-font block: headings, code, plain paragraphs */
export function prepareSingleFontBlock(
  text: string,
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
  isCode = false,
): PreparedBlock {
  const bareRun: StyledRun = { text, bold: false, italic: false, code: false, strikethrough: false };
  const font = resolveFont(blockType, headingLevel, bareRun, config);
  const canvasFont = toCanvasFont(font);
  // Always use pre-wrap so geometry text exactly matches blockPlainText / diff text.
  // Normal mode collapses whitespace, causing char-count mismatch with diff parts.
  const options = { whiteSpace: "pre-wrap" as const };
  const light = prepare(text, canvasFont, options);
  const rich = prepareWithSegments(text, canvasFont, options);

  return {
    lineHeight: font.lineHeight,
    getHeight(contentWidth: number) {
      return pretextLayout(light, contentWidth, font.lineHeight).height;
    },
    getLines(contentWidth) {
      const result = layoutWithLines(rich, contentWidth, font.lineHeight);
      return result.lines.map((line) => ({
        height: font.lineHeight,
        segments: [{ text: line.text, width: line.width, font: canvasFont, lineHeight: font.lineHeight }],
      }));
    },
  };
}

/** Mixed-font block: paragraphs with bold, italic, code spans */
export function prepareMixedFontBlock(
  runs: StyledRun[],
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
): PreparedBlock {
  const preparedRuns = runs.map((r) => prepareRun(r, blockType, headingLevel, config));
  const dominantFont =
    preparedRuns[0]?.canvasFont ??
    toCanvasFont(
      resolveFont(
        blockType,
        headingLevel,
        { text: "", bold: false, italic: false, code: false, strikethrough: false },
        config,
      ),
    );
  const fullText = runs.map((r) => r.text).join(" ");
  const approx = prepare(fullText, dominantFont, { whiteSpace: "pre-wrap" });
  const lh = preparedRuns[0]?.font.lineHeight ?? 24;

  return {
    lineHeight: lh,
    getHeight(contentWidth: number) {
      return pretextLayout(approx, contentWidth, lh).height;
    },
    getLines(contentWidth) {
      // Use breakIntoLines without colors — just geometry
      return breakIntoGeometryLines(preparedRuns, contentWidth);
    },
  };
}

// ─── Geometry-only line breaking ────────────────────────────────────────────

/** Break prepared runs into geometry lines (no colors). Used by mixed-font PreparedBlock. */
function breakIntoGeometryLines(runs: PreparedRun[], maxWidth: number): GeometryLine[] {
  const lines: GeometryLine[] = [];
  const safeWidth = Math.max(1, maxWidth);
  let runIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (runIndex < runs.length) {
    const segments: GeometrySegment[] = [];
    let lineWidth = 0;
    let lineH = 0;
    let remaining = safeWidth;

    lineLoop: while (runIndex < runs.length) {
      const run = runs[runIndex]!;
      const gap = segments.length > 0 ? collapsedSpaceWidth(run.canvasFont) : 0;

      if (textCursor === null && gap + run.fullWidth <= remaining) {
        segments.push({ text: run.text, width: run.fullWidth, font: run.canvasFont, lineHeight: run.font.lineHeight });
        lineWidth += gap + run.fullWidth;
        remaining = safeWidth - lineWidth;
        lineH = Math.max(lineH, run.font.lineHeight);
        runIndex++;
        continue;
      }

      const start = textCursor ?? LINE_START;
      const result = layoutNextLine(run.prepared, start, Math.max(1, remaining - gap));
      if (result === null || cursorsMatch(start, result.end)) {
        runIndex++;
        textCursor = null;
        continue;
      }

      segments.push({ text: result.text, width: result.width, font: run.canvasFont, lineHeight: run.font.lineHeight });
      lineWidth += gap + result.width;
      lineH = Math.max(lineH, run.font.lineHeight);

      if (cursorsMatch(result.end, run.endCursor)) {
        runIndex++;
        textCursor = null;
        remaining = safeWidth - lineWidth;
        continue;
      }
      textCursor = result.end;
      break lineLoop;
    }

    if (segments.length === 0) break;
    lines.push({ height: lineH, segments });
  }
  return lines;
}

// Re-export for consumers
export { buildRunsUniform } from "./diff-runs.js";
