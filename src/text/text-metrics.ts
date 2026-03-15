/**
 * Text metrics for diff analysis.
 * Utilities for measuring and comparing text in diff parts.
 */
import { countWords } from "./tokens.js";
import type { InlinePart } from "../core/inline-diff.js";

/**
 * Count total words in inline diff parts (equal + removed).
 * This represents the "left side" word count.
 */
export function countTotalWords(parts: InlinePart[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.type === "equal" || p.type === "removed") {
      total += countWords(p.value);
    }
  }
  return total;
}

/**
 * Count words in equal (shared) parts of inline diff.
 * These are words that appear on both sides unchanged.
 * Also counts equal content nested inside children (e.g. minor pairs).
 */
export function countSharedWords(parts: InlinePart[]): number {
  let shared = 0;
  for (const p of parts) {
    if (p.type === "equal") {
      shared += countWords(p.value);
    } else if (p.type === "removed" && p.children) {
      // Count equal content inside children (e.g. minor/whitespace pairs)
      // Only count from removed side to stay consistent with countTotalWords
      for (const child of p.children) {
        if (child.type === "equal") {
          shared += countWords(child.value);
        }
      }
    }
  }
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
