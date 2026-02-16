/**
 * Configuration constants for the diff algorithm.
 * Centralizes magic numbers for easier tuning and documentation.
 */

/**
 * Matching sensitivity levels for block pairing
 */
export type MatchingLevel = "strict" | "normal" | "loose";

export const MATCHING_LEVELS: Record<MatchingLevel, { similarity: number; sharedWords: number }> = {
  /** Strict: requires high similarity, fewer false matches */
  strict: { similarity: 0.7, sharedWords: 6 },
  /** Normal: balanced matching (default) */
  normal: { similarity: 0.6, sharedWords: 5 },
  /** Loose: matches paragraphs with less similarity, good for heavily edited text */
  loose: { similarity: 0.4, sharedWords: 3 },
};

/** Current matching level - can be set at runtime */
let currentMatchingLevel: MatchingLevel = "normal";

export function setMatchingLevel(level: MatchingLevel): void {
  currentMatchingLevel = level;
}

export function getMatchingLevel(): MatchingLevel {
  return currentMatchingLevel;
}

/**
 * Block-level matching thresholds (dynamic based on matching level)
 */
export const BLOCK_CONFIG = {
  /** Minimum bigram similarity (0-1) to consider blocks as matching. */
  get SIMILARITY_THRESHOLD(): number {
    return MATCHING_LEVELS[currentMatchingLevel].similarity;
  },
} as const;

/**
 * Word-level matching thresholds
 */
export const WORD_CONFIG = {
  /** Minimum contiguous matching words to anchor a diff segment */
  MIN_ANCHOR_RUN: 3,
  /** Minimum shared contiguous words to pair removed+added blocks (dynamic) */
  get MIN_SHARED_FOR_PAIRING(): number {
    return MATCHING_LEVELS[currentMatchingLevel].sharedWords;
  },
  /** Minimum shared words to detect moved text between blocks */
  MIN_SHARED_FOR_MOVED: 8,
  /** Minimum segment length (chars) to consider for moved text detection */
  MIN_SEGMENT_LENGTH_FOR_MOVED: 30,
} as const;

/**
 * Rendering thresholds
 */
export const RENDER_CONFIG = {
  /** Minimum words in an equal segment to trigger alignment break */
  ALIGN_MIN_WORDS: 5,
  /** Paragraphs with this many words or more are considered "long" */
  LONG_PARAGRAPH_WORDS: 20,
  /** Long paragraphs need at least this many shared words for side-by-side display */
  MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE: 3,
} as const;

/**
 * Boundary optimization thresholds
 */
export const BOUNDARY_CONFIG = {
  /** Max chars to absorb between same-type changes */
  SHORT_MATCH_THRESHOLD: 2,
} as const;

/**
 * Type representing the side of a diff (left = old, right = new)
 */
export type Side = "left" | "right";
