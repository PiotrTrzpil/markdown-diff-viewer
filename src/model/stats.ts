/**
 * Pure diff statistics.
 */

import type { RootContent } from "mdast";
import type { DiffPair } from "../core/block-matching.js";
import type { DiffDocument } from "./document.js";
import { blockToText } from "../text/parse.js";
import { countWords } from "../text/tokens.js";

export interface DiffStats {
  filesChanged: number;
  blocksEqual: number;
  blocksModified: number;
  blocksAdded: number;
  blocksRemoved: number;
  wordsAdded: number;
  wordsRemoved: number;
}

function emptyStats(filesChanged: number): DiffStats {
  return {
    filesChanged,
    blocksEqual: 0,
    blocksModified: 0,
    blocksAdded: 0,
    blocksRemoved: 0,
    wordsAdded: 0,
    wordsRemoved: 0,
  };
}

function countInlineDelta(
  parts: Array<{ type: string; value: string }>,
  stats: DiffStats,
): void {
  for (const part of parts) {
    if (part.type === "added") stats.wordsAdded += countWords(part.value);
    if (part.type === "removed") stats.wordsRemoved += countWords(part.value);
  }
}

/** Stats from internal pairs. */
export function computeStats(pairs: DiffPair[]): DiffStats {
  const stats = emptyStats(1);

  for (const pair of pairs) {
    switch (pair.status) {
      case "equal":
        stats.blocksEqual++;
        break;
      case "modified":
        stats.blocksModified++;
        countInlineDelta(pair.inlineDiff, stats);
        break;
      case "added":
        stats.blocksAdded++;
        stats.wordsAdded += countWords(blockToText(pair.right));
        break;
      case "removed":
        stats.blocksRemoved++;
        stats.wordsRemoved += countWords(blockToText(pair.left));
        break;
      case "split":
        stats.blocksModified++;
        break;
    }
  }

  return stats;
}

/** Stats from a host {@link DiffDocument}. */
export function computeDocumentStats(document: DiffDocument): DiffStats {
  const stats = emptyStats(1);

  for (const block of document.blocks) {
    switch (block.status) {
      case "equal":
        stats.blocksEqual++;
        break;
      case "modified":
        stats.blocksModified++;
        countInlineDelta(block.inline, stats);
        break;
      case "added":
        stats.blocksAdded++;
        stats.wordsAdded += countWords(block.right.markdown);
        break;
      case "removed":
        stats.blocksRemoved++;
        stats.wordsRemoved += countWords(block.left.markdown);
        break;
      case "split":
        stats.blocksModified++;
        break;
    }
  }

  return stats;
}

export function aggregateStats(allStats: DiffStats[]): DiffStats {
  return allStats.reduce(
    (acc, s) => ({
      filesChanged: acc.filesChanged + s.filesChanged,
      blocksEqual: acc.blocksEqual + s.blocksEqual,
      blocksModified: acc.blocksModified + s.blocksModified,
      blocksAdded: acc.blocksAdded + s.blocksAdded,
      blocksRemoved: acc.blocksRemoved + s.blocksRemoved,
      wordsAdded: acc.wordsAdded + s.wordsAdded,
      wordsRemoved: acc.wordsRemoved + s.wordsRemoved,
    }),
    emptyStats(0),
  );
}

/** Flatten mdast text for CLI preview (not used by the engine). */
export function extractTextFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("type" in node) {
    try {
      return blockToText(node as RootContent);
    } catch {
      // fall through
    }
  }
  const n = node as Record<string, unknown>;
  if (typeof n["value"] === "string") return n["value"];
  if (Array.isArray(n["children"])) {
    return n["children"].map(extractTextFromNode).join(" ");
  }
  return "";
}
