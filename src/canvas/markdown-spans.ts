/**
 * Inline markdown parser — converts inline markdown text to styled runs.
 *
 * Block-level constructs (headings, code fences, blockquotes, lists) are handled
 * upstream. This module only handles inline formatting within a block's text content.
 */

import type { StyledRun } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParseState {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse inline markdown formatting into an array of styled runs.
 *
 * Each run is a contiguous text span with uniform style. When styling changes
 * (e.g. entering or leaving bold), a new run is emitted.
 *
 * Handles:
 * - `**bold**` / `__bold__`
 * - `*italic*` / `_italic_`
 * - `` `code` ``
 * - `~~strikethrough~~`
 * - `[text](url)` — link text with URL stored in run
 * - Nesting: `**bold *and italic* text**`
 * - Escapes: `\*`, `\_`, `` \` ``, `\~`, `\[`, `\]`, `\(`, `\)`, `\\`
 */
export function parseInlineMarkdown(text: string): StyledRun[] {
  const runs: StyledRun[] = [];
  const state: ParseState = {
    bold: false,
    italic: false,
    code: false,
    strikethrough: false,
    link: undefined,
  };

  parseSpans(text, 0, text.length, state, runs);
  return mergeAdjacentIdentical(runs);
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Recursive descent parser. Processes a slice of `text` from `start` to `end`,
 * accumulating plain-text characters and recursing into formatting spans.
 *
 * Mutates `state` during recursion (entering/exiting formatting), restoring it
 * on exit so the caller's state is unchanged.
 */
/** Try to consume an escape sequence at position i. Returns new index or -1. */
function tryEscape(text: string, i: number, end: number, state: ParseState, runs: StyledRun[]): number {
  if (text[i] !== "\\" || i + 1 >= end) return -1;
  const next = text[i + 1];
  if (!isEscapable(next)) return -1;
  emitRun(next, state, runs);
  return i + 2;
}

/** Try to consume a backtick code span at position i. Returns new index or -1. */
function tryCodeSpan(text: string, i: number, end: number, state: ParseState, runs: StyledRun[]): number {
  if (text[i] !== "`" || state.code) return -1;
  const fenceLen = countRepeating(text, i, "`");
  const closeAt = findCodeClose(text, i + fenceLen, end, fenceLen);
  if (closeAt === -1) return -1;
  let inner = text.slice(i + fenceLen, closeAt);
  if (inner.length >= 2 && inner[0] === " " && inner[inner.length - 1] === " ") {
    inner = inner.slice(1, -1);
  }
  const prevCode = state.code;
  state.code = true;
  emitRun(inner, state, runs);
  state.code = prevCode;
  return closeAt + fenceLen;
}

/** Try to consume a ~~ strikethrough at position i. Returns new index or -1. */
function tryStrikethrough(text: string, i: number, end: number, state: ParseState, runs: StyledRun[]): number {
  if (text[i] !== "~" || state.code || text[i + 1] !== "~" || state.strikethrough) return -1;
  const closeAt = text.indexOf("~~", i + 2);
  if (closeAt === -1 || closeAt >= end) return -1;
  state.strikethrough = true;
  parseSpans(text, i + 2, closeAt, state, runs);
  state.strikethrough = false;
  return closeAt + 2;
}

/** Try to consume bold/italic at position i. Returns new index or -1. */
function tryEmphasis(text: string, i: number, end: number, state: ParseState, runs: StyledRun[]): number {
  const ch = text[i];
  if ((ch !== "*" && ch !== "_") || state.code) return -1;

  // Bold (** or __)
  if (text[i + 1] === ch && !state.bold) {
    const fence = ch === "*" ? "**" : "__";
    const closeAt = findDelimiterClose(text, i + 2, end, fence);
    if (closeAt !== -1) {
      state.bold = true;
      parseSpans(text, i + 2, closeAt, state, runs);
      state.bold = false;
      return closeAt + 2;
    }
  }

  // Italic (* or _)
  if (!state.italic) {
    if (ch === "_" && isWordChar(text[i - 1]) && isWordChar(text[i + 1])) {
      return -1; // Mid-word underscore — literal
    }
    const closeAt = findDelimiterClose(text, i + 1, end, ch);
    if (closeAt !== -1) {
      state.italic = true;
      parseSpans(text, i + 1, closeAt, state, runs);
      state.italic = false;
      return closeAt + 1;
    }
  }

  return -1;
}

/** Try to consume a [text](url) link at position i. Returns new index or -1. */
function tryLink(text: string, i: number, end: number, state: ParseState, runs: StyledRun[]): number {
  if (text[i] !== "[" || state.code) return -1;
  const linkResult = tryParseLink(text, i, end);
  if (linkResult === null) return -1;
  const { textStart: lt, textEnd: le, urlStart: us, urlEnd: ue, totalEnd } = linkResult;
  const prevLink = state.link;
  state.link = text.slice(us, ue);
  parseSpans(text, lt, le, state, runs);
  state.link = prevLink;
  return totalEnd;
}

/**
 * Try each inline format handler in priority order.
 * Returns new index or -1. Calls flushPlain before emitting handler content
 * so accumulated plain text appears first.
 */
