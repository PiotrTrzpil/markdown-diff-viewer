import { describe, it, expect } from "vitest";
import { diffBlocks, computeInlineDiff, type InlinePart } from "./diff.js";
import { parseMarkdown, extractBlocks } from "./parse.js";

/** Helper: run full pipeline on two strings, return inlineDiff of the first modified pair */
function getInlineDiff(left: string, right: string): InlinePart[] | undefined {
  const leftTree = parseMarkdown(left);
  const rightTree = parseMarkdown(right);
  const leftBlocks = extractBlocks(leftTree);
  const rightBlocks = extractBlocks(rightTree);
  const pairs = diffBlocks(leftBlocks, rightBlocks);
  const modified = pairs.find((p) => p.status === "modified");
  return modified?.inlineDiff;
}

describe("case-only inline diff", () => {
  it("should detect case change when prefix is removed: 'Here, meaning' → 'Meaning'", () => {
    const diff = getInlineDiff(
      "Here, meaning is constructed through shared ritual.",
      "Meaning is constructed through shared ritual."
    );

    expect(diff).toBeDefined();

    // "meaning" → "Meaning" should be a minor (case-only) change
    const minorRemoved = diff!.filter((p) => p.type === "removed" && p.minor);
    const minorAdded = diff!.filter((p) => p.type === "added" && p.minor);

    expect(minorRemoved.length).toBeGreaterThan(0);
    expect(minorAdded.length).toBeGreaterThan(0);

    // The minor removed part should contain "meaning" (not "Here, meaning")
    const removedText = minorRemoved.map((p) => p.value).join("").trim();
    expect(removedText).toBe("meaning");

    // The minor added part should contain "Meaning"
    const addedText = minorAdded.map((p) => p.value).join("").trim();
    expect(addedText).toBe("Meaning");

    // Should have char-level children showing only 'm' → 'M'
    const removedChildren = minorRemoved[0].children!;
    const addedChildren = minorAdded[0].children!;

    expect(removedChildren).toBeDefined();
    expect(addedChildren).toBeDefined();

    // Only "m" should be marked as removed in children
    const charRemoved = removedChildren.filter((c) => c.type === "removed");
    expect(charRemoved).toHaveLength(1);
    expect(charRemoved[0].value).toBe("m");

    // Only "M" should be marked as added in children
    const charAdded = addedChildren.filter((c) => c.type === "added");
    expect(charAdded).toHaveLength(1);
    expect(charAdded[0].value).toBe("M");
  });

  it("should detect case change in middle of sentence: 'the Oxytocin' → 'the oxytocin'", () => {
    const diff = getInlineDiff(
      "We study the Oxytocin effect on groups.",
      "We study the oxytocin effect on groups."
    );

    expect(diff).toBeDefined();

    const minorParts = diff!.filter((p) => p.minor);
    expect(minorParts.length).toBeGreaterThan(0);

    // Should have char-level children for O → o
    const removedMinor = minorParts.find((p) => p.type === "removed");
    expect(removedMinor).toBeDefined();
    expect(removedMinor!.children).toBeDefined();

    const charRemoved = removedMinor!.children!.filter((c) => c.type === "removed");
    expect(charRemoved).toHaveLength(1);
    expect(charRemoved[0].value).toBe("O");
  });

  it("should not mark truly different words as minor", () => {
    const diff = getInlineDiff(
      "The cat sat on the mat.",
      "The dog sat on the mat."
    );

    expect(diff).toBeDefined();

    // "cat" → "dog" is NOT a minor change
    const removed = diff!.filter((p) => p.type === "removed");
    expect(removed.length).toBeGreaterThan(0);
    expect(removed[0].minor).toBeFalsy();
  });

  it("should handle pure prefix removal with case change on next word", () => {
    const diff = getInlineDiff(
      "Here, meaning is key.",
      "Meaning is key."
    );

    expect(diff).toBeDefined();

    // "Here, " should be purely removed (not minor)
    const pureRemoved = diff!.filter((p) => p.type === "removed" && !p.minor);
    expect(pureRemoved.length).toBeGreaterThan(0);

    // Check that "Here" or "Here," is in the pure removed parts
    const pureRemovedText = pureRemoved.map((p) => p.value).join("");
    expect(pureRemovedText).toContain("Here");
  });
});

