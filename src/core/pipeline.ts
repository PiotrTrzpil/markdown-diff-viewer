/**
 * Diff pipeline — match blocks, then transform pairs through stages.
 */

import type { RootContent } from "mdast";
import { getDiffContext, type DiffContext } from "../config.js";
import { blockToText, getWrapTag } from "../text/parse.js";
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
import { detectParagraphMerges } from "./merge-detection.js";
import { detectMovedText } from "./move-detection.js";
import { detectParagraphSplits } from "./split-detection.js";
import { createDebugLogger, isDebugEnabled } from "../debug.js";

const debug = createDebugLogger("pipeline");

export type PipelineStage = (pairs: DiffPair[]) => DiffPair[];

export interface PipelineConfig {
  /** Explicit thresholds (preferred) */
  context?: DiffContext;
  validateInvariants?: boolean;
  additionalStages?: PipelineStage[];
}

/** Default stages bound to a context. */
export function createDefaultStages(ctx: DiffContext): readonly PipelineStage[] {
  return [
    (pairs) => pairUpUnmatchedBlocks(pairs, ctx),
    detectParagraphSplits,
    detectParagraphMerges,
    detectMovedText,
  ];
}

export function runPipeline(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
  config?: PipelineConfig,
): DiffPair[] {
  const ctx = config?.context ?? getDiffContext();
  const matches = findBlockMatches(
    leftBlocks.map(blockToText),
    rightBlocks.map(blockToText),
    ctx,
    leftBlocks.map(getWrapTag),
    rightBlocks.map(getWrapTag),
  );

  let pairs = createInitialPairs(leftBlocks, rightBlocks, matches);
  debug("pipeline:", leftBlocks.length, "→", rightBlocks.length, "blocks,", pairs.length, "initial pairs");

  for (const stage of [...createDefaultStages(ctx), ...(config?.additionalStages ?? [])]) {
    pairs = stage(pairs);
  }

  if (config?.validateInvariants ?? isDebugEnabled()) {
    const counts = { equal: 0, added: 0, removed: 0, modified: 0, split: 0 };
    for (const pair of pairs) counts[pair.status]++;
    debug("pipeline done:", counts);
  }

  return pairs;
}

function createInitialPairs(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[],
  matches: BlockMatch[],
): DiffPair[] {
  const result: DiffPair[] = [];
  let li = 0;
  let ri = 0;

  for (const match of matches) {
    while (li < match.leftIdx) {
      result.push(createRemovedPair(leftBlocks[li++]));
    }
    while (ri < match.rightIdx) {
      result.push(createAddedPair(rightBlocks[ri++]));
    }

    result.push(
      match.exact
        ? createEqualPair(leftBlocks[li], rightBlocks[ri])
        : createModifiedPair(leftBlocks[li], rightBlocks[ri]),
    );
    li++;
    ri++;
  }

  while (li < leftBlocks.length) {
    result.push(createRemovedPair(leftBlocks[li++]));
  }
  while (ri < rightBlocks.length) {
    result.push(createAddedPair(rightBlocks[ri++]));
  }

  return result;
}
