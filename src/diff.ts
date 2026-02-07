/**
 * Main diff module - orchestrates block-level diffing of markdown content.
 */
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";
import { computeInlineDiff } from "./inline-diff.js";
import {
  type DiffPair,
  findBlockMatches,
  rePairLowSimilarityBlocks,
  pairUpUnmatchedBlocks,
} from "./block-matching.js";
import { detectMovedText } from "./move-detection.js";

// Re-export types for consumers
export type { DiffStatus, DiffPair } from "./block-matching.js";
export type { InlinePart } from "./inline-diff.js";

/** Debug logging - enabled via --debug flag */
function debug(...args: unknown[]) {
  if ((globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__) {
    console.log("[DEBUG]", ...args);
  }
}

/**
 * LCS-based block diff.
 * Matches blocks by content similarity, then aligns with spacers.
 */
export function diffBlocks(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
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

// Re-export computeInlineDiff for tests
export { computeInlineDiff } from "./inline-diff.js";
