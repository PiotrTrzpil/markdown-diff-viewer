/**
 * VS Code-style boundary optimization for inline diffs.
 *
 * Implements three improvements:
 * 1. Boundary Scoring - Score positions by character type to find optimal diff boundaries
 * 2. Diff Shifting - Slide pure insertions/deletions to better boundary positions
 * 3. Short-Match Absorption - Join diffs separated by 1-2 characters (same type only)
 */
import type { InlinePart } from "./inline-diff.js";
import { BOUNDARY_CONFIG } from "../config.js";

// ─── Character Classification ────────────────────────────────────────────────

type CharCategory = "edge" | "lineBreak" | "separator" | "whitespace" | "wordStart" | "other";

/**
 * Classify a character for boundary scoring.
 * null represents string edge (start/end).
 */
function classifyChar(char: string | null): CharCategory {
  if (char === null) return "edge";
  if (char === "\n" || char === "\r") return "lineBreak";
  if (/^[\s]$/.test(char)) return "whitespace";
  // Separator: punctuation followed by space (handled at boundary level)
  if (/^[,;:.!?]$/.test(char)) return "separator";
  return "other";
}

/**
 * Check if this is a word start boundary (lower→upper, space→letter).
 */
function isWordStart(before: string | null, after: string | null): boolean {
  if (after === null) return false;
  // Space/null followed by letter
  if ((before === null || /\s/.test(before)) && /[a-zA-Z]/.test(after)) return true;
  // lowercase followed by uppercase (camelCase boundary)
  if (before && /[a-z]/.test(before) && /[A-Z]/.test(after)) return true;
  return false;
}

/**
 * Score a boundary position between two characters.
 * Higher scores indicate better places to start/end diffs.
 *
 * Scores (VS Code-style):
 * - Edge (null): 150 - Start/end of text
 * - Line break: 80 - \n
 * - Separator: 40 - comma/semicolon followed by space
 * - Whitespace: 20 - Space boundary
 * - Word start: 10 - lower→upper, space→letter
 * - Within word: 0 - letter→letter
 */
export function scoreBoundary(before: string | null, after: string | null): number {
  const beforeCat = classifyChar(before);
  const afterCat = classifyChar(after);

  // Edge gets highest score
  if (beforeCat === "edge" || afterCat === "edge") return 150;

  // Line break
  if (beforeCat === "lineBreak" || afterCat === "lineBreak") return 80;

  // Separator followed by whitespace (", " or "; " etc)
  if (beforeCat === "separator" && afterCat === "whitespace") return 40;

  // Whitespace boundary
  if (beforeCat === "whitespace" || afterCat === "whitespace") return 20;

  // Word start (camelCase, space→letter)
  if (isWordStart(before, after)) return 10;

  // Within word
  return 0;
}

// ─── Diff Shifting ───────────────────────────────────────────────────────────

/**
 * Shift a diff to a better boundary position.
 *
 * Given the pattern: before + diff + after (where diff is inserted/deleted text)
 * We can shift the diff left or right as long as characters match at the seams.
 *
 * Key insight: shifting is like rotation. If diff ends with 'x' and after starts with 'x',
 * we can shift right: move 'x' from end of diff to start of after, then move matching
 * char from end of before to start of diff.
 *
 * For a pure insertion: "The c" + "at c" + "ame"
 * The full string would be "The cat came" with "at c" inserted.
 * We can represent this as any of:
 * - "The c" + "at c" + "ame"  (current position)
 * - "The " + "cat " + "came"  (shifted to word boundary - better!)
 * - "The ca" + "t ca" + "me"  (also valid but worse)
 *
 * The constraint is: when we shift, the chars we "rotate" must match.
 * Shifting right: diff[-1] must equal after[0]
 * Shifting left: before[-1] must equal diff[0]
 */
export function shiftToBetterBoundary(
  before: string,
  diff: string,
  after: string,
): { before: string; diff: string; after: string } {
  if (diff.length === 0) return { before, diff, after };

  // Find all valid positions by shifting left and right
  // We'll collect all candidates and pick the best scored one

  // First, normalize to leftmost position by shifting left as far as possible
  let curBefore = before;
  let curDiff = diff;
  let curAfter = after;

  // Shift left: move char from diff start to before end (if they match after shift)
  // Constraint: before[-1] === diff[0] allows us to shift left
  // When shifting left: new_before = before[:-1], new_diff = before[-1] + diff[:-1], new_after = diff[-1] + after
  while (curBefore.length > 0 && curDiff.length > 0 &&
         curBefore[curBefore.length - 1] === curDiff[0]) {
    // Shift left by 1
    const shiftChar = curDiff[curDiff.length - 1]; // This goes to after
    curAfter = shiftChar + curAfter;
    curDiff = curBefore[curBefore.length - 1] + curDiff.slice(0, -1);
    curBefore = curBefore.slice(0, -1);
  }

  // Now we're at the leftmost valid position
  // Try all positions going right and find the best score
  let bestBefore = curBefore;
  let bestDiff = curDiff;
  let bestAfter = curAfter;
  let bestScore = -Infinity;

  // Score the current (leftmost) position
  const scorePosition = (b: string, d: string, a: string): number => {
    const beforeChar = b.length > 0 ? b[b.length - 1] : null;
    const diffStartChar = d.length > 0 ? d[0] : null;
    const diffEndChar = d.length > 0 ? d[d.length - 1] : null;
    const afterChar = a.length > 0 ? a[0] : null;
    return scoreBoundary(beforeChar, diffStartChar) + scoreBoundary(diffEndChar, afterChar);
  };

  // Try current position
  let score = scorePosition(curBefore, curDiff, curAfter);
  if (score > bestScore) {
    bestScore = score;
    bestBefore = curBefore;
    bestDiff = curDiff;
    bestAfter = curAfter;
  }

  // Now shift right as far as possible, scoring each position
  // Shifting right: diff[-1] === after[0] allows us to shift right
  // When shifting right: new_before = before + diff[0], new_diff = diff[1:] + after[0], new_after = after[1:]
  while (curAfter.length > 0 && curDiff.length > 0 &&
         curDiff[curDiff.length - 1] === curAfter[0]) {
    // Shift right by 1
    const shiftChar = curDiff[0]; // This goes to before
    curBefore = curBefore + shiftChar;
    curDiff = curDiff.slice(1) + curAfter[0];
    curAfter = curAfter.slice(1);

    score = scorePosition(curBefore, curDiff, curAfter);
    if (score > bestScore) {
      bestScore = score;
      bestBefore = curBefore;
      bestDiff = curDiff;
      bestAfter = curAfter;
    }
  }

  return { before: bestBefore, diff: bestDiff, after: bestAfter };
}

