/**
 * Algorithm constants and per-diff context.
 *
 * Match-level thresholds are explicit via {@link DiffContext}.
 * {@link runWithDiffContext} also keeps a re-entrant ambient stack so
 * remaining dynamic readers (e.g. WORD_CONFIG pairing threshold) stay
 * consistent for one `diffMarkdown` call.
 */

// ─── Match levels ────────────────────────────────────────────────────────────

export type MatchingLevel = "strict" | "normal" | "loose";

export const MATCHING_LEVELS: Record<
  MatchingLevel,
  { readonly similarity: number; readonly sharedWords: number }
> = {
  /** High similarity — fewer false block matches */
  strict: { similarity: 0.7, sharedWords: 6 },
  /** Balanced (default) */
  normal: { similarity: 0.6, sharedWords: 5 },
  /** Lower bar — better for heavily rewritten prose */
  loose: { similarity: 0.4, sharedWords: 3 },
};

export const MATCHING_LEVEL_NAMES = Object.keys(MATCHING_LEVELS) as MatchingLevel[];

export function isMatchingLevel(value: string): value is MatchingLevel {
  return value in MATCHING_LEVELS;
}

// ─── Context ─────────────────────────────────────────────────────────────────

/** Thresholds for a single diff invocation */
export interface DiffContext {
  readonly matchLevel: MatchingLevel;
  /** Min bigram similarity (0–1) to match two blocks */
  readonly similarity: number;
  /** Min shared contiguous words to pair removed+added blocks */
  readonly sharedWords: number;
}

/** Options for the public engine API */
export interface DiffOptions {
  /** Block-matching sensitivity (default `"normal"`) */
  matchLevel?: MatchingLevel;
}

/** Process default — CLI `setMatchingLevel` only */
let processDefaultLevel: MatchingLevel = "normal";
const contextStack: DiffContext[] = [];

export function createDiffContext(options?: DiffOptions): DiffContext {
  const matchLevel = options?.matchLevel ?? processDefaultLevel;
  if (!isMatchingLevel(matchLevel)) {
    throw new Error(
      `Unknown matching level "${String(matchLevel)}"; expected: ${MATCHING_LEVEL_NAMES.join(", ")}`,
    );
  }
  const { similarity, sharedWords } = MATCHING_LEVELS[matchLevel];
  return { matchLevel, similarity, sharedWords };
}

/** Run `fn` with `ctx` active (re-entrant). */
export function runWithDiffContext<T>(ctx: DiffContext, fn: () => T): T {
  contextStack.push(ctx);
  try {
    return fn();
  } finally {
    contextStack.pop();
  }
}

/**
 * Run `fn` under a context derived from `options`.
 * If `options` omits `matchLevel` and a context is already active, reuses it
 * (no extra stack frame). Otherwise creates a fresh context.
 */
export function withDiffOptions<T>(
  options: DiffOptions | undefined,
  fn: (ctx: DiffContext) => T,
): T {
  if (options?.matchLevel === undefined && hasActiveDiffContext()) {
    return fn(getDiffContext());
  }
  const ctx = createDiffContext(options);
  return runWithDiffContext(ctx, () => fn(ctx));
}

/** Active context, or one built from the process default. */
export function getDiffContext(): DiffContext {
  return contextStack[contextStack.length - 1] ?? createDiffContext();
}

export function hasActiveDiffContext(): boolean {
  return contextStack.length > 0;
}

/**
 * @deprecated Prefer `diffMarkdown(..., { matchLevel })`.
 * Sets the process-wide default when no option/context is provided (CLI).
 */
export function setMatchingLevel(level: MatchingLevel): void {
  if (!isMatchingLevel(level)) {
    throw new Error(
      `Unknown matching level "${String(level)}"; expected: ${MATCHING_LEVEL_NAMES.join(", ")}`,
    );
  }
  processDefaultLevel = level;
}

/** @deprecated Prefer `result.matchLevel` or {@link getDiffContext}. */
export function getMatchingLevel(): MatchingLevel {
  return getDiffContext().matchLevel;
}

// ─── Static algorithm constants ──────────────────────────────────────────────

/** Word-level matching (static; pairing threshold also available via context) */
export const WORD_CONFIG = {
  /** Min contiguous matching words to anchor an inline segment */
  MIN_ANCHOR_RUN: 3,
  /** Min shared words to detect moved text between blocks */
  MIN_SHARED_FOR_MOVED: 8,
  /** Min segment length (chars) for move detection */
  MIN_SEGMENT_LENGTH_FOR_MOVED: 30,
  /** Ambient pairing threshold — prefer `ctx.sharedWords` when available */
  get MIN_SHARED_FOR_PAIRING(): number {
    return getDiffContext().sharedWords;
  },
} as const;

/** Layout thresholds (side-by-side vs stacked) */
export const RENDER_CONFIG = {
  LONG_PARAGRAPH_WORDS: 20,
  MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE: 3,
  MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE: 0.15,
} as const;

/** Boundary optimization for inline diffs */
export const BOUNDARY_CONFIG = {
  /** Max chars to absorb between same-type changes */
  SHORT_MATCH_THRESHOLD: 2,
} as const;

export type Side = "left" | "right";
