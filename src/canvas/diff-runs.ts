/**
 * Diff coloring for modified blocks.
 *
 * Architecture: both sides render the SAME full text (all inline parts
 * concatenated). Each character gets a color based on its diff status:
 *   - equal → normal text color
 *   - own side's change (removed on left, added on right) → red/green
 *   - other side's change (added on left, removed on right) → transparent
 *
 * This ensures both sides have identical line breaks (same text, same width).
 * The "invisible" text from the other side takes up space, maintaining alignment.
 */

import type { StyledRun, FontConfig, BlockType, DiffRunContext, CanvasTheme } from "./types.js";
import type { InlinePart } from "../serialize/types.js";
import { prepareRun, prepareSingleFontBlock, type PreparedRun, type PreparedBlock } from "./measure.js";
import { segmentColors } from "./segment-style.js";
import type { GeometryLine } from "./measure.js";

/** Color info for one character */
interface CharColor {
  color: string;
  bgColor: string | null;
  opacity: number;
}

/**
 * Build the full text from all inline parts (both sides combined).
 * This is what pretext will measure and line-break.
 */
export function buildFullText(parts: InlinePart[]): string {
  return parts.map((p) => {
    if (p.children && p.children.length > 0) {
      return p.children.map((c) => c.value).join("");
    }
    return p.value;
  }).join("");
}

/**
 * Build a per-character color array for one side.
 * equal → white, own change → colored, other side → transparent.
 */
export function buildCharColors(
  parts: InlinePart[],
  side: "left" | "right",
  blockType: BlockType,
  theme: CanvasTheme,
): CharColor[] {
  const skipType = side === "left" ? "added" : "removed";
  const bareRun: StyledRun = { text: "", bold: false, italic: false, code: false, strikethrough: false };
  const equalColor = segmentColors({ diffType: "equal", minor: false }, bareRun, blockType, theme);
  const transparentColor: CharColor = { color: "transparent", bgColor: null, opacity: 1 };

  const chars: CharColor[] = [];

  for (const part of parts) {
    if (part.children && part.children.length > 0) {
      // Minor pair with char-level children
      // Parent type determines side visibility
      for (const child of part.children) {
        const isOtherSide = part.type === skipType;
        const childColor = isOtherSide
          ? transparentColor
          : (() => {
              // Within our side: use child's type for color precision
              const childType = child.type === skipType ? part.type : child.type;
              const c = segmentColors({ diffType: childType, minor: true }, bareRun, blockType, theme);
              return { color: c.color, bgColor: c.bgColor, opacity: c.opacity };
            })();

        for (let i = 0; i < child.value.length; i++) {
          chars.push(childColor);
        }
      }
    } else if (part.type === skipType) {
      // Other side's text — render transparent to maintain spacing
      for (let i = 0; i < part.value.length; i++) {
        chars.push(transparentColor);
      }
    } else if (part.type === "equal") {
      const c = equalColor;
      for (let i = 0; i < part.value.length; i++) {
        chars.push({ color: c.color, bgColor: c.bgColor, opacity: c.opacity });
      }
    } else {
      // Own side's change — colored
      const c = segmentColors({ diffType: part.type, minor: part.minor ?? false }, bareRun, blockType, theme);
      for (let i = 0; i < part.value.length; i++) {
        chars.push({ color: c.color, bgColor: c.bgColor, opacity: c.opacity });
      }
    }
  }

  return chars;
}

/**
 * Prepare a PreparedBlock for the full text of a modified pair.
 * Both sides use the same block (same text, same line breaks).
 */
export function prepareFullTextBlock(
  fullText: string,
  blockType: BlockType,
  headingLevel: number | undefined,
  config: FontConfig,
): PreparedBlock {
  return prepareSingleFontBlock(fullText, blockType, headingLevel, config);
}

/**
 * Build PreparedRun[] + DiffRunContext[] for a block with uniform diff status.
 * For equal/added/removed pairs — no inline diff.
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
