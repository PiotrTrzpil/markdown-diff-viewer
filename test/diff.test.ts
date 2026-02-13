import { describe, it, expect } from "vitest";
import { diffBlocks, computeInlineDiff, type InlinePart } from "../src/core/diff.js";
import { parseMarkdown, extractBlocks } from "../src/text/parse.js";

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
      "Meaning is constructed through shared ritual.",
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

  it("should detect case change in middle of sentence: 'the Algorithm' → 'the algorithm'", () => {
    const diff = getInlineDiff(
      "We study the Algorithm effect on systems.",
      "We study the algorithm effect on systems.",
    );

    expect(diff).toBeDefined();

    const minorParts = diff!.filter((p) => p.minor);
    expect(minorParts.length).toBeGreaterThan(0);

    // Should have char-level children for A → a
    const removedMinor = minorParts.find((p) => p.type === "removed");
    expect(removedMinor).toBeDefined();
    expect(removedMinor!.children).toBeDefined();

    const charRemoved = removedMinor!.children!.filter((c) => c.type === "removed");
    expect(charRemoved).toHaveLength(1);
    expect(charRemoved[0].value).toBe("A");
  });

  it("should not mark truly different words as minor", () => {
    const diff = getInlineDiff(
      "The cat sat on the mat.",
      "The dog sat on the mat.",
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
      "Meaning is key.",
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
      "The \u201csacred\u201d act becomes meaningful.",
      "The sacred act becomes meaningful.",
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
      "The sacred act becomes meaningful.",
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
      "Culture, the shared system, creates identity.",
    );

    expect(diff).toBeDefined();

    // The \u2014 → , changes should be minor (punctuation-only)
    const minorParts = diff!.filter((p) => p.minor);
    expect(minorParts.length).toBeGreaterThan(0);
  });

  it("should not mark content words as minor even if near punctuation", () => {
    const diff = getInlineDiff(
      'He said "hello" to them.',
      "He said goodbye to them.",
    );

    expect(diff).toBeDefined();

    // "hello" → "goodbye" is NOT minor (different words)
    const nonMinorRemoved = diff!.filter((p) => p.type === "removed" && !p.minor);
    const nonMinorRemovedText = nonMinorRemoved.map((p) => p.value).join("");
    // Should contain "hello" (the actual word change) as non-minor
    expect(nonMinorRemovedText).toContain("hello");
  });
});

