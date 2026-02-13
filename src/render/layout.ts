/**
 * Layout decisions for diff rendering.
 * Determines how diff pairs should be displayed (side-by-side vs stacked).
 */
import type { DiffPair } from "../core/diff.js";
import { countTotalWords, countSharedWords } from "../text/text-metrics.js";
import { RENDER_CONFIG } from "../config.js";

/** Thresholds for side-by-side display of long paragraphs */
const LONG_PARAGRAPH_WORDS = RENDER_CONFIG.LONG_PARAGRAPH_WORDS;
const MIN_SHARED_WORDS = RENDER_CONFIG.MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE;

/**
 * Check if a pair should be displayed side-by-side.
 * Returns true if the pair has enough shared content to align visually.
 */
export function isSideBySide(pair: DiffPair): boolean {
  if (pair.status === "equal") return true;
  if (pair.status === "modified" && pair.inlineDiff) {
    const sharedWords = countSharedWords(pair.inlineDiff);
    if (sharedWords === 0) return false;

    // For long paragraphs, require minimum shared words
    const totalWords = countTotalWords(pair.inlineDiff);
    if (totalWords >= LONG_PARAGRAPH_WORDS && sharedWords < MIN_SHARED_WORDS) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Layout mode for a group of pairs.
 */
export type LayoutMode = "side-by-side" | "stacked";

/**
 * A group of consecutive pairs with the same layout mode.
 */
export interface LayoutGroup {
  mode: LayoutMode;
  pairs: DiffPair[];
}

/**
 * Group consecutive pairs by their layout mode.
 * Side-by-side pairs are grouped individually, stacked pairs are grouped together.
 */
export function groupPairsForLayout(pairs: DiffPair[]): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  let i = 0;

  while (i < pairs.length) {
    if (isSideBySide(pairs[i])) {
      // Side-by-side pairs are grouped individually
      groups.push({ mode: "side-by-side", pairs: [pairs[i]] });
      i++;
    } else {
      // Collect consecutive stacked pairs into one group
      const stackedPairs: DiffPair[] = [];
      while (i < pairs.length && !isSideBySide(pairs[i])) {
        stackedPairs.push(pairs[i]);
        i++;
      }
      groups.push({ mode: "stacked", pairs: stackedPairs });
    }
  }

  return groups;
}
