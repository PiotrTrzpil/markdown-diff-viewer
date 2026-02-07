/**
 * Diff statistics computation and formatting.
 */

import type { DiffPair } from "../diff.js";
import { c } from "./colors.js";

export interface DiffStats {
  filesChanged: number;
  blocksEqual: number;
  blocksModified: number;
  blocksAdded: number;
  blocksRemoved: number;
  wordsAdded: number;
  wordsRemoved: number;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function extractTextFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (typeof n["value"] === "string") return n["value"];
  if (Array.isArray(n["children"])) {
    return n["children"].map(extractTextFromNode).join(" ");
  }
  return "";
}

export function computeStats(pairs: DiffPair[]): DiffStats {
  const stats: DiffStats = {
    filesChanged: 1,
    blocksEqual: 0,
    blocksModified: 0,
    blocksAdded: 0,
    blocksRemoved: 0,
    wordsAdded: 0,
    wordsRemoved: 0,
  };

  for (const pair of pairs) {
    switch (pair.status) {
      case "equal":
        stats.blocksEqual++;
        break;
      case "modified":
        stats.blocksModified++;
        if (pair.inlineDiff) {
          for (const part of pair.inlineDiff) {
            if (part.type === "added") stats.wordsAdded += countWords(part.value);
            if (part.type === "removed") stats.wordsRemoved += countWords(part.value);
          }
        }
        break;
      case "added":
        stats.blocksAdded++;
        if (pair.right) {
          stats.wordsAdded += countWords(extractTextFromNode(pair.right));
        }
        break;
      case "removed":
        stats.blocksRemoved++;
        if (pair.left) {
          stats.wordsRemoved += countWords(extractTextFromNode(pair.left));
        }
        break;
    }
  }

  return stats;
}

export function aggregateStats(allStats: DiffStats[]): DiffStats {
  return allStats.reduce(
    (acc, stats) => ({
      filesChanged: acc.filesChanged + 1,
      blocksEqual: acc.blocksEqual + stats.blocksEqual,
      blocksModified: acc.blocksModified + stats.blocksModified,
      blocksAdded: acc.blocksAdded + stats.blocksAdded,
      blocksRemoved: acc.blocksRemoved + stats.blocksRemoved,
      wordsAdded: acc.wordsAdded + stats.wordsAdded,
      wordsRemoved: acc.wordsRemoved + stats.wordsRemoved,
    }),
    {
      filesChanged: 0,
      blocksEqual: 0,
      blocksModified: 0,
      blocksAdded: 0,
      blocksRemoved: 0,
      wordsAdded: 0,
      wordsRemoved: 0,
    },
  );
}

export function formatStats(stats: DiffStats): string {
  const parts: string[] = [];

  if (stats.filesChanged > 1) {
    parts.push(`${c.bold}${stats.filesChanged}${c.reset} files`);
  }

  const blockChanges = stats.blocksModified + stats.blocksAdded + stats.blocksRemoved;
  if (blockChanges > 0) {
    parts.push(`${c.bold}${blockChanges}${c.reset} block${blockChanges !== 1 ? "s" : ""} changed`);
  }

  if (stats.wordsAdded > 0) {
    parts.push(`${c.green}+${stats.wordsAdded}${c.reset} words`);
  }

  if (stats.wordsRemoved > 0) {
    parts.push(`${c.red}-${stats.wordsRemoved}${c.reset} words`);
  }

  if (parts.length === 0) {
    return `${c.dim}No changes${c.reset}`;
  }

  return parts.join(", ");
}
