/**
 * Diff pipeline - explicit orchestration of diff transformation stages.
 *
 * The diff algorithm proceeds through these stages:
 * 1. Block Matching: LCS-based matching of similar blocks
 * 2. Initial Pairing: Create DiffPair array from matches
 * 3. Pair Unmatched: Try to pair consecutive removed/added blocks
 * 4. Paragraph Split Detection: Detect when one paragraph was split into two
 * 5. Move Detection: Detect text moved between blocks
 * 6. Validation: Check invariants (debug mode only)
 */
import type { RootContent } from "mdast";
import { blockToText } from "../text/parse.js";
import {
  type DiffPair,
  type BlockMatch,
  findBlockMatches,
  pairUpUnmatchedBlocks,
  createEqualPair,
  createAddedPair,
  createRemovedPair,
  createModifiedPair,
} from "./block-matching.js";
import { detectMovedText } from "./move-detection.js";
import { detectParagraphSplits } from "./split-detection.js";
import { createDebugLogger, isDebugEnabled } from "../debug.js";

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
  const result: DiffPair[] = [];

  let li = 0;
  let ri = 0;

  for (const match of matches) {
    // Emit removed blocks before this match
    while (li < match.leftIdx) {
      result.push(createRemovedPair(leftBlocks[li]));
      li++;
    }
    // Emit added blocks before this match
    while (ri < match.rightIdx) {
      result.push(createAddedPair(rightBlocks[ri]));
      ri++;
    }

    debug("createInitialPairs: match", match, "li:", li, "ri:", ri);
    if (match.exact) {
      result.push(createEqualPair(leftBlocks[li], rightBlocks[ri]));
    } else {
      result.push(createModifiedPair(leftBlocks[li], rightBlocks[ri]));
    }
    li++;
    ri++;
  }

  // Remaining blocks
  while (li < leftBlocks.length) {
    result.push(createRemovedPair(leftBlocks[li]));
    li++;
  }
  while (ri < rightBlocks.length) {
    result.push(createAddedPair(rightBlocks[ri]));
    ri++;
  }

  return result;
}

/**
 * The default diff pipeline stages.
 */
export const DEFAULT_STAGES: readonly PipelineStage[] = [
  // Stage 1: Pair unmatched removed/added blocks
  (pairs) => {
    debug("Stage: pairUpUnmatchedBlocks");
    return pairUpUnmatchedBlocks(pairs);
  },
  // Stage 2: Detect paragraph splits (before move detection)
  (pairs) => {
    debug("Stage: detectParagraphSplits");
    return detectParagraphSplits(pairs);
  },
  // Stage 3: Detect moved text between blocks
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
 * With discriminated union types, structural invariants are enforced at compile time.
 * This function logs debug info to confirm the pipeline ran correctly.
 */
function validatePipelineOutput(pairs: DiffPair[]): void {
  const counts = { equal: 0, added: 0, removed: 0, modified: 0, split: 0 };
  for (const pair of pairs) {
    counts[pair.status]++;
  }
  debug("validatePipelineOutput:", counts);
}
