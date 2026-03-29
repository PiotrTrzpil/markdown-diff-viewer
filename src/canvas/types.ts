/**
 * Shared types for the canvas renderer.
 * All layout, painting, and text layer modules consume these types.
 */
import type { DiffStatus, BlockType, BlockData } from "../serialize/types.js";

// Re-export for convenience
export type { DiffStatus, BlockType, BlockData };

// ─── Styled Text Runs ───────────────────────────────────────────────────────

/** A contiguous text span with uniform inline markdown styling */
export interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link?: string;
}

// ─── Diff Run Context ───────────────────────────────────────────────────────

/** Per-run diff status — parallel to PreparedRun[] */
export interface DiffRunContext {
  diffType: "equal" | "added" | "removed";
  minor: boolean;
  absorbLevel?: "stopword" | "single";
}

// ─── Font Types ─────────────────────────────────────────────────────────────

export interface FontSpec {
  family: string;
  size: number;
  weight: number;
  style: "normal" | "italic";
  lineHeight: number;
}

export interface FontConfig {
  baseFontSize: number;
  fontFamily: string;
  monoFamily: string;
}

// ─── Layout Output Types ────────────────────────────────────────────────────

/** Row heights from the fast height pass (no line details) */
export interface RowHeight {
  y: number;
  height: number;
  status: DiffStatus;
  pairIndex: number;
}

/** Full layout row with line-level detail (from the line pass) */
export interface LayoutRow {
  y: number;
  height: number;
  status: DiffStatus;
  leftBlock: LayoutBlock;
  rightBlock: LayoutBlock;
  pairIndex: number;
}

export interface LayoutBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  bgColor: string | null;
  borderColor: string | null;
  lines: LayoutLine[];
  decorations: Decoration[];
  spacer: boolean;
}

export interface LayoutLine {
  y: number;
  height: number;
  baseline: number;
  segments: LayoutSegment[];
}

export interface LayoutSegment {
  x: number;
  width: number;
  text: string;
  font: string;
  color: string;
  bgColor: string | null;
  decoration: "none" | "line-through" | "underline";
  opacity: number;
}

export type Decoration =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; opacity?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: "bullet"; x: number; y: number; radius: number; color: string };

// ─── Theme ──────────────────────────────────────────────────────────────────

export interface CanvasTheme {
  name: "dark" | "solar";

  bg: string;
  paneBg: string;
  textColor: string;
  mutedText: string;

  headingColors: [string, string, string, string, string, string];

  addedBg: string;
  addedBorder: string;
  addedTextBg: string;
  removedBg: string;
  removedBorder: string;
  removedTextBg: string;
  modifiedBg: string;
  modifiedBorder: string;

  minorAddedBg: string;
  minorRemovedBg: string;

  border: string;
  scrollThumb: string;
  minimapViewport: string;

  codeBg: string;
  codeText: string;
  quoteBorder: string;
  quoteText: string;
  linkColor: string;
}

// ─── Viewport ───────────────────────────────────────────────────────────────

export interface Viewport {
  top: number;
  bottom: number;
}
