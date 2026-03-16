/**
 * Text metrics for diff analysis.
 * Utilities for measuring and comparing text in diff parts.
 */
import { countWords } from "./tokens.js";
import { walkLeafParts } from "../core/inline-diff.js";
import type { InlinePart } from "../core/inline-diff.js";

/**
 * Count total words in inline diff parts (equal + removed).
 * This represents the "left side" word count.
 * Handles parts with children by walking leaf parts only.
 */
export function countTotalWords(parts: InlinePart[]): number {
  let total = 0;
  walkLeafParts(parts, (part, parentType) => {
    // Count words from equal parts and removed-side parts
    // For children: parentType tells us which side this leaf belongs to
    if (part.type === "equal") {
      // Equal at top level, or equal inside a removed parent (left side)
      if (!parentType || parentType === "removed") {
        total += countWords(part.value);
      }
    } else if (part.type === "removed") {
      total += countWords(part.value);
    }
  });
  return total;
}

/**
 * Count words in equal (shared) parts of inline diff.
 * These are words that appear on both sides unchanged.
 * Also counts equal content nested inside children (e.g. minor pairs).
 */
export function countSharedWords(parts: InlinePart[]): number {
  let shared = 0;
  walkLeafParts(parts, (part, parentType) => {
    if (part.type === "equal") {
      // Top-level equal, or equal inside a removed parent
      if (!parentType || parentType === "removed") {
        shared += countWords(part.value);
      }
    }
  });
  return shared;
}

/**
 * Calculate the ratio of shared words to total words.
 * Returns 0-1 where 1 means all words are shared.
 */
export function sharedWordRatio(parts: InlinePart[]): number {
  const total = countTotalWords(parts);
  if (total === 0) return 0;
  return countSharedWords(parts) / total;
}
