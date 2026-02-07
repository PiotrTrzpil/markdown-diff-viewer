/**
 * Block-level matching and re-pairing logic.
 * Matches markdown blocks by content similarity using LCS.
 */
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";
import { similarity, sharedWordRunScore } from "./similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { BLOCK_CONFIG, WORD_CONFIG } from "./config.js";

/** Debug logging - enabled via --debug flag */
function debug(...args: unknown[]) {
  if ((globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__) {
    console.log("[DEBUG]", ...args);
  }
}

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
 */
function tryRePairModifiedRun(run: DiffPair[]): DiffPair[] {
  const n = run.length;
  const leftTexts = run.map(p => blockToText(p.left!));
  const rightTexts = run.map(p => blockToText(p.right!));

  debug("tryRePairModifiedRun: n =", n);
  debug("  left texts:", leftTexts.map(t => t.substring(0, 40)));
  debug("  right texts:", rightTexts.map(t => t.substring(0, 40)));

  // Calculate current total similarity
  let currentTotalSim = 0;
  for (let k = 0; k < n; k++) {
    currentTotalSim += similarity(leftTexts[k], rightTexts[k]);
  }

  // For small runs (2-4), try permutations
  // For larger runs, use greedy matching
  if (n === 2) {
    return tryRePairTwo(run, leftTexts, rightTexts, currentTotalSim);
  } else if (n === 3) {
    return tryRePairThree(run, leftTexts, rightTexts, currentTotalSim);
  } else if (n === 4) {
    return tryRePairFour(run, leftTexts, rightTexts, currentTotalSim);
  } else {
    return tryRePairGreedy(run, leftTexts, rightTexts, n);
  }
}

function tryRePairTwo(
  run: DiffPair[],
  leftTexts: string[],
  rightTexts: string[],
  currentTotalSim: number,
): DiffPair[] {
  // Try swapping: left[0]↔right[1], left[1]↔right[0]
  const swappedSim = similarity(leftTexts[0], rightTexts[1]) +
                     similarity(leftTexts[1], rightTexts[0]);

  debug("  run of 2: current sim:", currentTotalSim.toFixed(3), "swapped sim:", swappedSim.toFixed(3));

  if (swappedSim > currentTotalSim + BLOCK_CONFIG.REPAIR_IMPROVEMENT_THRESHOLD) {
    debug("  -> swapping pairs");
    return [
      createModifiedPair(run[0].left!, run[1].right!),
      createModifiedPair(run[1].left!, run[0].right!),
    ];
  }
  return run;
}

function tryRePairThree(
  run: DiffPair[],
  leftTexts: string[],
  rightTexts: string[],
  currentTotalSim: number,
): DiffPair[] {
  const n = 3;
  // Try all 6 permutations and pick the best
  const perms = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]];
  let bestPerm = perms[0];
  let bestSim = currentTotalSim;

  for (const perm of perms) {
    let sim = 0;
    for (let k = 0; k < n; k++) {
      sim += similarity(leftTexts[k], rightTexts[perm[k]]);
    }
    if (sim > bestSim) {
      bestSim = sim;
      bestPerm = perm;
    }
  }

  debug("  run of 3: current sim:", currentTotalSim.toFixed(3), "best sim:", bestSim.toFixed(3), "perm:", bestPerm);

  if (bestSim > currentTotalSim + BLOCK_CONFIG.REPAIR_IMPROVEMENT_THRESHOLD && bestPerm !== perms[0]) {
    debug("  -> re-pairing with perm", bestPerm);
    return run.map((p, k) => createModifiedPair(p.left!, run[bestPerm[k]].right!));
  }
  return run;
}

function tryRePairFour(
  run: DiffPair[],
  leftTexts: string[],
  rightTexts: string[],
  currentTotalSim: number,
): DiffPair[] {
  const n = 4;
  // Generate all 24 permutations
  const perms = generatePermutations(4);

  let bestPerm = perms[0];
  let bestSim = currentTotalSim;

  for (const perm of perms) {
    let sim = 0;
    for (let k = 0; k < n; k++) {
      sim += similarity(leftTexts[k], rightTexts[perm[k]]);
    }
    if (sim > bestSim) {
      bestSim = sim;
      bestPerm = perm;
    }
  }

  debug("  run of 4: current sim:", currentTotalSim.toFixed(3), "best sim:", bestSim.toFixed(3), "perm:", bestPerm);

  if (bestSim > currentTotalSim + BLOCK_CONFIG.REPAIR_IMPROVEMENT_THRESHOLD) {
    debug("  -> re-pairing with perm", bestPerm);
    return run.map((p, k) => createModifiedPair(p.left!, run[bestPerm[k]].right!));
  }
  return run;
}

function tryRePairGreedy(
  run: DiffPair[],
  leftTexts: string[],
  rightTexts: string[],
  n: number,
): DiffPair[] {
  // For n >= 5, use greedy matching
  const usedRight = new Set<number>();
  const result: DiffPair[] = [];

  for (let li = 0; li < n; li++) {
    let bestRi = -1;
    let bestSim = -1;
    for (let ri = 0; ri < n; ri++) {
      if (usedRight.has(ri)) continue;
      const sim = similarity(leftTexts[li], rightTexts[ri]);
      if (sim > bestSim) {
        bestSim = sim;
        bestRi = ri;
      }
    }
    if (bestRi >= 0) {
      usedRight.add(bestRi);
      result.push(createModifiedPair(run[li].left!, run[bestRi].right!));
    }
  }

  debug("  run of", n, ": used greedy matching");
  return result;
}

/** Generate all permutations of [0, 1, ..., n-1] */
function generatePermutations(n: number): number[][] {
  const result: number[][] = [];
  const arr = Array.from({ length: n }, (_, i) => i);

  function permute(start: number) {
    if (start === n) {
      result.push([...arr]);
      return;
    }
    for (let i = start; i < n; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }

  permute(0);
  return result;
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
