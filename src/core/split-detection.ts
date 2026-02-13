/**
 * Paragraph split detection.
 * Detects when a single paragraph is split into two (no text changes, just a break inserted).
 * Runs early in the pipeline, before move detection.
 */
import type { RootContent } from "mdast";
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
    const pair0 = pairs[i];
    const pair1 = pairs[i + 1];

    // Pattern 1: added block followed by modified block
    if (i + 1 < pairs.length && pair0.status === "added" && pair1?.status === "modified") {
      const splitResult = tryDetectSplit(pair1 as ModifiedPair, pair0 as AddedPair, "added-first");
      if (splitResult) {
        debug("Detected split (added+modified)");
        result.push(splitResult);
        i += 2;
        continue;
      }
    }

    // Pattern 2: modified block followed by added block
    if (i + 1 < pairs.length && pair0.status === "modified" && pair1?.status === "added") {
      const splitResult = tryDetectSplit(pair0 as ModifiedPair, pair1 as AddedPair, "modified-first");
      if (splitResult) {
        debug("Detected split (modified+added)");
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