describe("shared sequences across different paragraphs", () => {
  it("should detect shared text when paragraphs have different beginnings", () => {
    // Left paragraph starts differently but shares
    // "Several years later, the research team published their comprehensive findings"
    const left = "the audience into passive observers of events created for them but not by them. Several years later, the research team published their comprehensive findings: the results confirmed the initial hypothesis about network effects.";
    const right = "completed its expansion across the entire region, transforming local practices into standardized procedures. Several years later, the research team published their comprehensive findings: the results confirmed the initial hypothesis about network effects.";

    const diff = computeInlineDiff(left, right);

    // The shared sequence should be marked as equal
    const equalParts = diff.filter((p) => p.type === "equal");
    const equalText = equalParts.map((p) => p.value).join("");

    // Should contain the shared sequence
    expect(equalText).toContain("Several years later");
    expect(equalText).toContain("research team");
    expect(equalText).toContain("published their comprehensive findings");
  });

  it("should detect text moved from one paragraph to another (paragraph split)", () => {
    // Real scenario from the bug:
    // Branch: "...passive observers... Several years later, the research team published..."
    // Working dir:
    //   Paragraph 1: "...passive observers..."
    //   Paragraph 2: "Several years later, the research team published... [additional text]"

    const leftMd = "The framework was not simply a collection of rules but \"a dynamic system of interactions\" — a structure that rendered participants into passive observers of processes designed for them but not by them. Several years later, the research team published their comprehensive findings: the data no longer supported a model of simple cause and effect, but revealed a complex web of \"feedback loops\" — cycles with no clear origin — that had transformed the system entirely.";

    const rightMd = `The model introduced a new terminology — the Framework — a term capitalized to denote not merely a set of guidelines but a fundamental shift in methodology: "a dynamic system of interactions." Under this paradigm, the approach had revolutionized standard practice, transforming individual efforts into collaborative processes and rendering participants into passive observers of outcomes designed for them but not by them.

Several years later, the research team published their comprehensive findings: the data no longer supported a model of simple cause and effect, but revealed a complex web of "feedback loops" — cycles with no clear origin — that had transformed the system entirely. At this advanced stage, the boundary between theory and application dissolves into what they termed "integrated practice."`;

    const leftTree = parseMarkdown(leftMd);
    const rightTree = parseMarkdown(rightMd);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // The text "Several years later..." should appear as EQUAL somewhere in the diff
    let foundSharedTextAsEqual = false;
    for (const pair of pairs) {
      if (pair.inlineDiff) {
        for (const part of pair.inlineDiff) {
          if (part.type === "equal" && part.value.includes("Several years later")) {
            foundSharedTextAsEqual = true;
          }
        }
      }
    }

    expect(foundSharedTextAsEqual).toBe(true);
  });

  it("should handle complex paragraph restructuring with moved text", () => {
    // Real scenario: text moved from end of paragraph 1 to start of new paragraph 2
    const leftMd = `This transformation was documented by early researchers, who argued that "all that once was measured directly has become statistical inference." The methodology rendered analysts into passive interpreters of data generated for them but not by them. Several years later, the research team extended the analysis further: we no longer operated in a world of direct observation masking complexity.

Both approaches are insightful.`;

    const rightMd = `This shift in methodology was documented by early researchers. They argued that modern analysis had undergone a fundamental change: "All that once was measured directly has become statistical inference." The approach rendered analysts into passive interpreters of data generated for them but not by them.

Several years later, the research team extended the analysis further: we no longer operated in a world of direct observation masking complexity. At this advanced stage, the distinction dissolves.

Both the Framework and integrated practice approaches are insightful.`;

    const leftTree = parseMarkdown(leftMd);
    const rightTree = parseMarkdown(rightMd);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // "Several years later" should appear as EQUAL, not removed+added separately
    const sharedTextStatus: string[] = [];
    for (const pair of pairs) {
      if (pair.inlineDiff) {
        for (const part of pair.inlineDiff) {
          if (part.value.includes("Several years later")) {
            sharedTextStatus.push(part.type);
          }
        }
      }
    }

    expect(sharedTextStatus).toContain("equal");
  });

  it("should show paragraph split as ¶ when text is only reorganized with newline", () => {
    // Scenario: a single paragraph is split into two by inserting a blank line
    // The text content is identical, only the paragraph break is added
    const leftMd = "The evidence points to a significant shift. We possess productive capacity sufficient for broad material security. This is not post-scarcity in the utopian sense but it represents a changed condition.";

    const rightMd = `The evidence points to a significant shift. We possess productive capacity sufficient for broad material security.

This is not post-scarcity in the utopian sense but it represents a changed condition.`;

    const leftTree = parseMarkdown(leftMd);
    const rightTree = parseMarkdown(rightMd);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // Check that we have a paragraph split indicator
    let foundParagraphSplit = false;
    let textShownAsAddedOrRemoved = false;

    for (const pair of pairs) {
      if (pair.inlineDiff) {
        for (const part of pair.inlineDiff) {
          if (part.paragraphSplit) {
            foundParagraphSplit = true;
          }
          // The actual text content should NOT be shown as added/removed
          // Only the paragraph marker should be added
          if ((part.type === "added" || part.type === "removed") &&
              part.value.includes("evidence") &&
              !part.paragraphSplit) {
            textShownAsAddedOrRemoved = true;
          }
        }
      }
    }

    // Should show ¶ marker for paragraph split
    expect(foundParagraphSplit).toBe(true);
    // The text "evidence" should not be shown as added/removed (only reorganized)
    expect(textShownAsAddedOrRemoved).toBe(false);
  });

  it("should detect shared text in middle of very different paragraphs", () => {
    const left = "AAA BBB CCC shared text that should match DDD EEE FFF";
    const right = "XXX YYY ZZZ shared text that should match QQQ RRR SSS";

    const diff = computeInlineDiff(left, right);

    const equalParts = diff.filter((p) => p.type === "equal");
    const equalText = equalParts.map((p) => p.value).join("");

    expect(equalText).toContain("shared text that should match");
  });

  it("should pair unmatched removed/added blocks that share significant text", () => {
    // Simulate two paragraphs that weren't matched at block level but share text
    const leftMd = `First paragraph with some unique content at the start. Several years later, the research team extended the analysis further.

Another paragraph here.`;

    const rightMd = `Different opening that doesn't match at all. Several years later, the research team extended the analysis further.

Another paragraph here.`;

    const leftTree = parseMarkdown(leftMd);
    const rightTree = parseMarkdown(rightMd);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // The first paragraphs should be paired as "modified" (not separate removed/added)
    // because they share "Several years later, the research team extended the analysis further"
    const firstPair = pairs[0];
    expect(firstPair.status).toBe("modified");
    expect(firstPair.inlineDiff).toBeDefined();

    // Check that the inline diff contains the shared text as equal
    const equalParts = firstPair.inlineDiff!.filter((p) => p.type === "equal");
    const equalText = equalParts.map((p) => p.value).join("");
    expect(equalText).toContain("Several years later");
  });
});

