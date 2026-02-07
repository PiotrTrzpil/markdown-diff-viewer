/**
 * Configuration constants for the diff algorithm.
 * Centralizes magic numbers for easier tuning and documentation.
 */

/**
 * Block-level matching thresholds
 */
export const BLOCK_CONFIG = {
  /** Minimum bigram similarity (0-1) to consider blocks as matching */
  SIMILARITY_THRESHOLD: 0.4,
  /** Similarity above this is considered an exact match (no inline diff needed) */
  EXACT_MATCH_THRESHOLD: 0.99,
  /** Required improvement in similarity score to justify re-pairing blocks */
  REPAIR_IMPROVEMENT_THRESHOLD: 0.1,
} as const;

/**
 * Word-level matching thresholds
 */
export const WORD_CONFIG = {
  /** Minimum contiguous matching words to anchor a diff segment */
  MIN_ANCHOR_RUN: 3,
  /** Minimum shared contiguous words to pair removed+added blocks */
  MIN_SHARED_FOR_PAIRING: 5,
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
 * Type representing the side of a diff (left = old, right = new)
 */
export type Side = "left" | "right";
