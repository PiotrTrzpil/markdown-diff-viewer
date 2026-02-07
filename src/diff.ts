import { diffChars } from "diff";
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";

/** Debug logging - enabled via --debug flag */
function debug(...args: any[]) {
  if ((globalThis as any).__MD_DIFF_DEBUG__) {
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

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /** Character-level sub-diff within a changed word/phrase */
  children?: InlinePart[];
  /** True if the change is minor (case-only, punctuation-only) */
  minor?: boolean;
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

    debug("diffBlocks: processing match", match, "li:", li, "ri:", ri);
    if (match.exact) {
      debug("diffBlocks: match is exact, setting status=equal");
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

  // Post-process: re-pair modified blocks with low similarity scores
  const rePaired = rePairLowSimilarityBlocks(result);

  // Post-process: try to pair up consecutive removed+added blocks
  const paired = pairUpUnmatchedBlocks(rePaired);

  // Post-process: detect text moved from modified blocks to added blocks
  return detectMovedText(paired);
}

interface BlockMatch {
  leftIdx: number;
  rightIdx: number;
  exact: boolean;
}

/**
 * Detect text that was "moved" - removed from one block but appears as added in another block.
 * This handles both modified+added and modified+modified sequences.
 */
function detectMovedText(pairs: DiffPair[]): DiffPair[] {
  // First pass: collect all removed and added text segments from modified blocks
  const removedSegments: { pairIdx: number; text: string }[] = [];
  const addedSegments: { pairIdx: number; text: string }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status === "modified" && p.inlineDiff) {
      for (const part of p.inlineDiff) {
        if (part.type === "removed" && !part.minor && part.value.length > 30) {
          removedSegments.push({ pairIdx: i, text: part.value });
        }
        if (part.type === "added" && !part.minor && part.value.length > 30) {
          addedSegments.push({ pairIdx: i, text: part.value });
        }
      }
    }
    if (p.status === "added" && p.right) {
      addedSegments.push({ pairIdx: i, text: blockToText(p.right) });
    }
  }

  // Find matches between removed and added segments
  const moveMatches: { removedIdx: number; addedIdx: number; sharedWords: number }[] = [];
  for (const removed of removedSegments) {
    for (const added of addedSegments) {
      if (removed.pairIdx !== added.pairIdx) {
        const score = sharedWordRunScore(removed.text, added.text);
        if (score >= 8) {
          moveMatches.push({ removedIdx: removed.pairIdx, addedIdx: added.pairIdx, sharedWords: score });
        }
      }
    }
  }

  if (moveMatches.length === 0) {
    return pairs;
  }

  // For each match, convert removed text to equal in both blocks
  const result: DiffPair[] = [];
  const processedMoves = new Set<string>();

  for (let i = 0; i < pairs.length; i++) {
    const current = pairs[i];

    // Check if this pair has moved text
    const moveAsRemoved = moveMatches.find(m => m.removedIdx === i);
    const moveAsAdded = moveMatches.find(m => m.addedIdx === i);

    if (moveAsRemoved && current.status === "modified" && current.inlineDiff) {
      // This block has text that was "moved out" - find the matching added text
      const addedPair = pairs[moveAsRemoved.addedIdx];
      const addedText = addedPair.status === "added" && addedPair.right
        ? blockToText(addedPair.right)
        : addedPair.inlineDiff?.filter(p => p.type === "added").map(p => p.value).join("") || "";

      // Recompute inline diff combining both sides' perspectives
      const leftText = blockToText(current.left!);
      const rightText = blockToText(current.right!) + "\n\n" + addedText;
      const newInlineDiff = computeInlineDiff(leftText, rightText);

      result.push({
        status: "modified",
        left: current.left,
        right: current.right,
        inlineDiff: newInlineDiff,
      });

      processedMoves.add(`${moveAsRemoved.removedIdx}-${moveAsRemoved.addedIdx}`);
    } else if (moveAsAdded) {
      const key = `${moveAsAdded.removedIdx}-${moveAsAdded.addedIdx}`;
      if (processedMoves.has(key)) {
        // This added block's content is already shown in the modified block
        // Show as paragraph indicator
        if (current.status === "added" && current.right) {
          result.push({
            status: "added",
            left: null,
            right: current.right,
            inlineDiff: [{ value: "¶ ", type: "added" }, { value: "(content shown above)", type: "equal" }],
          });
        } else if (current.status === "modified" && current.inlineDiff) {
          // For modified pairs where the added portion was moved from elsewhere,
          // just show what's actually new
          const filteredDiff = current.inlineDiff.map(part => {
            if (part.type === "added" && sharedWordRunScore(part.value, pairs[moveAsAdded.removedIdx].inlineDiff?.filter(p => p.type === "removed").map(p => p.value).join("") || "") >= 5) {
              return { ...part, type: "equal" as const };
            }
            return part;
          });
          result.push({
            ...current,
            inlineDiff: filteredDiff,
          });
        } else {
          result.push(current);
        }
      } else {
        result.push(current);
      }
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Post-process diff results to pair up consecutive removed/added blocks
 * that share significant text content.
 */
function pairUpUnmatchedBlocks(pairs: DiffPair[]): DiffPair[] {
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

      // Require at least 5 shared contiguous words to pair
      if (score >= 5 && score > bestScore) {
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

/**
 * Score how many contiguous words are shared between two texts.
 * Returns the length of the longest common contiguous word run.
 */
function sharedWordRunScore(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const run = longestCommonRun(tokensA, tokensB, 0, tokensA.length, 0, tokensB.length, 1);
  return run ? run.len : 0;
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
      debug("findBlockMatches: pair", i, j, "sim:", sim[i][j], "exact:", sim[i][j] > 0.99);
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

  debug("findBlockMatches: returning", matches);
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

/**
 * Re-pair modified blocks with low similarity scores.
 * When consecutive modified pairs have low similarity, check if swapping
 * would produce better matches.
 */
function rePairLowSimilarityBlocks(pairs: DiffPair[]): DiffPair[] {
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
    // Try swapping: left[0]↔right[1], left[1]↔right[0]
    const swappedSim = similarity(leftTexts[0], rightTexts[1]) +
                       similarity(leftTexts[1], rightTexts[0]);

    debug("  run of 2: current sim:", currentTotalSim.toFixed(3), "swapped sim:", swappedSim.toFixed(3));

    if (swappedSim > currentTotalSim + 0.1) { // Require significant improvement
      debug("  -> swapping pairs");
      return [
        createModifiedPair(run[0].left!, run[1].right!),
        createModifiedPair(run[1].left!, run[0].right!),
      ];
    }
  } else if (n === 3) {
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

    if (bestSim > currentTotalSim + 0.1 && bestPerm !== perms[0]) {
      debug("  -> re-pairing with perm", bestPerm);
      return run.map((p, k) => createModifiedPair(p.left!, run[bestPerm[k]].right!));
    }
  } else if (n === 4) {
    // Try all 24 permutations
    const perms: number[][] = [];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        if (b === a) continue;
        for (let c = 0; c < 4; c++) {
          if (c === a || c === b) continue;
          for (let d = 0; d < 4; d++) {
            if (d === a || d === b || d === c) continue;
            perms.push([a, b, c, d]);
          }
        }
      }
    }

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

    if (bestSim > currentTotalSim + 0.1) {
      debug("  -> re-pairing with perm", bestPerm);
      return run.map((p, k) => createModifiedPair(p.left!, run[bestPerm[k]].right!));
    }
  } else {
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

  // No improvement found, return as-is
  return run;
}

function createModifiedPair(left: RootContent, right: RootContent): DiffPair {
  const leftText = blockToText(left);
  const rightText = blockToText(right);
  const inlineDiff = computeInlineDiff(leftText, rightText);
  return { status: "modified", left, right, inlineDiff };
}

// ─── Custom contiguous word diff ────────────────────────────────────────────

const MIN_RUN = 3; // minimum contiguous matching words to anchor

interface WordToken {
  word: string; // for comparison
  raw: string;  // original text including trailing whitespace
}

function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /(\S+)(\s*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[1], raw: m[0] });
  }
  return tokens;
}

/**
 * Find the longest contiguous common run of words between a[aS..aE) and b[bS..bE).
 * Returns null if no run of minLen+ words found.
 */
function longestCommonRun(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  minLen: number
): { ai: number; bi: number; len: number } | null {
  const rows = aE - aS;
  const cols = bE - bS;
  if (rows === 0 || cols === 0) return null;

  let bestLen = 0, bestAi = 0, bestBi = 0;
  let prev = new Uint16Array(cols);
  let curr = new Uint16Array(cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (a[aS + i].word === b[bS + j].word) {
        curr[j] = j > 0 ? prev[j - 1] + 1 : 1;
        if (curr[j] > bestLen) {
          bestLen = curr[j];
          bestAi = aS + i - bestLen + 1;
          bestBi = bS + j - bestLen + 1;
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  if (bestLen < minLen) return null;
  return { ai: bestAi, bi: bestBi, len: bestLen };
}

/**
 * Recursively find all non-overlapping contiguous matching runs (longest first).
 * Returns anchors in left-to-right order.
 */
function findAnchors(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  minLen: number
): { ai: number; bi: number; len: number }[] {
  const best = longestCommonRun(a, b, aS, aE, bS, bE, minLen);
  if (!best) return [];

  const left = findAnchors(a, b, aS, best.ai, bS, best.bi, minLen);
  const right = findAnchors(a, b, best.ai + best.len, aE, best.bi + best.len, bE, minLen);

  return [...left, best, ...right];
}

/** Join token raw text, but trim trailing whitespace from the last token */
function joinTokens(tokens: WordToken[]): string {
  if (tokens.length === 0) return "";
  return tokens.map(t => t.raw).join("");
}

/**
 * Custom word diff requiring contiguous runs of MIN_RUN+ words to match.
 * Eliminates scattered coincidental single-word matches from diffWords.
 */
function diffWordsContiguous(left: string, right: string): InlinePart[] {
  const a = tokenize(left);
  const b = tokenize(right);
  const anchors = findAnchors(a, b, 0, a.length, 0, b.length, MIN_RUN);

  debug("diffWordsContiguous:");
  debug("  left:", JSON.stringify(left.substring(0, 60)));
  debug("  right:", JSON.stringify(right.substring(0, 60)));
  debug("  anchors:", anchors.map(an => ({ ai: an.ai, bi: an.bi, len: an.len, text: a.slice(an.ai, an.ai + an.len).map(t => t.word).join(" ") })));

  const parts: InlinePart[] = [];
  let ai = 0, bi = 0;

  for (const anchor of anchors) {
    if (ai < anchor.ai) {
      parts.push({ value: joinTokens(a.slice(ai, anchor.ai)), type: "removed" });
    }
    if (bi < anchor.bi) {
      parts.push({ value: joinTokens(b.slice(bi, anchor.bi)), type: "added" });
    }
    parts.push({ value: joinTokens(a.slice(anchor.ai, anchor.ai + anchor.len)), type: "equal" });
    ai = anchor.ai + anchor.len;
    bi = anchor.bi + anchor.len;
  }

  if (ai < a.length) {
    parts.push({ value: joinTokens(a.slice(ai)), type: "removed" });
  }
  if (bi < b.length) {
    parts.push({ value: joinTokens(b.slice(bi)), type: "added" });
  }

  debug("  raw parts:", parts.map(p => ({ type: p.type, value: p.value.substring(0, 30) })));

  // Post-process: extract common prefix/suffix from adjacent removed+added pairs
  const result = extractCommonWords(parts);
  debug("  after extractCommonWords:", result.map(p => ({ type: p.type, minor: p.minor, value: p.value.substring(0, 30) })));
  return result;
}

/** Normalize word for comparison (lowercase, strip trailing punctuation) */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[.,;:!?'")\]}>]+$/, "").replace(/^['"(\[{<]+/, "");
}

/**
 * Extract common words from adjacent removed+added pairs using recursive LCS.
 * Finds common prefix, suffix, AND internal common word runs.
 * E.g., "was comprehensively" (removed) + "was" (added) → "was" (equal) + "comprehensively" (removed)
 */
function extractCommonWords(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    // Look for adjacent removed+added pairs
    if (
      parts[i].type === "removed" &&
      i + 1 < parts.length &&
      parts[i + 1].type === "added"
    ) {
      const removedTokens = tokenize(parts[i].value);
      const addedTokens = tokenize(parts[i + 1].value);

      debug("extractCommonWords: processing pair");
      debug("  removed:", parts[i].value.substring(0, 40));
      debug("  added:", parts[i + 1].value.substring(0, 40));
      debug("  removed tokens:", removedTokens.map(t => t.word));
      debug("  added tokens:", addedTokens.map(t => t.word));

      // Use recursive LCS to find all common word runs
      const diffParts = diffTokensRecursive(removedTokens, addedTokens, 0, removedTokens.length, 0, addedTokens.length);
      result.push(...diffParts);

      i += 2;
    } else {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

/**
 * Recursively diff two token arrays using LCS to find common runs.
 * Uses MIN_INTERNAL_RUN (1 word) for internal matching to catch isolated common words.
 */
function diffTokensRecursive(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  depth: number = 0
): InlinePart[] {
  const MIN_INTERNAL_RUN = 1; // Match single words internally

  if (aS >= aE && bS >= bE) return [];
  if (aS >= aE) {
    return [{ value: joinTokens(b.slice(bS, bE)), type: "added" }];
  }
  if (bS >= bE) {
    return [{ value: joinTokens(a.slice(aS, aE)), type: "removed" }];
  }

  // Find longest common run using normalized comparison
  const run = longestCommonRunNormalized(a, b, aS, aE, bS, bE, MIN_INTERNAL_RUN);

  if (!run) {
    // No common run found - emit as removed+added
    const result: InlinePart[] = [];
    result.push({ value: joinTokens(a.slice(aS, aE)), type: "removed" });
    result.push({ value: joinTokens(b.slice(bS, bE)), type: "added" });
    return result;
  }

  debug("  ".repeat(depth) + "diffTokensRecursive: found run", run.len, "words:", a.slice(run.ai, run.ai + run.len).map(t => t.word).join(" "));

  // Recursively process before the match
  const result = diffTokensRecursive(a, b, aS, run.ai, bS, run.bi, depth + 1);

  // Add the matching run
  const remMatch = joinTokens(a.slice(run.ai, run.ai + run.len));
  const addMatch = joinTokens(b.slice(run.bi, run.bi + run.len));
  if (remMatch === addMatch) {
    result.push({ value: remMatch, type: "equal" });
  } else {
    // Words match when normalized but differ in punctuation/case
    result.push({ value: remMatch, type: "removed", minor: true });
    result.push({ value: addMatch, type: "added", minor: true });
  }

  // Recursively process after the match
  result.push(...diffTokensRecursive(a, b, run.ai + run.len, aE, run.bi + run.len, bE, depth + 1));

  return result;
}

/**
 * Find longest common run using normalized word comparison.
 */
function longestCommonRunNormalized(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  minLen: number
): { ai: number; bi: number; len: number } | null {
  const rows = aE - aS;
  const cols = bE - bS;
  if (rows === 0 || cols === 0) return null;

  // dp[i][j] = length of common run ending at a[aS+i-1], b[bS+j-1]
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));

  let bestLen = 0;
  let bestAi = 0;
  let bestBi = 0;

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      if (normalizeWord(a[aS + i - 1].word) === normalizeWord(b[bS + j - 1].word)) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > bestLen) {
          bestLen = dp[i][j];
          bestAi = aS + i - dp[i][j];
          bestBi = bS + j - dp[i][j];
        }
      }
    }
  }

  if (bestLen >= minLen) {
    return { ai: bestAi, bi: bestBi, len: bestLen };
  }
  return null;
}

