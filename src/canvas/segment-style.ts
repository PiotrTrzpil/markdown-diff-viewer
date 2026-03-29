/**
 * Segment styling — maps diff state + markdown style to visual properties.
 * Pure rendering logic: no measurement, no layout, no DOM.
 */

import type { StyledRun, BlockType, CanvasTheme, LayoutSegment, DiffRunContext } from "./types.js";
import type { PreparedRun } from "./measure.js";

export interface SegmentColors {
  color: string;
  bgColor: string | null;
  opacity: number;
}

export function segmentColors(
  diff: DiffRunContext,
  run: StyledRun,
  blockType: BlockType,
  theme: CanvasTheme,
): SegmentColors {
  // Equal text: normal color, no highlight
  if (diff.diffType === "equal") {
    let color: string;
    if (blockType === "code") color = theme.codeText;
    else if (blockType === "blockquote") color = theme.quoteText;
    else if (run.link !== undefined) color = theme.linkColor;
    else color = theme.textColor;
    return { color, bgColor: null, opacity: 1 };
  }

  // Changed text: red for removed, green for added
  const color = diff.diffType === "removed" ? theme.removedBorder : theme.addedBorder;
  if (diff.minor) {
    const bgColor = diff.diffType === "removed" ? theme.minorRemovedBg : theme.minorAddedBg;
    return { color, bgColor, opacity: 0.7 };
  }
  const bgColor = diff.diffType === "removed" ? theme.removedTextBg : theme.addedTextBg;
  return { color, bgColor, opacity: 1 };
}

export function makeSegment(
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
