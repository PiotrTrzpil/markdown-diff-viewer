/**
 * Block-level matching and re-pairing logic.
 * Matches markdown blocks by content similarity using LCS.
 */
import type { RootContent } from "mdast";
import { blockToText } from "../text/parse.js";
import { similarity, sharedWordRunScore, buildBigramCache, computeDiceCached } from "../text/similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { countTotalWords, countSharedWords } from "../text/text-metrics.js";
import { BLOCK_CONFIG, WORD_CONFIG } from "../config.js";
import { debug } from "../debug.js";

export type DiffStatus = "equal" | "added" | "removed" | "modified" | "split";

// ─── Metrics Type ─────────────────────────────────────────────────────────────

/** Pre-computed metrics for a modified pair, avoiding redundant calculation */
export interface DiffMetrics {
  /** Words that appear unchanged on both sides */
  sharedWords: number;
  /** Total words on the left side (equal + removed) */
  totalWords: number;
}

// ─── Discriminated Union Types ───────────────────────────────────────────────

/** Equal pair: both sides present and identical */
export type EqualPair = {
  status: "equal";
  left: RootContent;
  right: RootContent;
};

/** Added pair: only right side present */
export type AddedPair = {
  status: "added";
  right: RootContent;
  /** Optional inline diff for paragraph split markers */
  inlineDiff?: InlinePart[];
  /** True if this content was moved from another location (already rendered there) */
  moved?: true;
};

/** Removed pair: only left side present */
export type RemovedPair = {
  status: "removed";
  left: RootContent;
};

/** Modified pair: both sides present with differences */
export type ModifiedPair = {
  status: "modified";
  left: RootContent;
  right: RootContent;
  /** Multi-level inline diff showing changes */
  inlineDiff: InlinePart[];
  /** Pre-computed metrics for layout decisions */
  metrics: DiffMetrics;
};

/**
 * Split pair: one paragraph split into two.
 * Renders as two rows: original vs first part, then spacer vs second part.
 */
export type SplitPair = {
  status: "split";
  /** The original paragraph (left side) */
  original: RootContent;
  /** First part after split (right side) */
  firstPart: RootContent;
  /** Second part after split (right side) */
  secondPart: RootContent;
  /** Character index in original text where the split occurs */
  splitPoint: number;
};

/** Discriminated union of all pair types */
export type DiffPair = EqualPair | AddedPair | RemovedPair | ModifiedPair | SplitPair;

// ─── Type Guards ─────────────────────────────────────────────────────────────

export function isEqualPair(pair: DiffPair): pair is EqualPair {
  return pair.status === "equal";
}

export function isAddedPair(pair: DiffPair): pair is AddedPair {
  return pair.status === "added";
}

export function isRemovedPair(pair: DiffPair): pair is RemovedPair {
  return pair.status === "removed";
}

export function isModifiedPair(pair: DiffPair): pair is ModifiedPair {
  return pair.status === "modified";
}

export function isSplitPair(pair: DiffPair): pair is SplitPair {
  return pair.status === "split";
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function createEqualPair(left: RootContent, right: RootContent): EqualPair {
  return { status: "equal", left, right };
}

export function createAddedPair(right: RootContent, options?: { inlineDiff?: InlinePart[]; moved?: true }): AddedPair {
  const pair: AddedPair = { status: "added", right };
  if (options?.inlineDiff) pair.inlineDiff = options.inlineDiff;
  if (options?.moved) pair.moved = true;
  return pair;
}

export function createRemovedPair(left: RootContent): RemovedPair {
  return { status: "removed", left };
}

export function createSplitPair(
  original: RootContent,
  firstPart: RootContent,
  secondPart: RootContent,
  splitPoint: number,
): SplitPair {
  return { status: "split", original, firstPart, secondPart, splitPoint };
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

  // Precompute bigram caches for all blocks (O(n) per block)
  const leftCaches = leftTexts.map(buildBigramCache);
  const rightCaches = rightTexts.map(buildBigramCache);

  // Compute similarity matrix using cached bigrams (avoids recomputing bigrams)
  const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      // Fast path for identical strings
      if (leftTexts[i] === rightTexts[j]) {
        sim[i][j] = 1;
      } else {
        sim[i][j] = computeDiceCached(leftCaches[i], rightCaches[j]);
      }
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
 * Post-process diff results to pair up consecutive removed/added blocks
 * that share significant text content.
 */
export function pairUpUnmatchedBlocks(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;

  while (i < pairs.length) {
    // Collect consecutive removed blocks
    const removedBlocks: RemovedPair[] = [];
    while (i < pairs.length && pairs[i].status === "removed") {
      removedBlocks.push(pairs[i] as RemovedPair);
      i++;
    }

    // Collect consecutive added blocks
    const addedBlocks: AddedPair[] = [];
    while (i < pairs.length && pairs[i].status === "added") {
      addedBlocks.push(pairs[i] as AddedPair);
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
function pairRemovedAndAdded(removed: RemovedPair[], added: AddedPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  const usedRemoved = new Set<number>();
  const usedAdded = new Set<number>();

  // For each removed block, find best matching added block
  for (let ri = 0; ri < removed.length; ri++) {
    const leftText = blockToText(removed[ri].left);
    let bestMatch = -1;
    let bestScore = 0;

    for (let ai = 0; ai < added.length; ai++) {
      if (usedAdded.has(ai)) continue;
      const rightText = blockToText(added[ai].right);
      const score = sharedWordRunScore(leftText, rightText);

      // Require minimum shared contiguous words to pair
      if (score >= WORD_CONFIG.MIN_SHARED_FOR_PAIRING && score > bestScore) {
        bestScore = score;
        bestMatch = ai;
      }
    }

    if (bestMatch >= 0) {
      // Create a modified pair with inline diff
      result.push(createModifiedPair(removed[ri].left, added[bestMatch].right));
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

/** Create a modified pair with computed inline diff and metrics */
export function createModifiedPair(left: RootContent, right: RootContent): ModifiedPair {
  const leftText = blockToText(left);
  const rightText = blockToText(right);
  const inlineDiff = computeInlineDiff(leftText, rightText);
  const metrics: DiffMetrics = {
    sharedWords: countSharedWords(inlineDiff),
    totalWords: countTotalWords(inlineDiff),
  };
  return { status: "modified", left, right, inlineDiff, metrics };
}
