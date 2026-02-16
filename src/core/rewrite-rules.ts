/**
 * Declarative pattern-based rewrite system for stop word absorption.
 * Replaces imperative logic with explicit, testable rules.
 */
import type { InlinePart } from "./inline-diff.js";
import { countWords, isPurePunctuation } from "../text/tokens.js";
import { isOnlyStopWords } from "../text/stopwords.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Absorption level for marking mode */
export type AbsorbLevel = "stopword" | "single";

export interface RewriteRule {
  /** Human-readable name for debugging */
  name: string;
  /** Pattern of part types to match at current position */
  pattern: InlinePart["type"][];
  /** Absorption level when marking (conservative vs aggressive) */
  absorbLevel: AbsorbLevel;
  /** Additional condition beyond type matching */
  condition: (match: InlinePart[], context: MatchContext) => boolean;
  /** Transform matched parts into replacement parts */
  transform: (match: InlinePart[], context: MatchContext) => InlinePart[];
}

export interface MatchContext {
  /** All parts in the array */
  allParts: InlinePart[];
  /** Index where the match starts */
  matchIndex: number;
  /** Parts already processed (for looking at prev context) */
  result: InlinePart[];
}

// ─── Condition Helpers ──────────────────────────────────────────────────────

/** Check if a part contains meaningful (non-stop-word) content */
function hasNonStopWords(part: InlinePart): boolean {
  const tokens = part.value.trim().split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    const letters = t.toLowerCase().replace(/[^a-z]/g, "");
    return letters.length > 0 && !isOnlyStopWords(letters);
  });
}

/**
 * Check if there's a meaningful equal part nearby with few changes between.
 * Used to preserve stop words that provide context for following content.
 */
function hasNearbyMeaningfulEqual(parts: InlinePart[], startIdx: number): { found: boolean; changesCount: number } {
  let changesCount = 0;
  for (let j = startIdx; j < parts.length; j++) {
    const part = parts[j];
    if (part.type === "removed" || part.type === "added") {
      changesCount++;
    } else if (part.type === "equal") {
      return { found: hasNonStopWords(part), changesCount };
    }
  }
  return { found: false, changesCount };
}

/** Find an adjacent part of a specific type from result or upcoming parts */
function findAdjacentByType(
  type: "removed" | "added",
  result: InlinePart[],
  upcoming: InlinePart[],
): InlinePart | null {
  // Check result (previous parts) - look back up to 2
  for (let i = result.length - 1; i >= Math.max(0, result.length - 2); i--) {
    if (result[i].type === type) return result[i];
  }
  // Check upcoming parts - look ahead up to 2
  for (let i = 0; i < Math.min(2, upcoming.length); i++) {
    if (upcoming[i].type === type) return upcoming[i];
  }
  return null;
}

// ─── Transform Helpers ──────────────────────────────────────────────────────

/**
 * Absorb a value into adjacent removed/added parts.
 * Mutates the target parts to include the absorbed content.
 */
function absorbValue(
  value: string,
  result: InlinePart[],
  upcoming: InlinePart[],
  removedVal = value,
  addedVal = value,
): void {
  const prevRemoved = findAdjacentByType("removed", result, []);
  const nextRemoved = findAdjacentByType("removed", [], upcoming);
  const prevAdded = findAdjacentByType("added", result, []);
  const nextAdded = findAdjacentByType("added", [], upcoming);

  if (prevRemoved) prevRemoved.value += removedVal;
  else if (nextRemoved) nextRemoved.value = removedVal + nextRemoved.value;

  if (prevAdded) prevAdded.value += addedVal;
  else if (nextAdded) nextAdded.value = addedVal + nextAdded.value;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

/**
 * Rule: Absorb equal stop-word-only parts between changes.
 * Pattern: [change] [equal:stop-words] [change]
 */
const absorbEqualStopWords: RewriteRule = {
  name: "absorb-equal-stop-words",
  pattern: ["equal"],
  absorbLevel: "stopword",
  condition: (match, ctx) => {
    const equalPart = match[0];

    // Must be stop-word-only
    if (!isOnlyStopWords(equalPart.value)) return false;

    // Must be between changes
    const prev = ctx.result[ctx.result.length - 1];
    const next = ctx.allParts[ctx.matchIndex + 1];
    const prevIsChange = prev && (prev.type === "removed" || prev.type === "added");
    const nextIsChange = next && (next.type === "removed" || next.type === "added");
    if (!prevIsChange || !nextIsChange) return false;

    // Don't absorb if nearby meaningful equal with single change between
    const { found: nextEqualHasMeaning, changesCount } = hasNearbyMeaningfulEqual(
      ctx.allParts,
      ctx.matchIndex + 1,
    );
    if (nextEqualHasMeaning && changesCount === 1) return false;

    return true;
  },
  transform: (match, ctx) => {
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 1);
    absorbValue(match[0].value, ctx.result, upcoming);
    return []; // Remove the equal part
  },
};