// ─── Short Match Absorption ──────────────────────────────────────────────────

/**
 * Flatten a part into child parts, handling existing children.
 * If the part already has children, returns them; otherwise returns the part as-is.
 */
function flattenToChildren(part: InlinePart): InlinePart[] {
  if (part.children && part.children.length > 0) {
    return part.children;
  }
  return [{ value: part.value, type: part.type, minor: part.minor }];
}

/**
 * Absorb very short equal segments between same-type changes.
 *
 * Pattern: [removed][equal:≤N chars][removed] -> [removed with children]
 * Pattern: [added][equal:≤N chars][added] -> [added with children]
 *
 * The absorbed parts are preserved as children so the renderer can show
 * the equal parts with appropriate (non-highlighted) styling.
 *
 * Does NOT merge different types (removed + added stay separate).
 *
 * IMPORTANT: This only applies when absorbing would not corrupt text.
 * Specifically, we never absorb when the equal part contains only whitespace
 * that might be significant for word boundaries.
 */
export function absorbShortMatches(
  parts: InlinePart[],
  maxLen: number = BOUNDARY_CONFIG.SHORT_MATCH_THRESHOLD,
): InlinePart[] {
  if (parts.length < 3) return parts;

  const result: InlinePart[] = [];

  let i = 0;
  while (i < parts.length) {
    // Look for pattern: [change][equal:short][same-change]
    if (
      i + 2 < parts.length &&
      (parts[i].type === "removed" || parts[i].type === "added") &&
      parts[i + 1].type === "equal" &&
      parts[i + 1].value.length <= maxLen &&
      parts[i + 2].type === parts[i].type // Same change type
    ) {
      // Don't absorb if the equal part is whitespace only
      // This preserves word boundaries
      const equalValue = parts[i + 1].value;
      if (/^\s+$/.test(equalValue)) {
        // Keep as separate parts - don't merge across whitespace
        result.push(parts[i]);
        i++;
        continue;
      }

      // Merge all three into one, preserving structure as children
      const children: InlinePart[] = [
        ...flattenToChildren(parts[i]),
        { value: parts[i + 1].value, type: "equal" as const },
        ...flattenToChildren(parts[i + 2]),
      ];

      const merged: InlinePart = {
        value: parts[i].value + parts[i + 1].value + parts[i + 2].value,
        type: parts[i].type,
        children,
      };

      // Preserve minor flag if either change part had it
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
 *
 * This handles sequences where a change (added/removed) is between two equal parts.
 * We optimize the boundaries to fall on word/whitespace boundaries where possible.
 */
function optimizeSingleDiffs(parts: InlinePart[]): InlinePart[] {
  if (parts.length < 2) return parts;

  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    // Look for pattern: [equal][change][equal] or [change] at start/end
    if (parts[i].type === "removed" || parts[i].type === "added") {
      // Get surrounding equal parts
      const prevEqual = result.length > 0 && result[result.length - 1].type === "equal"
        ? result[result.length - 1]
        : null;
      const nextEqual = i + 1 < parts.length && parts[i + 1].type === "equal"
        ? parts[i + 1]
        : null;

      // Only optimize if we have at least one adjacent equal AND
      // the change is a pure word-boundary type of change
      if (prevEqual || nextEqual) {
        const before = prevEqual?.value ?? "";
        const diff = parts[i].value;
        const after = nextEqual?.value ?? "";

        const optimized = shiftToBetterBoundary(before, diff, after);

        // Update previous equal if it exists
        if (prevEqual) {
          prevEqual.value = optimized.before;
          // Remove if empty
          if (prevEqual.value === "") {
            result.pop();
          }
        }

        // Add optimized diff
        if (optimized.diff !== "") {
          result.push({
            ...parts[i],
            value: optimized.diff,
          });
        }

        // Handle next equal
        if (nextEqual) {
          if (optimized.after !== "") {
            // We'll push this next iteration, update it in-place
            parts[i + 1] = { ...nextEqual, value: optimized.after };
          } else {
            // Skip the empty next equal
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
 * Apply VS Code-style boundary optimizations to inline diff parts.
 *
 * 1. Shift diffs to better boundary positions
 * 2. Absorb very short matches between same-type changes (non-whitespace only)
 */
export function optimizeBoundaries(parts: InlinePart[]): InlinePart[] {
  if (parts.length === 0) return parts;

  // First pass: optimize diff boundaries
  let result = optimizeSingleDiffs(parts);

  // Second pass: absorb short matches (may need multiple iterations)
  let prevLength = -1;
  while (result.length !== prevLength) {
    prevLength = result.length;
    result = absorbShortMatches(result);
  }

  // Filter out empty parts
  result = result.filter(p => p.value !== "");

  return result;
}