// Keep the old suffix matching code below but simplify it (remove unused branches)
function extractCommonWordsOld(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    if (
      parts[i].type === "removed" &&
      i + 1 < parts.length &&
      parts[i + 1].type === "added"
    ) {
      const removedTokens = tokenize(parts[i].value);
      const addedTokens = tokenize(parts[i + 1].value);

      let prefixLen = 0;
      while (
        prefixLen < removedTokens.length &&
        prefixLen < addedTokens.length &&
        normalizeWord(removedTokens[prefixLen].word) === normalizeWord(addedTokens[prefixLen].word)
      ) {
        prefixLen++;
      }

      let suffixLen = 0;
      const remAfterPrefix = removedTokens.length - prefixLen;
      const addAfterPrefix = addedTokens.length - prefixLen;
      while (
        suffixLen < remAfterPrefix &&
        suffixLen < addAfterPrefix &&
        normalizeWord(removedTokens[removedTokens.length - 1 - suffixLen].word) ===
          normalizeWord(addedTokens[addedTokens.length - 1 - suffixLen].word)
      ) {
        suffixLen++;
      }

      if (prefixLen > 0) {
        const remPrefix = joinTokens(removedTokens.slice(0, prefixLen));
        const addPrefix = joinTokens(addedTokens.slice(0, prefixLen));
        if (remPrefix === addPrefix) {
          result.push({ value: remPrefix, type: "equal" });
        } else {
          result.push({ value: remPrefix, type: "removed", minor: true });
          result.push({ value: addPrefix, type: "added", minor: true });
        }
      }

      const remMiddleStart = prefixLen;
      const remMiddleEnd = removedTokens.length - suffixLen;
      const addMiddleStart = prefixLen;
      const addMiddleEnd = addedTokens.length - suffixLen;

      if (remMiddleStart < remMiddleEnd) {
        result.push({ value: joinTokens(removedTokens.slice(remMiddleStart, remMiddleEnd)), type: "removed" });
      }
      if (addMiddleStart < addMiddleEnd) {
        result.push({ value: joinTokens(addedTokens.slice(addMiddleStart, addMiddleEnd)), type: "added" });
      }

      if (suffixLen > 0) {
        const remSuffix = joinTokens(removedTokens.slice(removedTokens.length - suffixLen));
        const addSuffix = joinTokens(addedTokens.slice(addedTokens.length - suffixLen));
        if (remSuffix === addSuffix) {
          result.push({ value: remSuffix, type: "equal" });
        } else {
          result.push({ value: remSuffix, type: "removed", minor: true });
          result.push({ value: addSuffix, type: "added", minor: true });
        }
      }

      i += 2;
    } else {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

// ─── Inline diff pipeline ───────────────────────────────────────────────────

// Stop words that should be absorbed when isolated between changes
const STOP_WORDS = new Set([
  // Articles & determiners
  "a", "an", "the", "some", "any", "each", "every", "all", "most", "both",
  "few", "many", "much", "other", "another", "such", "same",
  // Pronouns
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "who", "whom", "whose", "which", "what", "that", "this", "these", "those",
  // Be verbs
  "am", "is", "are", "was", "were", "be", "been", "being",
  // Have verbs
  "has", "have", "had", "having",
  // Do verbs
  "do", "does", "did", "doing", "done",
  // Modal verbs
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // Common verbs
  "get", "got", "gets", "getting",
  "make", "made", "makes", "making",
  "go", "goes", "went", "gone", "going",
  "come", "comes", "came", "coming",
  "take", "takes", "took", "taken", "taking",
  "give", "gives", "gave", "given", "giving",
  "say", "says", "said", "saying",
  "see", "sees", "saw", "seen", "seeing",
  "know", "knows", "knew", "known", "knowing",
  "think", "thinks", "thought", "thinking",
  "become", "becomes", "became", "becoming",
  "seem", "seems", "seemed", "seeming",
  // Prepositions
  "to", "of", "in", "for", "on", "at", "by", "with", "from", "as",
  "into", "onto", "about", "through", "during", "before", "after",
  "above", "below", "between", "under", "over", "against", "among",
  "within", "without", "until", "since", "toward", "towards", "upon",
  // Conjunctions
  "and", "or", "but", "not", "no", "nor", "so", "yet",
  "if", "then", "than", "because", "although", "though", "while",
  "when", "where", "whether", "either", "neither",
  // Adverbs
  "very", "also", "just", "only", "even", "still", "already",
  "always", "never", "often", "sometimes", "usually", "rarely",
  "here", "there", "now", "then", "thus", "hence",
  "how", "why", "however", "therefore", "moreover", "furthermore",
  // Other common words
  "like", "more", "less", "well", "too", "being", "been",
]);

/** Check if text contains only stop words (and punctuation/whitespace) */
function isOnlyStopWords(s: string): boolean {
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // pure whitespace
  return tokens.every((t) => {
    const letters = t.toLowerCase().replace(/[^a-z]/g, "");
    return letters.length === 0 || STOP_WORDS.has(letters);
  });
}

/** Count words in a string */
function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if a part contains meaningful (non-stop-word) content */
function hasNonStopWords(part: InlinePart): boolean {
  const tokens = part.value.trim().split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    const letters = t.toLowerCase().replace(/[^a-z]/g, "");
    return letters.length > 0 && !STOP_WORDS.has(letters);
  });
}