function tryParseInline(
  text: string,
  i: number,
  end: number,
  state: ParseState,
  runs: StyledRun[],
  flushPlain: () => void,
): number {
  // Each handler only has side effects (emitting runs) on success.
  // We need to flush accumulated plain text before handler output.
  // Use a two-pass approach: check if handler matches, then flush + execute.
  // Since handlers are cheap and idempotent on failure, we use a wrapper.
  const withFlush = (handler: typeof tryEscape): number => {
    const snapshot = runs.length;
    const result = handler(text, i, end, state, runs);
    if (result !== -1) {
      // Handler emitted runs — splice flush before them
      const emitted = runs.splice(snapshot);
      flushPlain();
      runs.push(...emitted);
    }
    return result;
  };

  let result: number;
  result = withFlush(tryEscape);
  if (result !== -1) return result;
  result = withFlush(tryCodeSpan);
  if (result !== -1) return result;
  result = withFlush(tryStrikethrough);
  if (result !== -1) return result;
  result = withFlush(tryEmphasis);
  if (result !== -1) return result;
  result = withFlush(tryLink);
  if (result !== -1) return result;
  return -1;
}

function parseSpans(text: string, start: number, end: number, state: ParseState, runs: StyledRun[]): void {
  let i = start;
  let textStart = start;

  const flushText = (upTo: number): void => {
    if (upTo > textStart) {
      emitRun(text.slice(textStart, upTo), state, runs);
    }
    textStart = upTo;
  };

  while (i < end) {
    const consumed = tryParseInline(text, i, end, state, runs, () => flushText(i));
    if (consumed !== -1) {
      i = consumed;
      textStart = i;
    } else {
      i++;
    }
  }

  flushText(end);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitRun(text: string, state: ParseState, runs: StyledRun[]): void {
  if (text.length === 0) return;
  runs.push({
    text,
    bold: state.bold,
    italic: state.italic,
    code: state.code,
    strikethrough: state.strikethrough,
    ...(state.link !== undefined ? { link: state.link } : {}),
  });
}

/**
 * Merge adjacent runs that have identical styling — avoids fragmenting
 * plain text runs that were split incidentally.
 */
function mergeAdjacentIdentical(runs: StyledRun[]): StyledRun[] {
  if (runs.length === 0) return runs;
  const merged: StyledRun[] = [runs[0]];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = runs[i];
    if (
      prev.bold === curr.bold &&
      prev.italic === curr.italic &&
      prev.code === curr.code &&
      prev.strikethrough === curr.strikethrough &&
      prev.link === curr.link
    ) {
      merged[merged.length - 1] = { ...prev, text: prev.text + curr.text };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Count how many times `ch` repeats starting at `pos` in `text`.
 */
function countRepeating(text: string, pos: number, ch: string): number {
  let count = 0;
  while (pos + count < text.length && text[pos + count] === ch) count++;
  return count;
}

/**
 * Find the closing backtick fence of length `fenceLen` starting at `searchFrom`.
 * Returns the index of the first backtick of the closing fence, or -1 if not found.
 */
function findCodeClose(text: string, searchFrom: number, end: number, fenceLen: number): number {
  let i = searchFrom;
  while (i < end) {
    if (text[i] === "`") {
      const len = countRepeating(text, i, "`");
      if (len === fenceLen) return i;
      i += len;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Find the closing delimiter `delim` (e.g. `"**"` or `"*"`) starting at `searchFrom`,
 * within the range `[searchFrom, end)`.
 *
 * Handles nested opening delimiters of the same kind by requiring balanced pairs.
 * Returns index of the first character of the closing delimiter, or -1.
 */
function findDelimiterClose(text: string, searchFrom: number, end: number, delim: string): number {
  const len = delim.length;
  let i = searchFrom;
  let depth = 0; // nesting depth for same-kind openers

  while (i <= end - len) {
    // Check for escaped character
    if (text[i] === "\\" && i + 1 < end && isEscapable(text[i + 1])) {
      i += 2;
      continue;
    }

    if (text.slice(i, i + len) === delim) {
      if (depth === 0) {
        return i;
      }
      depth--;
      i += len;
    } else {
      i++;
    }
  }
  return -1;
}

interface LinkMatch {
  textStart: number;
  textEnd: number;
  urlStart: number;
  urlEnd: number;
  totalEnd: number;
}

/**
 * Try to parse a `[text](url)` link starting at `pos` (the `[` character).
 * Returns null if this doesn't look like a valid link.
 */
function tryParseLink(text: string, pos: number, end: number): LinkMatch | null {
  // Find matching ]
  let depth = 0;
  let i = pos + 1;
  while (i < end) {
    if (text[i] === "\\" && i + 1 < end && isEscapable(text[i + 1])) {
      i += 2;
      continue;
    }
    if (text[i] === "[") {
      depth++;
      i++;
      continue;
    }
    if (text[i] === "]") {
      if (depth === 0) break;
      depth--;
      i++;
      continue;
    }
    i++;
  }

  if (i >= end || text[i] !== "]") return null;
  const textEnd = i;

  // Expect ( immediately after ]
  if (i + 1 >= end || text[i + 1] !== "(") return null;

  // Find matching )
  let j = i + 2;
  let parenDepth = 0;
  while (j < end) {
    if (text[j] === "(") {
      parenDepth++;
      j++;
      continue;
    }
    if (text[j] === ")") {
      if (parenDepth === 0) break;
      parenDepth--;
      j++;
      continue;
    }
    j++;
  }

  if (j >= end || text[j] !== ")") return null;

  return {
    textStart: pos + 1,
    textEnd,
    urlStart: i + 2,
    urlEnd: j,
    totalEnd: j + 1,
  };
}

function isEscapable(ch: string): boolean {
  return "\\`*_{}[]()#+-.!~|".includes(ch);
}

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /\w/.test(ch);
}
