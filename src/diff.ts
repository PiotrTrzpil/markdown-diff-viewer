import { diffWords } from "diff";
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";

export type DiffStatus = "equal" | "added" | "removed" | "modified";

export interface DiffPair {
  status: DiffStatus;
  left: RootContent | null;
  right: RootContent | null;
  /** For modified blocks, word-level diff of the text content */
  inlineDiff?: InlinePart[];
}

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
}

/**
 * LCS-based block diff.
 * Matches blocks by content similarity, then aligns with spacers.
 */
export function diffBlocks(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[]
): DiffPair[] {
  const leftTexts = leftBlocks.map(blockToText);
  const rightTexts = rightBlocks.map(blockToText);

  // Build similarity matrix and find LCS of matching/similar blocks
  const matches = findBlockMatches(leftTexts, rightTexts);
  const result: DiffPair[] = [];

  let li = 0;
  let ri = 0;

  for (const match of matches) {
    // Emit removed blocks before this match
    while (li < match.leftIdx) {
      result.push({ status: "removed", left: leftBlocks[li], right: null });
      li++;
    }
    // Emit added blocks before this match
    while (ri < match.rightIdx) {
      result.push({ status: "added", left: null, right: rightBlocks[ri] });
      ri++;
    }

    if (match.exact) {
      result.push({
        status: "equal",
        left: leftBlocks[li],
        right: rightBlocks[ri],
      });
    } else {
      const inlineDiff = computeInlineDiff(leftTexts[li], rightTexts[ri]);
      result.push({
        status: "modified",
        left: leftBlocks[li],
        right: rightBlocks[ri],
        inlineDiff,
      });
    }
    li++;
    ri++;
  }

  // Remaining blocks
  while (li < leftBlocks.length) {
    result.push({ status: "removed", left: leftBlocks[li], right: null });
    li++;
  }
  while (ri < rightBlocks.length) {
    result.push({ status: "added", left: null, right: rightBlocks[ri] });
    ri++;
  }

  return result;
}

interface BlockMatch {
  leftIdx: number;
  rightIdx: number;
  exact: boolean;
}

/**
 * Find best block matches using LCS with similarity threshold.
 * Blocks with >40% text overlap are considered "similar" (modified).
 * Blocks with 100% match are "exact".
 */
function findBlockMatches(
  leftTexts: string[],
  rightTexts: string[]
): BlockMatch[] {
  const m = leftTexts.length;
  const n = rightTexts.length;

  // Precompute similarity scores
  const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      sim[i][j] = similarity(leftTexts[i], rightTexts[j]);
    }
  }

  const THRESHOLD = 0.4;

  // LCS DP where a "match" is any pair with similarity > threshold
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (sim[i][j] >= THRESHOLD) {
        dp[i][j] = dp[i + 1][j + 1] + 1 + sim[i][j]; // Weight by similarity
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back
  const matches: BlockMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (sim[i][j] >= THRESHOLD && dp[i][j] === dp[i + 1][j + 1] + 1 + sim[i][j]) {
      matches.push({
        leftIdx: i,
        rightIdx: j,
        exact: sim[i][j] > 0.99,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return matches;
}

/** Compute text similarity (0-1) using bigram overlap (Dice coefficient) */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

/** Word-level inline diff between two text strings */
function computeInlineDiff(a: string, b: string): InlinePart[] {
  const changes = diffWords(a, b);
  return changes.map((part) => ({
    value: part.value,
    type: part.added ? "added" : part.removed ? "removed" : "equal",
  }));
}