/** Check if an equal part should be absorbed into surrounding changes */
function shouldAbsorbEqual(
  equalPart: InlinePart,
  prevPart: InlinePart | undefined,
  nextPart: InlinePart | undefined,
  allParts: InlinePart[],
  currentIdx: number
): boolean {
  const equalWords = countWords(equalPart.value);

  // Only absorb stop-word-only equal parts
  if (isOnlyStopWords(equalPart.value)) {
    const prevIsChange = prevPart && (prevPart.type === "removed" || prevPart.type === "added");
    const nextIsChange = nextPart && (nextPart.type === "removed" || nextPart.type === "added");

    // Must be between changes
    if (!(prevIsChange && nextIsChange)) return false;

    // Don't absorb if there's a meaningful equal nearby with only a single change between
    // This preserves "was" before "diagnosed" (single change "comprehensively" between)
    // But absorbs "of" between "copy/collection" and "reality/images" (multiple changes)

    // Look forward: check if the next equal (after skipping changes) is meaningful
    // and if there's only a single-word change before it
    let changesAfter = 0;
    let nextEqualHasMeaning = false;
    for (let j = currentIdx + 1; j < allParts.length; j++) {
      const part = allParts[j];
      if (part.type === "removed" || part.type === "added") {
        changesAfter++;
      } else if (part.type === "equal") {
        nextEqualHasMeaning = hasNonStopWords(part);
        break;
      }
    }

    // If there's a meaningful equal with only 1 change before it, don't absorb
    // This keeps "was" when followed by single removed "comprehensively" then "diagnosed"
    // But absorbs "of" when followed by removed+added pair then another equal
    if (nextEqualHasMeaning && changesAfter === 1) {
      return false;
    }

    // Otherwise absorb
    return true;
  }

  // Absorb single words surrounded by large changes on both sides
  if (equalWords === 1) {
    const prevIsChange = prevPart && (prevPart.type === "removed" || prevPart.type === "added");
    const nextIsChange = nextPart && (nextPart.type === "removed" || nextPart.type === "added");

    if (prevIsChange && nextIsChange) {
      const prevWords = countWords(prevPart.value);
      const nextWords = countWords(nextPart.value);
      // Absorb if surrounding changes are at least 3 words each
      if (prevWords >= 3 && nextWords >= 3) {
        return true;
      }
    }
  }

  return false;
}

