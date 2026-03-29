/**
 * Colored line breaking — breaks PreparedRun[] + DiffRunContext[] into
 * LayoutLine[] with per-segment colors applied via segment-style.
 *
 * Used by the layout engine for modified pairs where each text segment
 * has a different diff status (equal/added/removed).
 */

import { layoutNextLine, type LayoutCursor } from "@chenglou/pretext";

import type { LayoutLine, BlockType, CanvasTheme, DiffRunContext } from "./types.js";
import { collapsedSpaceWidth, cursorsMatch, LINE_START, type PreparedRun } from "./measure.js";
import { makeSegment } from "./segment-style.js";

export function breakIntoColoredLines(
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
    const segments: import("./types.js").LayoutSegment[] = [];
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
