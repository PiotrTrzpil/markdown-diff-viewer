/**
 * Render-time hint computation for inline diff parts.
 * Separates render concerns from core diff computation.
 */
import type { InlinePart } from "../core/diff.js";
import { isPurePunctuation } from "../text/tokens.js";

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

  // Check if this is part of a minor pair (removed+added with same normalized content)
  if (part.type === "removed" && nextPart?.type === "added") {
    const a = part.value;
    const b = nextPart.value;
    if (a.toLowerCase() === b.toLowerCase()) return true;
    // Strip punctuation and normalize whitespace
    const strip = (s: string) => s.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    if (strip(a) === strip(b)) return true;
    if (strip(a).toLowerCase() === strip(b).toLowerCase()) return true;
    if (isPurePunctuation(a) && isPurePunctuation(b)) return true;
  }

  // Standalone punctuation-only change
  if ((part.type === "removed" || part.type === "added") && isPurePunctuation(part.value)) {
    return true;
  }

  return false;
}

/**
 * Check if an inline diff part represents a paragraph split indicator.
 * Paragraph splits are detected by the pilcrow marker (¶) in the value.
 */
export function isParagraphSplit(part: InlinePart): boolean {
  // Check for pilcrow marker in added parts
  return part.type === "added" && part.value.includes("¶");
}
