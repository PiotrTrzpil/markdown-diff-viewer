/**
 * Lightweight check for filtering minor parts in diff computation.
 * Used by move-detection to skip minor changes.
 */
import type { InlinePart } from "./inline-diff.js";
import { isPurePunctuation } from "../text/tokens.js";

/**
 * Quick check if a part represents a minor (insignificant) change.
 * Used during diff computation to filter out noise.
 */
export function isMinorPart(part: InlinePart): boolean {
  // Already marked as minor from recursive diff
  if (part.minor) return true;

  // Pure punctuation is always minor
  if ((part.type === "removed" || part.type === "added") && isPurePunctuation(part.value)) {
    return true;
  }

  return false;
}
