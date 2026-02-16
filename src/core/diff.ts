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
export type {
  DiffStatus,
  DiffPair,
  DiffMetrics,
  EqualPair,
  AddedPair,
  RemovedPair,
  ModifiedPair,
  SplitPair,
} from "./block-matching.js";
export {
  isEqualPair,
  isAddedPair,
  isRemovedPair,
  isModifiedPair,
  isSplitPair,
  createEqualPair,
  createAddedPair,
  createRemovedPair,
  createModifiedPair,
  createSplitPair,
} from "./block-matching.js";
export type { InlinePart } from "./inline-diff.js";

// Re-export rewrite rules for extension
export type { RewriteRule, MatchContext, AbsorbLevel } from "./rewrite-rules.js";
export {
  STOP_WORD_RULES,
  applyRewriteRules,
  applyRulesUntilStable,
  absorbStopWordsDeclarative,
  markAbsorbableParts,
} from "./rewrite-rules.js";

/**
 * Validate invariants for diff pairs.
 * With discriminated union types, structural invariants are enforced at compile time.
 * This function validates semantic invariants (e.g., inline diff consistency).
 */
export function validateDiffPairs(pairs: DiffPair[]): void {
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];

    // Validate semantic invariants for modified pairs
    if (pair.status === "modified") {
      validateInlineDiff(pair.inlineDiff, i);
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