/** Absorb equal/minor segments that are only stop words into adjacent changes */
function absorbStopWords(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    // Check if this equal segment should be absorbed
    if (p.type === "equal" && shouldAbsorbEqual(p, result[result.length - 1], parts[i + 1], parts, i)) {
      const prev1 = result[result.length - 1];
      const prev2 = result[result.length - 2];
      const next1 = parts[i + 1];
      const next2 = parts[i + 2];

      // Find which types are present in prev and next
      const prevRemoved = prev1?.type === "removed" ? prev1 : prev2?.type === "removed" ? prev2 : null;
      const prevAdded = prev1?.type === "added" ? prev1 : prev2?.type === "added" ? prev2 : null;
      const nextRemoved = next1?.type === "removed" ? next1 : next2?.type === "removed" ? next2 : null;
      const nextAdded = next1?.type === "added" ? next1 : next2?.type === "added" ? next2 : null;

      // Add to exactly one removed part (for left side rendering)
      // Prefer previous for text flow
      if (prevRemoved) {
        prevRemoved.value += p.value;
      } else if (nextRemoved) {
        nextRemoved.value = p.value + nextRemoved.value;
      }

      // Add to exactly one added part (for right side rendering)
      // Prefer previous for text flow
      if (prevAdded) {
        prevAdded.value += p.value;
      } else if (nextAdded) {
        nextAdded.value = p.value + nextAdded.value;
      }

      continue; // Skip adding this equal part
    }

    // Check if this is a minor removed/added pair that's only stop words - absorb it
    if (p.minor && (p.type === "removed" || p.type === "added") && isOnlyStopWords(p.value)) {
      const pairPart = parts[i + 1];
      // Check if this is part of a minor pair (removed followed by added, both stop-word-only)
      if (pairPart && pairPart.minor && pairPart.type !== p.type && isOnlyStopWords(pairPart.value)) {
        const removedVal = p.type === "removed" ? p.value : pairPart.value;
        const addedVal = p.type === "added" ? p.value : pairPart.value;

        const prev1 = result[result.length - 1];
        const prev2 = result[result.length - 2];
        const next1 = parts[i + 2];
        const next2 = parts[i + 3];

        // Find prev removed and added
        const prevRemoved = prev1?.type === "removed" ? prev1 : prev2?.type === "removed" ? prev2 : null;
        const prevAdded = prev1?.type === "added" ? prev1 : prev2?.type === "added" ? prev2 : null;
        // Find next removed and added
        const nextRemoved = next1?.type === "removed" ? next1 : next2?.type === "removed" ? next2 : null;
        const nextAdded = next1?.type === "added" ? next1 : next2?.type === "added" ? next2 : null;

        const hasAdjacentChange = prevRemoved || prevAdded || nextRemoved || nextAdded;

        if (hasAdjacentChange) {
          // Absorb into adjacent changes of same type
          if (prevRemoved) prevRemoved.value += removedVal;
          if (prevAdded) prevAdded.value += addedVal;
          if (nextRemoved) nextRemoved.value = removedVal + nextRemoved.value;
          if (nextAdded) nextAdded.value = addedVal + nextAdded.value;
          i++; // Skip the paired element too
          continue;
        }
      }
    }

    result.push(p);
  }

  return result;
}

