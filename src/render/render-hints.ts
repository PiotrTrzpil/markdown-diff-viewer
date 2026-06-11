/**
 * Render-time hint computation for inline diff parts.
 * Separates render concerns from core diff computation.
 */
import type { InlinePart } from "../core/diff.js";
import { isPurePunctuation, isMinorTextChange } from "../text/tokens.js";

// Re-export for convenience
export { isPurePunctuation };

/**
 * Determine if an inline diff part represents a minor change.
 * Minor changes are case-only, punctuation-only, or pure-punctuation swaps.
 * Used to apply subtle styling instead of full highlight.
 */
export function isMinorChange(part: InlinePart, nextPart?: InlinePart): boolean {
  // Already marked as minor (from diff computation phase)
  if (part.minor) return true;

  // A minor pair: removed+added with the same normalized content
  if (part.type === "removed" && nextPart?.type === "added" && isMinorTextChange(part.value, nextPart.value)) {
    return true;
  }

  // Standalone punctuation-only change
  return (part.type === "removed" || part.type === "added") && isPurePunctuation(part.value);
}