describe("punctuation absorption", () => {
  it("should mark removed smart quotes as minor", () => {
    const diff = getInlineDiff(
      'The \u201csacred\u201d act becomes meaningful.',
      "The sacred act becomes meaningful."
    );

    expect(diff).toBeDefined();

    // The removed \u201c and \u201d should be minor, not major
    const removedParts = diff!.filter((p) => p.type === "removed");
    expect(removedParts.length).toBeGreaterThan(0);

    // All removed parts should be minor (they're just quotes)
    for (const part of removedParts) {
      expect(part.minor).toBe(true);
    }
  });

  it("should mark removed regular quotes as minor", () => {
    const diff = getInlineDiff(
      'The "sacred" act becomes meaningful.',
      "The sacred act becomes meaningful."
    );

    expect(diff).toBeDefined();

    const removedParts = diff!.filter((p) => p.type === "removed");
    expect(removedParts.length).toBeGreaterThan(0);

    for (const part of removedParts) {
      expect(part.minor).toBe(true);
    }
  });

  it("should mark removed em dash as minor when replaced by comma", () => {
    const diff = getInlineDiff(
      "Culture \u2014 the shared system \u2014 creates identity.",
      "Culture, the shared system, creates identity."
    );

    expect(diff).toBeDefined();

    // The \u2014 → , changes should be minor (punctuation-only)
    const minorParts = diff!.filter((p) => p.minor);
    expect(minorParts.length).toBeGreaterThan(0);
  });

  it("should not mark content words as minor even if near punctuation", () => {
    const diff = getInlineDiff(
      'He said "hello" to them.',
      "He said goodbye to them."
    );

    expect(diff).toBeDefined();

    // "hello" → "goodbye" is NOT minor (different words)
    const nonMinorRemoved = diff!.filter((p) => p.type === "removed" && !p.minor);
    const nonMinorRemovedText = nonMinorRemoved.map((p) => p.value).join("");
    // Should contain "hello" (the actual word change) as non-minor
    expect(nonMinorRemovedText).toContain("hello");
  });
});

describe("stop word absorption", () => {
  it("should absorb stop words between same-type changes (removed+removed)", () => {
    const diff = computeInlineDiff(
      "foo the bar baz",
      "qux baz"
    );

    // "the" should NOT appear as an equal part — it should be absorbed into removed
    const equalParts = diff.filter((p) => p.type === "equal");
    for (const eq of equalParts) {
      expect(eq.value).not.toMatch(/\bthe\b/);
    }
  });

  it("should absorb stop words between cross-type changes (removed+added)", () => {
    const diff = computeInlineDiff(
      "old words in the middle here",
      "new words in the middle there"
    );

    // Stop words like "in", "the" between removed/added should not be standalone equal
    const equalValues = diff.filter((p) => p.type === "equal").map((p) => p.value);
    // "in the" should not appear as a standalone equal segment between changes
    for (const val of equalValues) {
      // If a segment is ONLY stop words, it should have been absorbed
      const tokens = val.trim().split(/\s+/).filter(Boolean);
      const allStopWords = tokens.length > 0 && tokens.every((t) =>
        ["a", "an", "the", "in", "of", "for", "on", "at", "by", "with", "from", "and", "or", "but", "to", "is", "are", "was", "it", "not"].includes(t.toLowerCase().replace(/[^a-z]/g, ""))
      );
      expect(allStopWords).toBe(false);
    }
  });

  it("should absorb 'of' between removed and added regions", () => {
    // "copy of reality" vs "collection of images"
    // "of" sits between removed "copy" / added "collection" and removed "reality" / added "images"
    const diff = computeInlineDiff(
      "start copy of reality end",
      "start collection of images end"
    );

    // "of" should NOT appear as a standalone equal part between changes
    const equalParts = diff.filter((p) => p.type === "equal");
    for (const eq of equalParts) {
      expect(eq.value.trim()).not.toBe("of");
    }
  });

  it("should chain absorption of multiple consecutive stop words", () => {
    const diff = computeInlineDiff(
      "X the of Y",
      "A the of B"
    );

    // Both "the" and "of" should be absorbed, not left as equal
    const equalParts = diff.filter((p) => p.type === "equal");
    for (const eq of equalParts) {
      expect(eq.value.trim()).not.toMatch(/^(the|of|the of|of the)$/);
    }
  });

  it("should absorb stop words reintroduced by refinePair (real paragraph)", () => {
    // Simulates the kind of text from the screenshot where two very different
    // paragraphs share scattered stop words like "the", "of", "in", "a"
    const diff = computeInlineDiff(
      "While the experience of being spectators of a copy of reality was known for ages to upper classes and even common people through dramatic plays in the theatre in modern times it has scaled greatly",
      "This virtualization was diagnosed in the 1960s by Guy Debord, who argued that all that once was directly lived has become mere representation. For Debord, the spectacle was not simply a collection of images but a relation among people, mediated by images"
    );

    // No equal part should consist solely of stop words — they should all be absorbed
    const equalParts = diff.filter((p) => p.type === "equal");
    const STOP = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
      "to", "of", "in", "for", "on", "at", "by", "with", "from", "as",
      "and", "or", "but", "not", "no", "nor",
      "it", "its", "we", "he", "she", "they", "this", "that", "these", "those",
      "has", "have", "had", "do", "does", "did",
    ]);

    for (const eq of equalParts) {
      const tokens = eq.value.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue; // pure whitespace is fine
      const allStopWords = tokens.every((t) => {
        const letters = t.toLowerCase().replace(/[^a-z]/g, "");
        return letters.length === 0 || STOP.has(letters);
      });
      expect(allStopWords, `equal part "${eq.value}" is only stop words and should be absorbed`).toBe(false);
    }
  });
});