/**
 * Multi-level inline diff:
 * 1. Contiguous word diff (3+ word runs only)
 * 2. For adjacent removed/added pairs, character-level diff for minor changes
 * 3. Absorb stop words isolated between changes
 */
export function computeInlineDiff(a: string, b: string): InlinePart[] {
  const raw = diffWordsContiguous(a, b);

  // Pair up adjacent removed/added — drill into char-level for minor changes
  let result: InlinePart[] = [];
  let i = 0;
  while (i < raw.length) {
    if (
      raw[i].type === "removed" &&
      i + 1 < raw.length &&
      raw[i + 1].type === "added"
    ) {
      const removed = raw[i].value;
      const added = raw[i + 1].value;

      if (isMinorChange(removed, added)) {
        result.push(...buildMinorPair(removed, added));
      } else {
        result.push(...refinePair(removed, added));
      }
      i += 2;
    } else {
      result.push(raw[i]);
      i++;
    }
  }

  // Absorb stop words, then mark remaining punctuation as minor
  result = absorbStopWords(result);
  return markPunctMinor(result);
}

/** Mark standalone (unpaired) punctuation-only removed/added parts as minor */
function markPunctMinor(parts: InlinePart[]): InlinePart[] {
  return parts.map((p) => {
    if ((p.type === "removed" || p.type === "added") && !p.minor && isPurePunctuation(p.value)) {
      return { ...p, minor: true };
    }
    return p;
  });
}

