/**
 * Host-facing, JSON-serializable diff document.
 *
 * mdast / RootContent stay internal to the engine. Embedders (React hosts,
 * APIs, tests) consume this model instead of AST nodes or HTML strings.
 */

import type { RootContent } from "mdast";
import type {
  DiffMetrics,
  DiffPair,
} from "../core/block-matching.js";
import type { InlinePart } from "../core/inline-part.js";
import { blockToText, getWrapTag } from "../text/parse.js";

/** Coarse block kind for host renderers (mirrors common mdast top-level types) */
export type BlockKind =
  | "heading"
  | "paragraph"
  | "code"
  | "list"
  | "blockquote"
  | "thematicBreak"
  | "html"
  | "table"
  | "other";

/**
 * One side of a diff block: stable markdown source plus light metadata.
 * Hosts can re-parse `markdown` with their own renderer (e.g. react-markdown).
 */
export interface BlockSide {
  /** Stable serialization of the block (suitable for re-parse / display source) */
  markdown: string;
  kind: BlockKind;
  /** Semantic HTML wrapper hint: h1–h6, p, pre, ul, blockquote, div, … */
  wrapTag: string;
  /** 1-based source line when available from the parser */
  line?: number;
  /** Heading depth (1–6) when kind is heading */
  depth?: number;
  /** Fenced code language when kind is code */
  lang?: string | null;
}

export type DiffBlock =
  | {
      status: "equal";
      left: BlockSide;
      right: BlockSide;
    }
  | {
      status: "added";
      right: BlockSide;
      /** True if this block is relocated text (same content, different place). */
      moved?: true;
      /** Optional inline parts (e.g. paragraph-split markers) */
      inline?: InlinePart[];
      /** Required when `moved`. Partner is the other block with this id. */
      moveId?: number;
    }
  | {
      status: "removed";
      left: BlockSide;
      /** True if this block is relocated text (same content, different place). */
      moved?: true;
      /** Inline diff vs the destination when this block was moved and also edited. */
      inline?: InlinePart[];
      /** Required when `moved`. Partner is the other block with this id. */
      moveId?: number;
    }
  | {
      status: "modified";
      left: BlockSide;
      right: BlockSide;
      inline: InlinePart[];
      metrics: DiffMetrics;
      /** HTML tag to wrap inline-diffed content (from the left block) */
      wrapTag: string;
    }
  | {
      status: "split";
      original: BlockSide;
      first: BlockSide;
      second: BlockSide;
      /** Character index in original markdown where the split occurs */
      splitPoint: number;
    };

/** Serializable document produced by the engine */
export interface DiffDocument {
  blocks: DiffBlock[];
}

export function blockKindFromNode(node: RootContent): BlockKind {
  switch (node.type) {
    case "heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "code":
      return "code";
    case "list":
      return "list";
    case "blockquote":
      return "blockquote";
    case "thematicBreak":
      return "thematicBreak";
    case "html":
      return "html";
    case "table":
      return "table";
    default:
      return "other";
  }
}

/** Project an mdast block into a host-facing {@link BlockSide}. */
export function toBlockSide(node: RootContent): BlockSide {
  const side: BlockSide = {
    markdown: blockToText(node),
    kind: blockKindFromNode(node),
    wrapTag: getWrapTag(node),
  };

  const line = node.position?.start?.line;
  if (line !== undefined) side.line = line;

  if (node.type === "heading") {
    side.depth = node.depth;
  }
  if (node.type === "code") {
    side.lang = node.lang ?? null;
  }

  return side;
}

/** Project internal {@link DiffPair}s into a serializable {@link DiffDocument}. */
export function projectPairsToDocument(pairs: DiffPair[]): DiffDocument {
  const blocks: DiffBlock[] = pairs.map(projectPair);
  return { blocks };
}

function projectPair(pair: DiffPair): DiffBlock {
  switch (pair.status) {
    case "equal":
      return {
        status: "equal",
        left: toBlockSide(pair.left),
        right: toBlockSide(pair.right),
      };
    case "added": {
      const block: Extract<DiffBlock, { status: "added" }> = {
        status: "added",
        right: toBlockSide(pair.right),
      };
      if (pair.moved) block.moved = true;
      if (pair.moveId !== undefined) block.moveId = pair.moveId;
      if (pair.inlineDiff) block.inline = pair.inlineDiff;
      return block;
    }
    case "removed": {
      const block: Extract<DiffBlock, { status: "removed" }> = {
        status: "removed",
        left: toBlockSide(pair.left),
      };
      if (pair.moved) block.moved = true;
      if (pair.moveId !== undefined) block.moveId = pair.moveId;
      if (pair.inlineDiff) block.inline = pair.inlineDiff;
      return block;
    }
    case "modified":
      return {
        status: "modified",
        left: toBlockSide(pair.left),
        right: toBlockSide(pair.right),
        inline: pair.inlineDiff,
        metrics: pair.metrics,
        wrapTag: pair.wrapTag,
      };
    case "split":
      return {
        status: "split",
        original: toBlockSide(pair.original),
        first: toBlockSide(pair.firstPart),
        second: toBlockSide(pair.secondPart),
        splitPoint: pair.splitPoint,
      };
    default: {
      const _exhaustive: never = pair;
      throw new Error(`Unknown pair status: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

