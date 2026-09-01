/**
 * Text metrics for diff analysis.
 * Utilities for measuring and comparing text in diff parts.
 */
import { countWords } from "./tokens.js";
import { walkLeafParts } from "../core/inline-part.js";
import type { InlinePart } from "../core/inline-part.js";

/**
 * Count total words in inline diff parts (equal + removed).
 * This represents the "left side" word count. Equal text appears once
 * in the stream, so it is not double-counted.
 */
export function countTotalWords(parts: InlinePart[]): number {
  let total = 0;
  walkLeafParts(parts, (part) => {
    if (part.type === "equal" || part.type === "removed") {
      total += countWords(part.value);
    }
  });
  return total;
}

/**
 * Count words in equal (shared) parts of inline diff.
 * Relocated removed text still lives on the left; counting it as shared
 * keeps the paragraph in inline layout so hosts can paint the move.
 */
export function countSharedWords(parts: InlinePart[]): number {
  let shared = 0;
  walkLeafParts(parts, (part) => {
    if (part.type === "equal") {
      shared += countWords(part.value);
    } else if (part.moved && part.type === "removed") {
      shared += countWords(part.value);
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
