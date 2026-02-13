/**
 * Tests for the unified text similarity module.
 */
import { describe, it, expect } from "vitest";
import {
  computeTextSimilarity,
  similarity,
  sharedWordRunScore,
  sharedUniqueWordCount,
  type TextSimilarity,
} from "../src/text/similarity.js";

describe("computeTextSimilarity", () => {
  it("should return all metrics for identical strings", () => {
    const result = computeTextSimilarity("hello world", "hello world");

    expect(result.dice).toBe(1);
    expect(result.sharedWordRun).toBe(2);
    expect(result.sharedWordCount).toBe(2);
    expect(result.totalWordsA).toBe(2);
    expect(result.totalWordsB).toBe(2);
  });

  it("should return all metrics for completely different strings", () => {
    const result = computeTextSimilarity("abc def", "xyz uvw");

    expect(result.dice).toBeLessThan(0.5);
    expect(result.sharedWordRun).toBe(0);
    expect(result.sharedWordCount).toBe(0);
    expect(result.totalWordsA).toBe(2);
    expect(result.totalWordsB).toBe(2);
  });

  it("should detect partial matches", () => {
    const result = computeTextSimilarity(
      "the quick brown fox",
      "the slow brown dog",
    );

    expect(result.dice).toBeGreaterThan(0);
    expect(result.dice).toBeLessThan(1);
    expect(result.sharedWordRun).toBeGreaterThanOrEqual(1); // "brown" or "the"
    expect(result.sharedWordCount).toBe(2); // "the", "brown"
    expect(result.totalWordsA).toBe(4);
    expect(result.totalWordsB).toBe(4);
  });

  it("should handle empty strings", () => {
    const result = computeTextSimilarity("", "hello");

    expect(result.dice).toBe(0);
    expect(result.sharedWordRun).toBe(0);
    expect(result.sharedWordCount).toBe(0);
    expect(result.totalWordsA).toBe(0);
    expect(result.totalWordsB).toBe(1);
  });

  it("should detect contiguous word runs", () => {
    const result = computeTextSimilarity(
      "A B C D E F",
      "X B C D Y Z",
    );

    expect(result.sharedWordRun).toBe(3); // "B C D"
    expect(result.sharedWordCount).toBe(3); // B, C, D
  });
});

describe("similarity (Dice coefficient)", () => {
  it("should return 1 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1);
  });

  it("should return 0 for completely different strings", () => {
    expect(similarity("ab", "cd")).toBe(0);
  });

  it("should return partial match for overlapping bigrams", () => {
    const sim = similarity("hello", "hallo");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("should handle short strings", () => {
    expect(similarity("a", "b")).toBe(0);
    expect(similarity("", "")).toBe(1);
  });

  it("should be symmetric", () => {
    const a = "the quick brown fox";
    const b = "the lazy brown dog";
    expect(similarity(a, b)).toBe(similarity(b, a));
  });
});

describe("sharedWordRunScore", () => {
  it("should return 0 for no shared words", () => {
    expect(sharedWordRunScore("abc def", "ghi jkl")).toBe(0);
  });

  it("should return run length for contiguous matches", () => {
    expect(sharedWordRunScore("A B C D", "X B C Y")).toBe(2); // "B C"
  });

  it("should find longest run", () => {
    expect(sharedWordRunScore("A B C D E F", "X B C D E Y")).toBe(4); // "B C D E"
  });

  it("should handle single word matches", () => {
    expect(sharedWordRunScore("hello world", "hello there")).toBe(1);
  });

  it("should be case-sensitive", () => {
    // Word matching uses exact comparison
    expect(sharedWordRunScore("Hello World", "hello world")).toBe(0);
  });
});

describe("sharedUniqueWordCount", () => {
  it("should count shared unique words", () => {
    expect(sharedUniqueWordCount("a b c", "b c d")).toBe(2); // b, c
  });

  it("should use normalized comparison", () => {
    // normalizeWord lowercases and strips punctuation
    expect(sharedUniqueWordCount("Hello, World!", "hello world")).toBe(2);
  });

  it("should not double-count repeated words", () => {
    expect(sharedUniqueWordCount("a a a b", "a b b b")).toBe(2); // a, b
  });

  it("should return 0 for no shared words", () => {
    expect(sharedUniqueWordCount("abc def", "ghi jkl")).toBe(0);
  });
});

describe("TextSimilarity interface", () => {
  it("should provide consistent metrics", () => {
    const text1 = "The quick brown fox jumps over the lazy dog";
    const text2 = "The slow brown fox leaps over the sleepy dog";

    const result = computeTextSimilarity(text1, text2);

    // All metrics should be defined
    expect(result.dice).toBeDefined();
    expect(result.sharedWordRun).toBeDefined();
    expect(result.sharedWordCount).toBeDefined();
    expect(result.totalWordsA).toBeDefined();
    expect(result.totalWordsB).toBeDefined();

    // Sanity checks
    expect(result.dice).toBeGreaterThanOrEqual(0);
    expect(result.dice).toBeLessThanOrEqual(1);
    expect(result.sharedWordRun).toBeGreaterThanOrEqual(0);
    expect(result.sharedWordCount).toBeLessThanOrEqual(Math.min(result.totalWordsA, result.totalWordsB));
  });
});
