/**
 * Boundary optimization for inline diffs.
 *
 * Two passes:
 * 1. Shift diffs to word boundaries (greedy: slide right then left, stop at first word edge)
 * 2. Absorb very short non-whitespace equal segments between same-type changes
 */
import type { InlinePart } from "./inline-diff.js";
import { BOUNDARY_CONFIG } from "../config.js";

// ─── Word Boundary Detection ─────────────────────────────────────────────────

/**
 * Is the position between `before` and `after` a word boundary?
 * null represents string edge (start/end of text).
 */
function isWordBoundary(before: string | null, after: string | null): boolean {
  if (before === null || after === null) return true;
  if (before === "\n" || after === "\n") return true;
  const bWs = /\s/.test(before);
  const aWs = /\s/.test(after);
  return bWs !== aWs;
}

// ─── Diff Shifting ───────────────────────────────────────────────────────────

/**
 * Shift a diff to the nearest word boundary.
 *
 * The diff can slide along a run of identical characters at its seams.
 * We greedily shift right, then left, stopping as soon as both the
 * start and end of the diff land on word boundaries.
 *
 * For example: "The c" + "at c" + "ame"
 * Shifted right to: "The " + "cat " + "came" (word boundary — done)
 */
export function shiftToBetterBoundary(
  before: string,
  diff: string,
  after: string,
): { before: string; diff: string; after: string } {
  if (diff.length === 0) return { before, diff, after };

  const bothGood = (b: string, d: string, a: string) =>
    isWordBoundary(b.length > 0 ? b[b.length - 1] : null, d[0]) &&
    isWordBoundary(d[d.length - 1], a.length > 0 ? a[0] : null);

  if (bothGood(before, diff, after)) return { before, diff, after };

  // Try shifting right: requires diff[-1] === after[0]
  let b = before, d = diff, a = after;
  while (a.length > 0 && d[d.length - 1] === a[0]) {
    b = b + d[0];
    d = d.slice(1) + a[0];
    a = a.slice(1);
    if (bothGood(b, d, a)) return { before: b, diff: d, after: a };
  }

  // Try shifting left from original: requires before[-1] === diff[0]
  b = before; d = diff; a = after;
  while (b.length > 0 && b[b.length - 1] === d[0]) {
    a = d[d.length - 1] + a;
    d = b[b.length - 1] + d.slice(0, -1);
    b = b.slice(0, -1);
    if (bothGood(b, d, a)) return { before: b, diff: d, after: a };
  }

  // No word boundary reachable — stay at original position
  return { before, diff, after };
}

// ─── Short Match Absorption ──────────────────────────────────────────────────

/**
 * Absorb very short equal segments between same-type changes.
 *
 * Pattern: [removed][equal:≤N chars][removed] -> [removed with children]
 * Pattern: [added][equal:≤N chars][added] -> [added with children]
 *
 * Whitespace-only equal parts are never absorbed (preserves word boundaries).
 * The absorbed parts are preserved as children for rendering.
 */
export function absorbShortMatches(
  parts: InlinePart[],
  maxLen: number = BOUNDARY_CONFIG.SHORT_MATCH_THRESHOLD,
): InlinePart[] {
  if (parts.length < 3) return parts;

  const result: InlinePart[] = [];

  let i = 0;
  while (i < parts.length) {
    if (
      i + 2 < parts.length &&
      (parts[i].type === "removed" || parts[i].type === "added") &&
      parts[i + 1].type === "equal" &&
      parts[i + 1].value.length <= maxLen &&
      parts[i + 2].type === parts[i].type &&
      !/^\s+$/.test(parts[i + 1].value)
    ) {
      const flatten = (p: InlinePart): InlinePart[] =>
        p.children?.length ? p.children : [{ value: p.value, type: p.type, minor: p.minor }];
      const flatA = flatten(parts[i]);
      const flatC = flatten(parts[i + 2]);

      const merged: InlinePart = {
        value: parts[i].value + parts[i + 1].value + parts[i + 2].value,
        type: parts[i].type,
        children: [...flatA, { value: parts[i + 1].value, type: "equal" as const }, ...flatC],
      };

      if (parts[i].minor || parts[i + 2].minor) {
        merged.minor = true;
      }
      result.push(merged);
      i += 3;
    } else {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

// ─── Boundary Optimization for Diff Parts ────────────────────────────────────

/**
 * Apply boundary optimization to adjacent equal-change-equal sequences.
 * Shifts each change to land on word boundaries where possible.
 */
function optimizeSingleDiffs(parts: InlinePart[]): InlinePart[] {
  if (parts.length < 2) return parts;

  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    if (parts[i].type === "removed" || parts[i].type === "added") {
      const prevEqual = result.length > 0 && result[result.length - 1].type === "equal"
        ? result[result.length - 1]
        : null;
      const nextEqual = i + 1 < parts.length && parts[i + 1].type === "equal"
        ? parts[i + 1]
        : null;

      if (prevEqual || nextEqual) {
        const before = prevEqual?.value ?? "";
        const diff = parts[i].value;
        const after = nextEqual?.value ?? "";

        const optimized = shiftToBetterBoundary(before, diff, after);

        if (prevEqual) {
          prevEqual.value = optimized.before;
          if (prevEqual.value === "") result.pop();
        }

        if (optimized.diff !== "") {
          result.push({ ...parts[i], value: optimized.diff });
        }

        if (nextEqual) {
          if (optimized.after !== "") {
            parts[i + 1] = { ...nextEqual, value: optimized.after };
          } else {
            i++;
          }
        }

        i++;
      } else {
        result.push(parts[i]);
        i++;
      }
    } else {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Apply boundary optimizations to inline diff parts.
 *
 * 1. Shift diffs to word boundary positions
 * 2. Absorb very short matches between same-type changes
 */
export function optimizeBoundaries(parts: InlinePart[]): InlinePart[] {
  if (parts.length === 0) return parts;

  let result = optimizeSingleDiffs(parts);

  let prevLength = -1;
  while (result.length !== prevLength) {
    prevLength = result.length;
    result = absorbShortMatches(result);
  }

  return result.filter(p => p.value !== "");
}
