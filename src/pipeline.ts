/**
 * Diff pipeline - explicit orchestration of diff transformation stages.
 *
 * The diff algorithm proceeds through these stages:
 * 1. Block Matching: LCS-based matching of similar blocks
 * 2. Initial Pairing: Create DiffPair array from matches
 * 3. Re-pair Low Similarity: Fix mismatched blocks with low similarity
 * 4. Pair Unmatched: Try to pair consecutive removed/added blocks
 * 5. Move Detection: Detect text moved between blocks and paragraph splits
 * 6. Validation: Check invariants (debug mode only)
 */
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";
import { computeInlineDiff } from "./inline-diff.js";
import {
  type DiffPair,
  type BlockMatch,
  findBlockMatches,
  rePairLowSimilarityBlocks,
  pairUpUnmatchedBlocks,
} from "./block-matching.js";
import { detectMovedText } from "./move-detection.js";
import { createDebugLogger, isDebugEnabled } from "./debug.js";

const debug = createDebugLogger("pipeline");

/**
 * Pipeline stage function type.
 * Each stage transforms DiffPair[] to DiffPair[].
 */
export type PipelineStage = (pairs: DiffPair[]) => DiffPair[];

/**
 * Pipeline configuration.
 */
export interface PipelineConfig {
  /** Enable debug validation of invariants */
  validateInvariants?: boolean;
  /** Custom stages to run after default stages */
  additionalStages?: PipelineStage[];
}

/**
 * Create initial DiffPair array from block matches.
 */
function createInitialPairs(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
  matches: BlockMatch[],
): DiffPair[] {
  const leftTexts = leftBlocks.map(blockToText);
  const rightTexts = rightBlocks.map(blockToText);
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

    debug("createInitialPairs: match", match, "li:", li, "ri:", ri);
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

/**
 * The default diff pipeline stages.
 */
export const DEFAULT_STAGES: readonly PipelineStage[] = [
  // Stage 1: Re-pair low similarity blocks
  (pairs) => {
    debug("Stage: rePairLowSimilarityBlocks");
    return rePairLowSimilarityBlocks(pairs);
  },
  // Stage 2: Pair unmatched removed/added blocks
  (pairs) => {
    debug("Stage: pairUpUnmatchedBlocks");
    return pairUpUnmatchedBlocks(pairs);
  },
  // Stage 3: Detect moved text and paragraph splits
  (pairs) => {
    debug("Stage: detectMovedText");
    return detectMovedText(pairs);
  },
];

/**
 * Run the diff pipeline on blocks.
 *
 * @param leftBlocks - Old/left markdown blocks
 * @param rightBlocks - New/right markdown blocks
 * @param config - Optional pipeline configuration
 * @returns Array of diff pairs
 */
export function runPipeline(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
  config?: PipelineConfig,
): DiffPair[] {
  const leftTexts = leftBlocks.map(blockToText);
  const rightTexts = rightBlocks.map(blockToText);

  debug("Pipeline start:", leftBlocks.length, "left blocks,", rightBlocks.length, "right blocks");

  // Step 1: Find block matches using LCS
  debug("Step: findBlockMatches");
  const matches = findBlockMatches(leftTexts, rightTexts);

  // Step 2: Create initial pairs from matches
  debug("Step: createInitialPairs");
  let pairs = createInitialPairs(leftBlocks, rightBlocks, matches);
  debug("Initial pairs:", pairs.length);

  // Step 3: Run pipeline stages
  const stages = [...DEFAULT_STAGES, ...(config?.additionalStages ?? [])];
  for (const stage of stages) {
    pairs = stage(pairs);
  }

  debug("Pipeline complete:", pairs.length, "pairs");

  // Step 4: Validate invariants in debug mode
  if (config?.validateInvariants ?? isDebugEnabled()) {
    validatePipelineOutput(pairs);
  }

  return pairs;
}

/**
 * Validate pipeline output invariants.
 */
function validatePipelineOutput(pairs: DiffPair[]): void {
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];

    switch (pair.status) {
      case "equal":
        if (!pair.left || !pair.right) {
          console.error(`[INVARIANT] pair ${i}: status=equal but missing left or right`);
        }
        break;
      case "removed":
        if (!pair.left || pair.right !== null) {
          console.error(`[INVARIANT] pair ${i}: status=removed but left missing or right not null`);
        }
        break;
      case "added":
        if (pair.left !== null || !pair.right) {
          console.error(`[INVARIANT] pair ${i}: status=added but left not null or right missing`);
        }
        break;
      case "modified":
        if (!pair.left || !pair.right) {
          console.error(`[INVARIANT] pair ${i}: status=modified but missing left or right`);
        }
        if (!pair.inlineDiff) {
          console.error(`[INVARIANT] pair ${i}: status=modified but missing inlineDiff`);
        }
        break;
    }
  }
  debug("validatePipelineOutput: complete");
}
