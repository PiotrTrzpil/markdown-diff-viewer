/**
 * Text measurement via pretext — prepares text for height and line passes.
 *
 * The key abstraction is PreparedBlock: a unified interface for blocks
 * regardless of whether they use one font or many. Callers never branch
 * on single-font vs mixed-font — PreparedBlock handles it.
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

import type { StyledRun, FontSpec, FontConfig, BlockType, LayoutLine, LayoutSegment, CanvasTheme } from "./types.js";
import type { InlinePart } from "../serialize/types.js";
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
  const prepared = prepareWithSegments(run.text, canvasFont);
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
  const joined = measureFullWidth(prepareWithSegments("A A", canvasFont));
  const compact = measureFullWidth(prepareWithSegments("AA", canvasFont));
  w = Math.max(0, joined - compact);
  spaceWidthCache.set(canvasFont, w);
  return w;
}

export function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex;
}

// ─── DiffRunContext ─────────────────────────────────────────────────────────

export interface DiffRunContext {
  diffType: "equal" | "added" | "removed";
  minor: boolean;
  absorbLevel?: "stopword" | "single";
}

// ─── Segment Color ──────────────────────────────────────────────────────────

function segmentColors(diff: DiffRunContext, run: StyledRun, blockType: BlockType, theme: CanvasTheme) {
  let color: string;
  if (blockType === "code") color = theme.codeText;
  else if (blockType === "blockquote") color = theme.quoteText;
  else if (run.link !== undefined) color = theme.linkColor;
  else color = theme.textColor;

  if (diff.diffType === "equal") return { color, bgColor: null as string | null, opacity: 1 };
  if (diff.minor) {
    return { color, bgColor: diff.diffType === "removed" ? theme.minorRemovedBg : theme.minorAddedBg, opacity: 0.7 };
  }
  return { color, bgColor: diff.diffType === "removed" ? theme.removedTextBg : theme.addedTextBg, opacity: 1 };
}

function makeSegment(
  run: PreparedRun,
  diff: DiffRunContext,
  x: number,
  width: number,
  text: string,
  blockType: BlockType,
  theme: CanvasTheme,
): LayoutSegment {
  const c = segmentColors(diff, run, blockType, theme);
  return {
    x,
    width,
    text,
    font: run.canvasFont,
    color: c.color,
    bgColor: c.bgColor,
    decoration: run.strikethrough ? "line-through" : run.link !== undefined ? "underline" : "none",
    opacity: c.opacity,
  };
}

// ─── PreparedBlock (unified interface) ──────────────────────────────────────

/**
 * Unified interface for measured blocks. Callers never branch on
 * single-font vs mixed-font — just call getHeight() and getLines().
 */
export interface PreparedBlock {
  /** Fast height computation — pure arithmetic via pretext layout() */
  getHeight(contentWidth: number): number;
  /** Full line-level layout for painting visible blocks */
  getLines(
    contentWidth: number,
    diffContexts: DiffRunContext[],
    blockType: BlockType,
    theme: CanvasTheme,
  ): LayoutLine[];
  /** The dominant font's lineHeight (for approximate calculations) */
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
  const options = isCode ? { whiteSpace: "pre-wrap" as const } : undefined;
  const light = prepare(text, canvasFont, options);
  const rich = prepareWithSegments(text, canvasFont, options);

