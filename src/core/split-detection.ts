/**
 * Paragraph split detection.
 * Detects when a single paragraph is split into two (no text changes, just a break inserted).
 * Runs early in the pipeline, before move detection.
 */
import { blockToText } from "../text/parse.js";
import { similarity } from "../text/similarity.js";
import {
  type DiffPair,
  type ModifiedPair,
  type AddedPair,
  createSplitPair,
} from "./block-matching.js";
import { createDebugLogger } from "../debug.js";

const debug = createDebugLogger("split-detection");

/** Similarity threshold for paragraph split detection */
const SPLIT_SIMILARITY_THRESHOLD = 0.95;

/** Split pattern: which pair comes first in the sequence */
type SplitPattern = {
  modifiedPair: ModifiedPair;
  addedPair: AddedPair;
  order: "added-first" | "modified-first";
};

/**
 * Try to match a split pattern at the current position.
 * Returns the pattern details if found, null otherwise.
 */
function matchSplitPattern(pair0: DiffPair, pair1: DiffPair | undefined): SplitPattern | null {
  if (!pair1) return null;

  if (pair0.status === "added" && pair1.status === "modified") {
    return { modifiedPair: pair1, addedPair: pair0, order: "added-first" };
  }
  if (pair0.status === "modified" && pair1.status === "added") {
    return { modifiedPair: pair0, addedPair: pair1, order: "modified-first" };
  }
  return null;
}

/**
 * Detect paragraph splits in the diff pairs.
 *
 * Patterns detected:
 * - Pattern 1: added + modified where added.text + modified.right ≈ modified.left
 * - Pattern 2: modified + added where modified.right + added.text ≈ modified.left
 *
 * When detected, replaces the two pairs with a single SplitPair.
 */
export function detectParagraphSplits(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;

  while (i < pairs.length) {
    const pattern = matchSplitPattern(pairs[i], pairs[i + 1]);

    if (pattern) {
      const splitResult = tryDetectSplit(pattern.modifiedPair, pattern.addedPair, pattern.order);
      if (splitResult) {
        debug(`Detected split (${pattern.order})`);
        result.push(splitResult);
        i += 2;
        continue;
      }
    }

    // No split detected, keep the pair as-is
    result.push(pairs[i]);
    i++;
  }

  return result;
}

/**
 * Try to detect a paragraph split from a modified+added pair.
 * Returns a SplitPair if the combined text of the right sides matches the left.
 */
function tryDetectSplit(
  modifiedPair: ModifiedPair,
  addedPair: AddedPair,
  pattern: "added-first" | "modified-first",
): DiffPair | null {
  const originalText = blockToText(modifiedPair.left);
  const addedText = blockToText(addedPair.right);
  const modifiedRightText = blockToText(modifiedPair.right);

  // Combine texts based on pattern order
  const part1Text = pattern === "added-first" ? addedText : modifiedRightText;
  const part2Text = pattern === "added-first" ? modifiedRightText : addedText;
  const combinedNew = part1Text + " " + part2Text;

  const sim = similarity(combinedNew, originalText);

  debug(`tryDetectSplit (${pattern}):`);
  debug("  originalText:", originalText.substring(0, 50) + "...");
  debug("  part1Text:", part1Text.substring(0, 50) + "...");
  debug("  part2Text:", part2Text.substring(0, 50) + "...");
  debug("  similarity:", sim);

  if (sim > SPLIT_SIMILARITY_THRESHOLD) {
    // Find the split point in the original text
    const splitPoint = findSplitPoint(originalText, part1Text);

    // Determine which block is first/second based on pattern
    const firstPart = pattern === "added-first" ? addedPair.right : modifiedPair.right;
    const secondPart = pattern === "added-first" ? modifiedPair.right : addedPair.right;

    return createSplitPair(modifiedPair.left, firstPart, secondPart, splitPoint);
  }

  return null;
}

/**
 * Find the character index where the split occurs in the original text.
 */
function findSplitPoint(originalText: string, firstPartText: string): number {
  const part1Normalized = firstPartText.trim();
  const splitIdx = originalText.indexOf(part1Normalized);

  if (splitIdx >= 0) {
    return splitIdx + part1Normalized.length;
  }

  // Fallback: assume split is at the end of firstPart
  return firstPartText.length;
}
