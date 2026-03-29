/**
 * Module 3: Font Registry
 *
 * Maps (blockType, headingLevel, styledRun) → FontSpec + canvas font string.
 */

import type { BlockType, FontSpec, FontConfig, StyledRun } from "./types.js";

// ─── Default Config ──────────────────────────────────────────────────────────

export function defaultFontConfig(baseFontSize = 16): FontConfig {
  return {
    baseFontSize,
    fontFamily: "Inter, system-ui, sans-serif",
    monoFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  };
}

// ─── Block Base Styles ───────────────────────────────────────────────────────

interface BlockBase {
  sizeEm: number;
  weight: number;
  italic: boolean;
  mono: boolean;
}

function blockBase(blockType: BlockType, headingLevel: number | undefined): BlockBase {
  switch (blockType) {
    case "heading": {
      const level = headingLevel ?? 1;
      const sizeEm =
        level === 1 ? 1.8 : level === 2 ? 1.4 : level === 3 ? 1.2 : level === 4 ? 1.1 : level === 5 ? 1.0 : 0.9;
      const weight = level <= 2 ? 700 : 600;
      return { sizeEm, weight, italic: false, mono: false };
    }
    case "code":
      return { sizeEm: 0.9, weight: 400, italic: false, mono: true };
    case "blockquote":
      return { sizeEm: 1.0, weight: 400, italic: true, mono: false };
    case "paragraph":
    case "list":
    case "table":
    case "html":
    case "thematicBreak":
    default:
      return { sizeEm: 1.0, weight: 400, italic: false, mono: false };
  }
}

// ─── Line Height ─────────────────────────────────────────────────────────────

function lineHeightFor(blockType: BlockType, mono: boolean, fontSize: number): number {
  if (blockType === "heading") return fontSize * 1.3;
  if (mono || blockType === "code") return fontSize * 1.5;
  return fontSize * 1.6;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve font for a styled run within a block context.
 * Inline modifiers (bold, italic, code) are applied additively on top of the
 * block base style.
 */
export function resolveFont(
  blockType: BlockType,
  headingLevel: number | undefined,
  run: StyledRun,
  config: FontConfig,
): FontSpec {
  const base = blockBase(blockType, headingLevel);

  // Start from block base
  let sizeEm = base.sizeEm;
  let weight = base.weight;
  let italic = base.italic;
  let mono = base.mono;

  // Apply inline modifiers additively
  if (run.bold) weight = Math.max(weight, 700);
  if (run.italic) italic = true;
  if (run.code) {
    mono = true;
    sizeEm *= 0.9;
  }

  const size = sizeEm * config.baseFontSize;
  const family = mono ? config.monoFamily : config.fontFamily;
  const lineHeight = lineHeightFor(blockType, mono, size);

  return {
    family,
    size,
    weight,
    style: italic ? "italic" : "normal",
    lineHeight,
  };
}

/**
 * Convert a FontSpec to a CSS/canvas font string.
 * Format: "<style> <weight> <size>px <family>"
 * e.g. "bold italic 16px Inter, system-ui, sans-serif"
 *
 * Note: canvas `ctx.font` uses the CSS font shorthand — style and weight must
 * come before the size/family. Weight is expressed as a numeric value which
 * canvas supports in all modern browsers.
 */
export function toCanvasFont(spec: FontSpec): string {
  const parts: string[] = [];
  if (spec.style === "italic") parts.push("italic");
  if (spec.weight !== 400) parts.push(String(spec.weight));
  parts.push(`${spec.size}px`);
  parts.push(spec.family);
  return parts.join(" ");
}