/**
 * Rule: Absorb single non-stop words between large changes.
 * Pattern: [change:3+words] [equal:1word] [change:3+words]
 */
const absorbSingleWordBetweenLargeChanges: RewriteRule = {
  name: "absorb-single-word-large-changes",
  pattern: ["equal"],
  absorbLevel: "single",
  condition: (match, ctx) => {
    const equalPart = match[0];
    if (countWords(equalPart.value) !== 1) return false;

    const prev = ctx.result[ctx.result.length - 1];
    const next = ctx.allParts[ctx.matchIndex + 1];
    const prevIsChange = prev && (prev.type === "removed" || prev.type === "added");
    const nextIsChange = next && (next.type === "removed" || next.type === "added");
    if (!prevIsChange || !nextIsChange) return false;

    const prevWords = countWords(prev.value);
    const nextWords = countWords(next.value);
    return prevWords >= 3 && nextWords >= 3;
  },
  transform: (match, ctx) => {
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 1);
    absorbValue(match[0].value, ctx.result, upcoming);
    return [];
  },
};

/**
 * Rule: Absorb minor removed+added pairs that are only stop words.
 * Pattern: [removed:minor,stop-words] [added:minor,stop-words]
 */
const absorbMinorStopWordPair: RewriteRule = {
  name: "absorb-minor-stop-word-pair",
  pattern: ["removed", "added"],
  absorbLevel: "stopword",
  condition: (match, ctx) => {
    const [removed, added] = match;

    // Both must be minor and stop-word-only
    if (!removed.minor || !isOnlyStopWords(removed.value)) return false;
    if (!added.minor || !isOnlyStopWords(added.value)) return false;

    // Must have adjacent parts to absorb into
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 2);
    const prevRemoved = findAdjacentByType("removed", ctx.result, []);
    const nextRemoved = findAdjacentByType("removed", [], upcoming);
    const prevAdded = findAdjacentByType("added", ctx.result, []);
    const nextAdded = findAdjacentByType("added", [], upcoming);

    const canAbsorbRemoved = prevRemoved || nextRemoved;
    const canAbsorbAdded = prevAdded || nextAdded;
    if (!canAbsorbRemoved || !canAbsorbAdded) return false;

    // Don't concatenate punctuation-only parts
    const targetRemoved = prevRemoved || nextRemoved;
    const targetAdded = prevAdded || nextAdded;
    const wouldConcatPunct =
      (targetRemoved && isPurePunctuation(targetRemoved.value) && isPurePunctuation(removed.value)) ||
      (targetAdded && isPurePunctuation(targetAdded.value) && isPurePunctuation(added.value));
    if (wouldConcatPunct) return false;

    return true;
  },
  transform: (match, ctx) => {
    const [removed, added] = match;
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 2);
    absorbValue("", ctx.result, upcoming, removed.value, added.value);
    return [];
  },
};

/**
 * Rule: Absorb minor added+removed pairs (reverse order).
 * Pattern: [added:minor,stop-words] [removed:minor,stop-words]
 */
