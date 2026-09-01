/**
 * Block-level markdown diff orchestration.
 */

import type { RootContent } from "mdast";
import { getDiffContext, type DiffContext } from "../config.js";
import { type DiffPair } from "./block-matching.js";
import { runPipeline } from "./pipeline.js";
import { debug, isDebugEnabled } from "../debug.js";

export { runPipeline, createDefaultStages, type PipelineStage, type PipelineConfig } from "./pipeline.js";

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
export type { InlinePart } from "./inline-part.js";
export { walkLeafParts, flattenParts } from "./inline-part.js";
export type { RewriteRule, MatchContext, AbsorbLevel } from "./rewrite-rules.js";
export {
  STOP_WORD_RULES,
  applyRewriteRules,
  applyRulesUntilStable,
  absorbStopWordsDeclarative,
  markAbsorbableParts,
} from "./rewrite-rules.js";
export { computeInlineDiff } from "./inline-diff.js";

/** LCS-based block diff of two mdast trees. */
export function diffBlocks(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
  ctx: DiffContext = getDiffContext(),
): DiffPair[] {
  const pairs = runPipeline(leftBlocks, rightBlocks, { context: ctx });

  if (isDebugEnabled()) {
    try {
      validateDiffPairs(pairs);
      debug("validateDiffPairs: ok");
    } catch (e) {
      console.error("[INVARIANT]", (e as Error).message);
    }
  }

  return pairs;
}

/** Semantic checks for modified-pair inline diffs (debug mode). */
export function validateDiffPairs(pairs: DiffPair[]): void {
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.status !== "modified") continue;
    validateInlineDiff(pair.inlineDiff, i);
  }
}

function validateInlineDiff(
  parts: import("./inline-part.js").InlinePart[],
  pairIndex: number,
): void {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.value === "") {
      throw new Error(`Invariant violation at pair ${pairIndex}, part ${i}: empty inline part`);
    }
  }
}