describe("stop word absorption", () => {
  it("should absorb stop words between same-type changes (removed+removed)", () => {
    const diff = computeInlineDiff(
      "foo the bar baz",
      "qux baz",
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
      "new words in the middle there",
    );

    // Stop words like "in", "the" between removed/added should not be standalone equal
    const equalValues = diff.filter((p) => p.type === "equal").map((p) => p.value);
    // "in the" should not appear as a standalone equal segment between changes
    for (const val of equalValues) {
      // If a segment is ONLY stop words, it should have been absorbed
      const tokens = val.trim().split(/\s+/).filter(Boolean);
      const allStopWords = tokens.length > 0 && tokens.every((t) =>
        ["a", "an", "the", "in", "of", "for", "on", "at", "by", "with", "from", "and", "or", "but", "to", "is", "are", "was", "it", "not"].includes(t.toLowerCase().replace(/[^a-z]/g, "")),
      );
      expect(allStopWords).toBe(false);
    }
  });

  it("should absorb 'of' between removed and added regions", () => {
    // "copy of reality" vs "collection of images"
    // "of" sits between removed "copy" / added "collection" and removed "reality" / added "images"
    const diff = computeInlineDiff(
      "start copy of reality end",
      "start collection of images end",
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
      "A the of B",
    );

    // Both "the" and "of" should be absorbed, not left as equal
    const equalParts = diff.filter((p) => p.type === "equal");
    for (const eq of equalParts) {
      expect(eq.value.trim()).not.toMatch(/^(the|of|the of|of the)$/);
    }
  });

  it("should absorb stop words reintroduced by refinePair (real paragraph)", () => {
    // Simulates the kind of text where two very different
    // paragraphs share scattered stop words like "the", "of", "in", "a"
    const diff = computeInlineDiff(
      "While the experience of being observers of a model of systems was known for ages to researchers and even practitioners through academic papers in the literature in modern times it has scaled greatly",
      "This transformation was documented in the 1990s by early researchers, who argued that all that once was measured directly has become statistical inference. The methodology was not simply a collection of techniques but a system of practices, structured by protocols",
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

describe("block matching invariants", () => {
  it("should not pair paragraphs that start with completely different sentences", () => {
    // This tests a bug where paragraphs from different sections get incorrectly matched.
    // The left paragraph starts with "Even the motivations..."
    // The right paragraph starts with "But at the same time..."
    // These should NOT be paired as modified - they should be separate removed/added.

    const leftDoc = `## Section One

Even the motivations that seem most removed from status are often deeply entangled with it. Belonging is fundamentally a claim to a valid place within a group.

## Section Two

This is a different topic entirely.`;

    const rightDoc = `## Section One

But at the same time, we must keep in mind that our status instincts evolved in small groups. For status to fulfill its role, the size of the arena matters.

## Section Two

This is a different topic entirely.`;

    const leftTree = parseMarkdown(leftDoc);
    const rightTree = parseMarkdown(rightDoc);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // Find modified pairs
    const modified = pairs.filter(p => p.status === "modified");

    for (const pair of modified) {
      if (!pair.inlineDiff) continue;

      // Check that modified pairs don't start with a huge "added" block
      // that indicates wrong paragraph matching
      const firstPart = pair.inlineDiff[0];
      if (firstPart?.type === "added") {
        // If the first part is "added", it should be relatively short
        // (a few words, not a whole paragraph)
        const wordCount = firstPart.value.trim().split(/\s+/).length;
        expect(
          wordCount,
          `Modified pair starts with ${wordCount} added words - likely wrong paragraph match: "${firstPart.value.substring(0, 50)}..."`,
        ).toBeLessThan(30);
      }

      // Similarly, the last part shouldn't be a huge "removed" block
      const lastPart = pair.inlineDiff[pair.inlineDiff.length - 1];
      if (lastPart?.type === "removed") {
        const wordCount = lastPart.value.trim().split(/\s+/).length;
        expect(
          wordCount,
          `Modified pair ends with ${wordCount} removed words - likely wrong paragraph match: "${lastPart.value.substring(0, 50)}..."`,
        ).toBeLessThan(30);
      }
    }
  });

  it("should keep paragraph order within sections", () => {
    // When a section has multiple paragraphs and they're rewritten,
    // the order should be preserved in the diff output.

    const leftDoc = `## Status

First paragraph about status and recognition.

Second paragraph about belonging and groups.

Third paragraph about the artist seeking validation.`;

    const rightDoc = `## Status

Rewritten first paragraph about status concepts.

Rewritten second about belonging.

Rewritten third about artistic expression.`;

    const leftTree = parseMarkdown(leftDoc);
    const rightTree = parseMarkdown(rightDoc);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);

    // Collect the order of paragraph appearances on each side
    const leftOrder: number[] = [];
    const rightOrder: number[] = [];

    for (const pair of pairs) {
      if (pair.left && pair.left.type === "paragraph") {
        // Find index in original left blocks
        const idx = leftBlocks.findIndex(b => b === pair.left);
        if (idx >= 0) leftOrder.push(idx);
      }
      if (pair.right && pair.right.type === "paragraph") {
        // Find index in original right blocks
        const idx = rightBlocks.findIndex(b => b === pair.right);
        if (idx >= 0) rightOrder.push(idx);
      }
    }

    // Both orders should be monotonically increasing (preserving document order)
    for (let i = 1; i < leftOrder.length; i++) {
      expect(
        leftOrder[i],
        `Left order not preserved: ${leftOrder[i-1]} should come before ${leftOrder[i]}`,
      ).toBeGreaterThan(leftOrder[i - 1]);
    }
    for (let i = 1; i < rightOrder.length; i++) {
      expect(
        rightOrder[i],
        `Right order not preserved: ${rightOrder[i-1]} should come before ${rightOrder[i]}`,
      ).toBeGreaterThan(rightOrder[i - 1]);
    }
  });
});