  return {
    lineHeight: font.lineHeight,
    getHeight(contentWidth: number) {
      return pretextLayout(light, contentWidth, font.lineHeight).height;
    },
    getLines(contentWidth, diffContexts, bt, theme) {
      const result = layoutWithLines(rich, contentWidth, font.lineHeight);
      const diff: DiffRunContext = diffContexts[0] ?? { diffType: "equal", minor: false };
      return result.lines.map((line) => {
        const c = segmentColors(diff, bareRun, bt, theme);
        return {
          y: 0,
          height: font.lineHeight,
          baseline: font.lineHeight * 0.8,
          segments: [
            {
              x: 0,
              width: line.width,
              text: line.text,
              font: canvasFont,
              color: c.color,
              bgColor: c.bgColor,
              decoration: "none" as const,
              opacity: c.opacity,
            },
          ],
        };
      });
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
  const approx = prepare(fullText, dominantFont);
  const lh = preparedRuns[0]?.font.lineHeight ?? 24;

  return {
    lineHeight: lh,
    getHeight(contentWidth: number) {
      return pretextLayout(approx, contentWidth, lh).height;
    },
    getLines(contentWidth, diffContexts, bt, theme) {
      return breakIntoLines(preparedRuns, diffContexts, contentWidth, bt, theme);
    },
  };
}

// ─── breakIntoLines (layoutNextLine loop) ───────────────────────────────────

function breakIntoLines(
  runs: PreparedRun[],
  diffContexts: DiffRunContext[],
  maxWidth: number,
  blockType: BlockType,
  theme: CanvasTheme,
): LayoutLine[] {
  const lines: LayoutLine[] = [];
  const safeWidth = Math.max(1, maxWidth);
  let runIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (runIndex < runs.length) {
    const segments: LayoutSegment[] = [];
    let lineWidth = 0;
    let lineH = 0;
    let remaining = safeWidth;

    lineLoop: while (runIndex < runs.length) {
      const run = runs[runIndex]!;
      const diff = diffContexts[runIndex] ?? { diffType: "equal" as const, minor: false };
      const gap = segments.length > 0 ? collapsedSpaceWidth(run.canvasFont) : 0;

      if (textCursor === null && gap + run.fullWidth <= remaining) {
        segments.push(makeSegment(run, diff, lineWidth + gap, run.fullWidth, run.text, blockType, theme));
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

      segments.push(makeSegment(run, diff, lineWidth + gap, result.width, result.text, blockType, theme));
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
    lines.push({ y: 0, height: lineH, baseline: lineH * 0.8, segments });
  }
  return lines;
}

// ─── Diff+Style Merge ───────────────────────────────────────────────────────

function flattenInlineParts(parts: InlinePart[]): InlinePart[] {
  const flat: InlinePart[] = [];
  for (const part of parts) {
    if (part.children && part.children.length > 0) {
      for (const child of part.children) {
        flat.push({ ...child, minor: child.minor ?? part.minor, absorbLevel: child.absorbLevel ?? part.absorbLevel });
      }
    } else {
      flat.push(part);
    }
  }
  return flat;
}

/**
 * Build parallel PreparedRun[] + DiffRunContext[] from StyledRun[] and InlinePart[].
 * No intermediate DiffStyledRun type — goes directly to what the line breaker needs.
 */
export function buildRunsWithDiff(
  styledRuns: StyledRun[],
  inlineParts: InlinePart[],
  side: "left" | "right",
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
): { runs: PreparedRun[]; contexts: DiffRunContext[] } {
  const flatParts = flattenInlineParts(inlineParts);
  const skipType = side === "left" ? "added" : "removed";
  const runs: PreparedRun[] = [];
  const contexts: DiffRunContext[] = [];

  let runIdx = 0,
    runOffset = 0;
  let partIdx = 0,
    partOffset = 0;

  while (runIdx < styledRuns.length && partIdx < flatParts.length) {
    const run = styledRuns[runIdx];
    const part = flatParts[partIdx];
    const chunkLen = Math.min(run.text.length - runOffset, part.value.length - partOffset);

    if (chunkLen > 0 && part.type !== skipType) {
      const slicedRun: StyledRun = {
        text: run.text.slice(runOffset, runOffset + chunkLen),
        bold: run.bold,
        italic: run.italic,
        code: run.code,
        strikethrough: run.strikethrough,
        ...(run.link !== undefined ? { link: run.link } : {}),
      };
      runs.push(prepareRun(slicedRun, blockType, headingLevel, config));
      contexts.push({
        diffType: part.type,
        minor: part.minor ?? false,
        ...(part.absorbLevel !== undefined ? { absorbLevel: part.absorbLevel } : {}),
      });
    }

    runOffset += chunkLen;
    partOffset += chunkLen;
    if (runOffset >= run.text.length) {
      runIdx++;
      runOffset = 0;
    }
    if (partOffset >= part.value.length) {
      partIdx++;
      partOffset = 0;
    }
  }

  return { runs, contexts };
}

/**
 * Build PreparedRun[] + DiffRunContext[] for a block with uniform diff status
 * (equal, added, or removed — no inline diff needed).
 */
export function buildRunsUniform(
  styledRuns: StyledRun[],
  diffType: "equal" | "added" | "removed",
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
): { runs: PreparedRun[]; contexts: DiffRunContext[] } {
  const runs = styledRuns.map((r) => prepareRun(r, blockType, headingLevel, config));
  const contexts = runs.map(() => ({ diffType, minor: false }));
  return { runs, contexts };
}
