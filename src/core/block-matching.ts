/**
 * Block-level matching and re-pairing logic.
 * Matches markdown blocks by content similarity using LCS.
 */
import type { RootContent } from "mdast";
import { blockToText } from "../text/parse.js";
import { similarity, sharedWordRunScore } from "./similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { BLOCK_CONFIG, WORD_CONFIG } from "../config.js";
import { debug } from "../debug.js";

export type DiffStatus = "equal" | "added" | "removed" | "modified";

export interface DiffPair {
  status: DiffStatus;
  left: RootContent | null;
  right: RootContent | null;
  /** For modified blocks, multi-level inline diff */
  inlineDiff?: InlinePart[];
}

export interface BlockMatch {
  leftIdx: number;
  rightIdx: number;
  exact: boolean;
}

/**
 * Find best block matches using LCS with similarity threshold.
 * Blocks with >40% text overlap are considered "similar" (modified).
 * Blocks with 100% match are "exact".
 */
export function findBlockMatches(
  leftTexts: string[],
  rightTexts: string[],
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

  const THRESHOLD = BLOCK_CONFIG.SIMILARITY_THRESHOLD;

  // LCS DP where a "match" is any pair with similarity > threshold
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
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
      debug("findBlockMatches: pair", i, j, "sim:", sim[i][j], "exact:", sim[i][j] > BLOCK_CONFIG.EXACT_MATCH_THRESHOLD);
      matches.push({
        leftIdx: i,
        rightIdx: j,
        exact: sim[i][j] > BLOCK_CONFIG.EXACT_MATCH_THRESHOLD,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  debug("findBlockMatches: returning", matches);
  return matches;
}

/**
 * Re-pair modified blocks with low similarity scores.
 * When consecutive modified pairs have low similarity, check if swapping
 * would produce better matches.
 */
export function rePairLowSimilarityBlocks(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;

  debug("rePairLowSimilarityBlocks: processing", pairs.length, "pairs");
  debug("  statuses:", pairs.map(p => p.status).join(", "));

  while (i < pairs.length) {
    // Find runs of consecutive modified pairs
    if (pairs[i].status === "modified") {
      const runStart = i;
      while (i < pairs.length && pairs[i].status === "modified") {
        i++;
      }
      const runEnd = i;

      debug("rePairLowSimilarityBlocks: found run from", runStart, "to", runEnd, "(length", runEnd - runStart, ")");

      if (runEnd - runStart >= 2) {
        // We have 2+ consecutive modified pairs - check if re-pairing helps
        const run = pairs.slice(runStart, runEnd);
        const rePaired = tryRePairModifiedRun(run);
        result.push(...rePaired);
      } else {
        result.push(pairs[runStart]);
      }
    } else {
      result.push(pairs[i]);
      i++;
    }
  }

  return result;
}

/**
 * Try to re-pair a run of modified blocks for better similarity.
 *
 * NOTE: Re-pairing is disabled because any permutation would change the
 * document order on one side (left or right), making the diff confusing.
 * The LCS algorithm already found the best positional matching.
 */
function tryRePairModifiedRun(run: DiffPair[]): DiffPair[] {
  debug("tryRePairModifiedRun: n =", run.length, "(re-pairing disabled to preserve order)");
  return run;
}

/**
 * Post-process diff results to pair up consecutive removed/added blocks
 * that share significant text content.
 */
export function pairUpUnmatchedBlocks(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;

  while (i < pairs.length) {
    // Collect consecutive removed blocks
    const removedBlocks: DiffPair[] = [];
    while (i < pairs.length && pairs[i].status === "removed") {
      removedBlocks.push(pairs[i]);
      i++;
    }

    // Collect consecutive added blocks
    const addedBlocks: DiffPair[] = [];
    while (i < pairs.length && pairs[i].status === "added") {
      addedBlocks.push(pairs[i]);
      i++;
    }

    // Try to pair them up if we have both
    if (removedBlocks.length > 0 && addedBlocks.length > 0) {
      result.push(...pairRemovedAndAdded(removedBlocks, addedBlocks));
    } else {
      // No pairing possible, just add them as-is
      result.push(...removedBlocks, ...addedBlocks);
    }

    // Add any other pair type (equal, modified) directly
    if (i < pairs.length && pairs[i].status !== "removed" && pairs[i].status !== "added") {
      result.push(pairs[i]);
      i++;
    }
  }

  return result;
}

/**
 * Try to pair up removed and added blocks based on shared content.
 * Uses longest common contiguous word run to match blocks.
 */
function pairRemovedAndAdded(removed: DiffPair[], added: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  const usedRemoved = new Set<number>();
  const usedAdded = new Set<number>();

  // For each removed block, find best matching added block
  for (let ri = 0; ri < removed.length; ri++) {
    const leftText = blockToText(removed[ri].left!);
    let bestMatch = -1;
    let bestScore = 0;

    for (let ai = 0; ai < added.length; ai++) {
      if (usedAdded.has(ai)) continue;
      const rightText = blockToText(added[ai].right!);
      const score = sharedWordRunScore(leftText, rightText);

      // Require minimum shared contiguous words to pair
      if (score >= WORD_CONFIG.MIN_SHARED_FOR_PAIRING && score > bestScore) {
        bestScore = score;
        bestMatch = ai;
      }
    }

    if (bestMatch >= 0) {
      // Create a modified pair with inline diff
      const leftText = blockToText(removed[ri].left!);
      const rightText = blockToText(added[bestMatch].right!);
      const inlineDiff = computeInlineDiff(leftText, rightText);

      result.push({
        status: "modified",
        left: removed[ri].left,
        right: added[bestMatch].right,
        inlineDiff,
      });
      usedRemoved.add(ri);
      usedAdded.add(bestMatch);
    }
  }

  // Add unpaired removed blocks
  for (let ri = 0; ri < removed.length; ri++) {
    if (!usedRemoved.has(ri)) {
      result.push(removed[ri]);
    }
  }

  // Add unpaired added blocks
  for (let ai = 0; ai < added.length; ai++) {
    if (!usedAdded.has(ai)) {
      result.push(added[ai]);
    }
  }

  return result;
}

/** Create a modified pair with computed inline diff */
export function createModifiedPair(left: RootContent, right: RootContent): DiffPair {
  const leftText = blockToText(left);
  const rightText = blockToText(right);
  const inlineDiff = computeInlineDiff(leftText, rightText);
  return { status: "modified", left, right, inlineDiff };
}