const absorbMinorStopWordPairReverse: RewriteRule = {
  name: "absorb-minor-stop-word-pair-reverse",
  pattern: ["added", "removed"],
  absorbLevel: "stopword",
  condition: (match, ctx) => {
    const [added, removed] = match;

    // Both must be minor and stop-word-only
    if (!added.minor || !isOnlyStopWords(added.value)) return false;
    if (!removed.minor || !isOnlyStopWords(removed.value)) return false;

    // Must have adjacent parts to absorb into
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 2);
    const prevRemoved = findAdjacentByType("removed", ctx.result, []);
    const nextRemoved = findAdjacentByType("removed", [], upcoming);
    const prevAdded = findAdjacentByType("added", ctx.result, []);
    const nextAdded = findAdjacentByType("added", [], upcoming);

    const canAbsorbRemoved = prevRemoved || nextRemoved;
    const canAbsorbAdded = prevAdded || nextAdded;
    if (!canAbsorbRemoved || !canAbsorbAdded) return false;

    // Don't concatenate punctuation-only parts
    const targetRemoved = prevRemoved || nextRemoved;
    const targetAdded = prevAdded || nextAdded;
    const wouldConcatPunct =
      (targetRemoved && isPurePunctuation(targetRemoved.value) && isPurePunctuation(removed.value)) ||
      (targetAdded && isPurePunctuation(targetAdded.value) && isPurePunctuation(added.value));
    if (wouldConcatPunct) return false;

    return true;
  },
  transform: (match, ctx) => {
    const [added, removed] = match;
    const upcoming = ctx.allParts.slice(ctx.matchIndex + 2);
    absorbValue("", ctx.result, upcoming, removed.value, added.value);
    return [];
  },
};

// ─── Rule Set ───────────────────────────────────────────────────────────────

/**
 * Ordered list of stop word absorption rules.
 * Rules are applied in priority order (first match wins).
 */
export const STOP_WORD_RULES: RewriteRule[] = [
  // Multi-part patterns first (more specific)
  absorbMinorStopWordPair,
  absorbMinorStopWordPairReverse,
  // Single-part patterns
  absorbEqualStopWords,
  absorbSingleWordBetweenLargeChanges,
];

// ─── Rule Engine ────────────────────────────────────────────────────────────

/**
 * Check if a pattern matches at the given index.
 */
function matchesPattern(
  pattern: InlinePart["type"][],
  parts: InlinePart[],
  index: number,
): InlinePart[] | null {
  if (index + pattern.length > parts.length) return null;

  const match: InlinePart[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const part = parts[index + i];
    if (part.type !== pattern[i]) return null;
    match.push(part);
  }
  return match;
}

/**
 * Apply rewrite rules to transform parts.
 * Iterates through parts, applying the first matching rule at each position.
 */
export function applyRewriteRules(parts: InlinePart[], rules: RewriteRule[]): InlinePart[] {
  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    let matched = false;

    // Try each rule in priority order
    for (const rule of rules) {
      const match = matchesPattern(rule.pattern, parts, i);
      if (!match) continue;

      const ctx: MatchContext = {
        allParts: parts,
        matchIndex: i,
        result,
      };

      if (rule.condition(match, ctx)) {
        const transformed = rule.transform(match, ctx);
        result.push(...transformed);
        i += rule.pattern.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

/**
 * Apply rules iteratively until no more changes.
 * Handles cascading absorption (e.g., absorbing "the" then "of").
 */
export function applyRulesUntilStable(parts: InlinePart[], rules: RewriteRule[], maxIterations = 10): InlinePart[] {
  let current = parts;
  let iteration = 0;

  while (iteration < maxIterations) {
    const next = applyRewriteRules(current, rules);
    if (next.length === current.length && next.every((p, i) => p === current[i])) {
      break; // No changes made
    }
    current = next;
    iteration++;
  }

  return current;
}

/**
 * Main entry point: absorb stop words using declarative rules.
 */
export function absorbStopWordsDeclarative(parts: InlinePart[]): InlinePart[] {
  return applyRulesUntilStable(parts, STOP_WORD_RULES);
}

// ─── Marking Mode (for runtime CSS control) ─────────────────────────────────

/**
 * Apply rules in "mark only" mode: instead of transforming parts,
 * mark them with absorbLevel for CSS-based runtime control.
 */
function applyRulesMarkOnly(parts: InlinePart[], rules: RewriteRule[]): InlinePart[] {
  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    let matched = false;

    for (const rule of rules) {
      const match = matchesPattern(rule.pattern, parts, i);
      if (!match) continue;

      const ctx: MatchContext = {
        allParts: parts,
        matchIndex: i,
        result,
      };

      if (rule.condition(match, ctx)) {
        // Mark matched parts instead of transforming
        for (const part of match) {
          result.push({ ...part, absorbLevel: rule.absorbLevel });
        }
        i += rule.pattern.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

/**
 * Mark parts that would be absorbed, without actually absorbing them.
 * Reuses the same rule conditions as absorbStopWordsDeclarative.
 */
export function markAbsorbableParts(parts: InlinePart[]): InlinePart[] {
  return applyRulesMarkOnly(parts, STOP_WORD_RULES);
}
