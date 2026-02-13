/**
 * Word tokenization utilities for text comparison.
 * Provides consistent tokenization across diff and render modules.
 */

export interface WordToken {
  word: string; // normalized for comparison
  raw: string; // original text including trailing whitespace
}

/**
 * Tokenize text into words with preserved whitespace.
 * Each token contains the word and any trailing whitespace.
 */
export function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /(\S+)(\s*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[1], raw: m[0] });
  }
  return tokens;
}

/**
 * Normalize a word for comparison.
 * Lowercases and strips leading/trailing punctuation.
 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[.,;:!?'")\]}>]+$/, "")
    .replace(/^['"([{<]+/, "");
}

/**
 * Join tokens back into a string, preserving original formatting.
 */
export function joinTokens(tokens: WordToken[]): string {
  if (tokens.length === 0) return "";
  return tokens.map((t) => t.raw).join("");
}

/**
 * Count words in a string (splits on whitespace).
 */
export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Check if text contains no letters or digits (only punctuation, symbols, whitespace).
 */
export function isPurePunctuation(s: string): boolean {
  return s.replace(/[^a-zA-Z0-9]/g, "").length === 0;
}
