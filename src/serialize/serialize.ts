/**
 * Serializer — converts DiffPair[] (with mdast nodes) to JSON-safe DiffData.
 * Runs server-side (Node.js) before embedding in the HTML shell.
 */
import type { RootContent, Heading } from "mdast";
import { blockToText, blockInnerText, getWrapTag } from "../text/parse.js";
import type { DiffPair } from "../core/block-matching.js";
import { isEqualPair, isAddedPair, isRemovedPair, isModifiedPair, isSplitPair } from "../core/block-matching.js";
import type { MatchingLevel } from "../config.js";
import type { DiffData, FileDiffData, SerializedPair, BlockData, BlockType, UISettings } from "./types.js";

// ─── BlockType Mapping ────────────────────────────────────────────────────────

const MDAST_TYPE_TO_BLOCK_TYPE: Record<string, BlockType> = {
  paragraph: "paragraph",
  heading: "heading",
  code: "code",
  blockquote: "blockquote",
  list: "list",
  table: "table",
  html: "html",
  thematicBreak: "thematicBreak",
};

function toBlockType(mdastType: string): BlockType {
  const mapped = MDAST_TYPE_TO_BLOCK_TYPE[mdastType];
  if (!mapped) {
    // Unknown block types fall back to "paragraph" — fail loudly in dev
    if (process.env.NODE_ENV === "development") {
      throw new Error(`serializeBlock: unknown mdast node type "${mdastType}"`);
    }
    return "paragraph";
  }
  return mapped;
}

// ─── Core Serializers ─────────────────────────────────────────────────────────

/**
 * Extract plain data from an mdast RootContent node.
 * Uses blockToText() for raw text and blockInnerText() for inner text.
 */
export function serializeBlock(node: RootContent): BlockData {
  const text = blockToText(node);
  const innerText = blockInnerText(node);
  const type = toBlockType(node.type);

  const block: BlockData = { text, innerText, type };

  if (node.type === "heading") {
    block.headingLevel = (node as Heading).depth;
  }

  if (node.position?.start.line != null) {
    block.line = node.position.start.line;
  }

  return block;
}

/**
 * Convert a single DiffPair to its JSON-safe SerializedPair form.
 */
export function serializePair(pair: DiffPair): SerializedPair {
  if (isEqualPair(pair)) {
    return {
      status: "equal",
      left: serializeBlock(pair.left),
      right: serializeBlock(pair.right),
    };
  }

  if (isAddedPair(pair)) {
    const serialized: SerializedPair = {
      status: "added",
      right: serializeBlock(pair.right),
    };
    if (pair.moved) (serialized as Extract<SerializedPair, { status: "added" }>).moved = true;
    if (pair.inlineDiff) (serialized as Extract<SerializedPair, { status: "added" }>).inlineDiff = pair.inlineDiff;
    return serialized;
  }

  if (isRemovedPair(pair)) {
    return {
      status: "removed",
      left: serializeBlock(pair.left),
    };
  }

  if (isModifiedPair(pair)) {
    return {
      status: "modified",
      left: serializeBlock(pair.left),
      right: serializeBlock(pair.right),
      inlineDiff: pair.inlineDiff,
      metrics: pair.metrics,
      wrapTag: getWrapTag(pair.left),
    };
  }

  if (isSplitPair(pair)) {
    return {
      status: "split",
      original: serializeBlock(pair.original),
      firstPart: serializeBlock(pair.firstPart),
      secondPart: serializeBlock(pair.secondPart),
      splitPoint: pair.splitPoint,
    };
  }

  throw new Error(`serializePair: unhandled pair status "${(pair as DiffPair).status}"`);
}

/**
 * Convert a DiffPair[] to SerializedPair[].
 */
export function serializePairs(pairs: DiffPair[]): SerializedPair[] {
  return pairs.map(serializePair);
}

// ─── Top-level Entry Point ────────────────────────────────────────────────────

export interface FileDiffInput {
  path: string;
  pairs: DiffPair[];
  pairsByLevel?: Record<MatchingLevel, DiffPair[]>;
  added?: number;
  removed?: number;
}

/**
 * Produce the full DiffData structure ready for JSON serialization and embedding.
 */
export function serializeDiffData(files: FileDiffInput[], settings: UISettings, meta: DiffData["meta"]): DiffData {
  const serializedFiles: FileDiffData[] = files.map((file) => {
    const fileDiffData: FileDiffData = {
      path: file.path,
      pairs: serializePairs(file.pairs),
    };

    if (file.pairsByLevel) {
      const pairsByLevel: Partial<Record<MatchingLevel, SerializedPair[]>> = {};
      for (const level of Object.keys(file.pairsByLevel) as MatchingLevel[]) {
        pairsByLevel[level] = serializePairs(file.pairsByLevel[level]);
      }
      fileDiffData.pairsByLevel = pairsByLevel as Record<MatchingLevel, SerializedPair[]>;
    }

    if (file.added != null) fileDiffData.added = file.added;
    if (file.removed != null) fileDiffData.removed = file.removed;

    return fileDiffData;
  });

  return { files: serializedFiles, settings, meta };
}
