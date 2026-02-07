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
 * Validate invariants for diff pairs.
 * Throws an error if any invariant is violated.
 */
export function validateDiffPairs(pairs: DiffPair[]): void {
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];

    switch (pair.status) {
      case "equal":
        if (!pair.left || !pair.right) {
          throw new Error(`Invariant violation at pair ${i}: status=equal but missing left or right`);
        }
        break;
      case "removed":
        if (!pair.left || pair.right !== null) {
          throw new Error(`Invariant violation at pair ${i}: status=removed but left missing or right not null`);
        }
        break;
      case "added":
        if (pair.left !== null || !pair.right) {
          throw new Error(`Invariant violation at pair ${i}: status=added but left not null or right missing`);
        }
        break;
      case "modified":
        if (!pair.left || !pair.right) {
          throw new Error(`Invariant violation at pair ${i}: status=modified but missing left or right`);
        }
        if (!pair.inlineDiff) {
          throw new Error(`Invariant violation at pair ${i}: status=modified but missing inlineDiff`);
        }
        // Validate that equal parts appear identically on both sides
        validateInlineDiff(pair.inlineDiff, i);
        break;
    }
  }
}

/**
 * Validate that equal/white text in inline diff appears identically on both sides.
 * For each adjacent removed+added pair (especially minor pairs with children),
 * verify that the equal children produce the same visible text.
 */
function validateInlineDiff(parts: import("./inline-diff.js").InlinePart[], pairIndex: number): void {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];

    // Check adjacent removed+added pairs (minor pairs)
    if (part.type === "removed" && nextPart?.type === "added") {
      if (part.minor && part.children && nextPart.minor && nextPart.children) {
        // Extract equal text from removed children (shown on left)
        const leftEqualText = part.children
          .filter(c => c.type === "equal")
          .map(c => c.value)
          .join("");

        // Extract equal text from added children (shown on right)
        const rightEqualText = nextPart.children
          .filter(c => c.type === "equal")
          .map(c => c.value)
          .join("");

        if (leftEqualText !== rightEqualText) {
          throw new Error(
            `Invariant violation at pair ${pairIndex}, part ${i}: ` +
            "minor pair equal text mismatch\n" +
            `  Left equal: "${leftEqualText.substring(0, 50)}"\n` +
            `  Right equal: "${rightEqualText.substring(0, 50)}"`,
          );
        }
      }
    }
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
  const final = detectMovedText(paired);

  // Validate invariants in debug mode
  if ((globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__) {
    try {
      validateDiffPairs(final);
      debug("validateDiffPairs: all invariants passed");
    } catch (e) {
      console.error("[INVARIANT]", (e as Error).message);
    }
  }

  return final;
}

// Re-export computeInlineDiff for tests
export { computeInlineDiff } from "./inline-diff.js";
