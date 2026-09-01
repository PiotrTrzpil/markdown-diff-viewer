/**
 * Whole-sentence check for move detection.
 * Fragments mid-sentence make a messy move highlight, so only complete
 * sentences (or whole blocks, handled by the caller) are eligible.
 */

const LEADING_MD = /^(?:[*_>`#]+\s*)+/;
const START = /^["'“‘(]*[A-ZÀ-ÖØ-Þ0-9]/;
const END = /[.!?…]["'”’)]*$/;

/** True when `text` is one or more complete sentences, not a mid-sentence slice. */
export function isWholeSentenceSpan(text: string): boolean {
  const t = text.trim().replace(LEADING_MD, "");
  if (t.length === 0) return false;
  return START.test(t) && END.test(t);
}
