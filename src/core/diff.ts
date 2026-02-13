/**
 * Main diff module - orchestrates block-level diffing of markdown content.
 */
import type { RootContent } from "mdast";
import { type DiffPair } from "./block-matching.js";
import { runPipeline } from "./pipeline.js";
import { debug, isDebugEnabled } from "../debug.js";

// Re-export pipeline for advanced usage
export { runPipeline, type PipelineStage, type PipelineConfig } from "./pipeline.js";

// Re-export types for consumers
export type { DiffStatus, DiffPair } from "./block-matching.js";
export type { InlinePart } from "./inline-diff.js";

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
 *
 * Pipeline stages:
 * 1. Block Matching - LCS-based matching of similar blocks
 * 2. Re-pair Low Similarity - Fix mismatched blocks
 * 3. Pair Unmatched - Pair consecutive removed/added blocks
 * 4. Move Detection - Detect moved text and paragraph splits
 */
export function diffBlocks(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
): DiffPair[] {
  const pairs = runPipeline(leftBlocks, rightBlocks);

  // Validate invariants in debug mode (additional validation with throw)
  if (isDebugEnabled()) {
    try {
      validateDiffPairs(pairs);
      debug("validateDiffPairs: all invariants passed");
    } catch (e) {
      console.error("[INVARIANT]", (e as Error).message);
    }
  }

  return pairs;
}

// Re-export computeInlineDiff for tests
export { computeInlineDiff } from "./inline-diff.js";
