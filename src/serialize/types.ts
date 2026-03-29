/**
 * Serialized diff data types — the JSON contract between server (Node.js) and client (browser).
 * The diff pipeline produces DiffPair[] with mdast nodes; the serializer converts them to
 * these plain JSON-safe types for embedding in the HTML shell.
 */
import type { InlinePart } from "../core/inline-diff.js";
import type { DiffMetrics, DiffStatus } from "../core/block-matching.js";
import type { MatchingLevel } from "../config.js";

// Re-export for consumers
export type { InlinePart, DiffMetrics, DiffStatus, MatchingLevel };

/** Top-level data structure embedded as JSON in the HTML shell */
export interface DiffData {
  files: FileDiffData[];
  settings: UISettings;
  meta: {
    leftTitle: string;
    rightTitle: string;
    projectRoot?: string;
    command?: string;
    version: string;
  };
}

export interface UISettings {
  theme?: "dark" | "solar";
  fontSize?: number;
  showMinimap?: boolean;
  matchLevel?: MatchingLevel;
  gapAlign?: boolean;
  showMinor?: boolean;
  mergeMinor?: "off" | "conservative" | "aggressive";
  compact?: boolean;
}

export interface FileDiffData {
  path: string;
  pairs: SerializedPair[];
  pairsByLevel?: Record<MatchingLevel, SerializedPair[]>;
  added?: number;
  removed?: number;
}

export type SerializedPair =
  | { status: "equal"; left: BlockData; right: BlockData }
  | { status: "added"; right: BlockData; moved?: true; inlineDiff?: InlinePart[] }
  | { status: "removed"; left: BlockData }
  | {
      status: "modified";
      left: BlockData;
      right: BlockData;
      inlineDiff: InlinePart[];
      metrics: DiffMetrics;
      wrapTag: string;
    }
  | {
      status: "split";
      original: BlockData;
      firstPart: BlockData;
      secondPart: BlockData;
      splitPoint: number;
    };

export type BlockType = "paragraph" | "heading" | "code" | "blockquote" | "list" | "table" | "html" | "thematicBreak";

export interface BlockData {
  /** Raw markdown text of the block (what blockToText returns) */
  text: string;
  /** Inner text for rendering (no heading # prefix, no code fences) */
  innerText: string;
  /** Block type */
  type: BlockType;
  /** 1-6 for headings */
  headingLevel?: number;
  /** Source line number */
  line?: number;
}