/** Build a minor (case-only / punctuation-only) removed+added pair with char children */
function buildMinorPair(removed: string, added: string): InlinePart[] {
  const charDiff = diffChars(removed, added);
  const removedChildren: InlinePart[] = [];
  const addedChildren: InlinePart[] = [];

  for (const part of charDiff) {
    if (!part.added && !part.removed) {
      removedChildren.push({ value: part.value, type: "equal" });
      addedChildren.push({ value: part.value, type: "equal" });
    } else if (part.removed) {
      removedChildren.push({ value: part.value, type: "removed", minor: true });
    } else if (part.added) {
      addedChildren.push({ value: part.value, type: "added", minor: true });
    }
  }

  return [
    { value: removed, type: "removed", children: removedChildren, minor: true },
    { value: added, type: "added", children: addedChildren, minor: true },
  ];
}

/**
 * For a non-minor removed/added pair, use contiguous word diff (min run 1)
 * to find sub-segments that are case-only changes vs truly removed/added.
 */
function refinePair(removed: string, added: string): InlinePart[] {
  const remTokens = tokenize(removed);
  const addTokens = tokenize(added);
  const a = tokenize(removed.toLowerCase());
  const b = tokenize(added.toLowerCase());
  // Use min run of 1 to catch single-word case changes
  const rawAnchors = findAnchors(a, b, 0, a.length, 0, b.length, 1);

  // Filter out anchors that are ONLY stop words - we don't want to split on them
  const anchors = rawAnchors.filter((anchor) => {
    const words = a.slice(anchor.ai, anchor.ai + anchor.len).map((t) => t.word);
    return !words.every((w) => isOnlyStopWords(w));
  });

  if (anchors.length === 0) {
    // No shared runs — just emit as-is
    return [
      { value: removed, type: "removed" },
      { value: added, type: "added" },
    ];
  }

  const parts: InlinePart[] = [];
  let remPos = 0, addPos = 0;

  for (const anchor of anchors) {
    // Removed text before this anchor
    const remBeforeTokens = anchor.ai - remPos;
    if (remBeforeTokens > 0) {
      const remSlice = remTokens.slice(remPos, anchor.ai);
      const text = joinTokens(remSlice);
      if (text) parts.push({ value: text, type: "removed" });
    }
    // Added text before this anchor
    const addBeforeTokens = anchor.bi - addPos;
    if (addBeforeTokens > 0) {
      const addSlice = addTokens.slice(addPos, anchor.bi);
      const text = joinTokens(addSlice);
      if (text) parts.push({ value: text, type: "added" });
    }

    // Equal segment — compare original case
    const remSlice = joinTokens(remTokens.slice(anchor.ai, anchor.ai + anchor.len));
    const addSlice = joinTokens(addTokens.slice(anchor.bi, anchor.bi + anchor.len));

    if (remSlice === addSlice) {
      parts.push({ value: remSlice, type: "equal" });
    } else {
      // Case-only or punctuation-only change
      parts.push(...buildMinorPair(remSlice, addSlice));
    }

    remPos = anchor.ai + anchor.len;
    addPos = anchor.bi + anchor.len;
  }

  // Remaining
  const remRemaining = joinTokens(remTokens.slice(remPos));
  const addRemaining = joinTokens(addTokens.slice(addPos));
  if (remRemaining) parts.push({ value: remRemaining, type: "removed" });
  if (addRemaining) parts.push({ value: addRemaining, type: "added" });

  // Apply stop word absorption within the refined parts
  return absorbStopWords(parts);
}

/** Detect if a change is minor: case-only, punctuation-only, or pure-punctuation swap */
function isMinorChange(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  // Strip punctuation and normalize whitespace
  const strip = (s: string) => s.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (strip(a) === strip(b)) return true;
  if (strip(a).toLowerCase() === strip(b).toLowerCase()) return true;
  if (isPurePunctuation(a) && isPurePunctuation(b)) return true;
  return false;
}

/** Check if text contains no letters or digits (only punctuation, symbols, whitespace) */
function isPurePunctuation(s: string): boolean {
  return s.replace(/[^a-zA-Z0-9]/g, "").length === 0;
}
