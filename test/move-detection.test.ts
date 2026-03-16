import { describe, it, expect } from "vitest";
import { diffBlocks, type DiffPair, type InlinePart } from "../src/core/diff.js";
import { parseMarkdown, extractBlocks, blockToText } from "../src/text/parse.js";

/** Helper: parse two markdown strings and run the full pipeline */
function runPipeline(leftMd: string, rightMd: string): DiffPair[] {
  const leftBlocks = extractBlocks(parseMarkdown(leftMd));
  const rightBlocks = extractBlocks(parseMarkdown(rightMd));
  return diffBlocks(leftBlocks, rightBlocks);
}

/** Collect all inline diff text of a given type across all pairs */
function collectInlineText(pairs: DiffPair[], type: "equal" | "added" | "removed"): string {
  const texts: string[] = [];
  for (const p of pairs) {
    if (p.status === "modified") {
      for (const part of p.inlineDiff) {
        if (part.type === type) texts.push(part.value);
      }
    }
  }
  return texts.join(" ");
}

describe("move detection", () => {
  it("should detect text moved from a modified block to a new added block", () => {
    // Text moves from one paragraph to a new one, with modification on both sides
    // (not a pure split — the text is changed, not just broken apart)
    const leftMd =
      "The algorithm processes data through multiple stages and generates results. Several years later, the research team published their comprehensive findings about the methodology and its implications.";

    const rightMd = `The algorithm processes data through multiple stages and generates output.

Several years later, the research team published their comprehensive findings about the methodology and its broader implications for the field.`;

    const pairs = runPipeline(leftMd, rightMd);

    // The shared text "Several years later, the research team published their comprehensive
    // findings about the methodology" should appear as equal somewhere, not as separate
    // removed+added blocks
    const equalText = collectInlineText(pairs, "equal");
    expect(equalText).toContain("Several years later");
    expect(equalText).toContain("research team published");
  });

  it("should mark the added block as moved when its content came from a modified block", () => {
    const leftMd =
      "Introduction text here. The detailed analysis showed significant results across all measured categories and timeframes.";

    const rightMd = `Introduction text here.

The detailed analysis showed significant results across all measured categories and timeframes.`;

    const pairs = runPipeline(leftMd, rightMd);

    // The pipeline should either mark the added pair as moved or detect it as a split.
    // Either way, the moved text should not appear as both removed AND added separately.
    const removedText = collectInlineText(pairs, "removed");
    const addedText = collectInlineText(pairs, "added");

    // The shared sentence should not be highlighted as both removed and added
    const sharedPhrase = "detailed analysis showed significant results";
    const inBothSides = removedText.includes(sharedPhrase) && addedText.includes(sharedPhrase);
    expect(inBothSides).toBe(false);
  });

  it("should handle moved text between two modified blocks", () => {
    // Text moves from end of paragraph 1 to start of paragraph 2
    const leftMd = `The first concept establishes the framework for understanding complex systems. The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.

The second concept builds on different foundations entirely.`;

    const rightMd = `The first concept establishes the framework for understanding complex systems.

The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps. The second concept builds on different foundations entirely.`;

    const pairs = runPipeline(leftMd, rightMd);

    // The shared text should appear as equal somewhere
    const equalText = collectInlineText(pairs, "equal");
    expect(equalText).toContain("measurement protocol requires careful calibration");
  });

  it("should not detect moves for short text segments", () => {
    // Short removed text should not trigger move detection
    const leftMd = `The cat sat on the mat. A long paragraph follows with enough words.

A different paragraph here with other content.`;

    const rightMd = `The dog sat on the mat. A long paragraph follows with enough words.

A different paragraph here with other content.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Should just be a normal modified pair, no moved markers
    const addedPairs = pairs.filter(p => p.status === "added" && p.moved);
    expect(addedPairs).toHaveLength(0);
  });

  it("should produce valid ModifiedPair structure with correct metrics", () => {
    const leftMd =
      "The framework was designed for large-scale distributed processing. Several years later, the research team published their comprehensive findings about network effects.";

    const rightMd = `The framework was designed for large-scale distributed processing.

Several years later, the research team published their comprehensive findings about network effects.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Every modified pair should have valid metrics
    for (const p of pairs) {
      if (p.status === "modified") {
        expect(p.metrics).toBeDefined();
        expect(p.metrics.totalWords).toBeGreaterThan(0);
        expect(p.metrics.sharedWords).toBeGreaterThanOrEqual(0);
        expect(p.metrics.sharedWords).toBeLessThanOrEqual(p.metrics.totalWords);
        expect(p.wrapTag).toBeDefined();
        expect(p.inlineDiff.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("split detection", () => {
  it("should detect a paragraph split into two identical parts", () => {
    const leftMd =
      "First sentence about the topic. Second sentence continues the discussion.";

    const rightMd = `First sentence about the topic.

Second sentence continues the discussion.`;

    const pairs = runPipeline(leftMd, rightMd);

    const splitPairs = pairs.filter(p => p.status === "split");
    expect(splitPairs).toHaveLength(1);

    const split = splitPairs[0];
    if (split.status === "split") {
      expect(blockToText(split.original)).toContain("First sentence");
      expect(blockToText(split.original)).toContain("Second sentence");
      expect(blockToText(split.firstPart)).toContain("First sentence");
      expect(blockToText(split.secondPart)).toContain("Second sentence");
    }
  });

  it("should detect added-first split pattern", () => {
    // When a new paragraph is added before a modified paragraph,
    // and together they equal the original
    const leftMd = `Some prefix.

Opening phrase of the content. Continuation of the same thought with more detail.`;

    const rightMd = `Some prefix.

Opening phrase of the content.

Continuation of the same thought with more detail.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Should detect the split
    const splitPairs = pairs.filter(p => p.status === "split");
    expect(splitPairs).toHaveLength(1);
  });
});

describe("split detection and move detection interaction", () => {
  it("should not double-detect: split handles the case before move detection runs", () => {
    // A pure paragraph split should be caught by split detection,
    // not misidentified as a move by move detection
    const leftMd =
      "The evidence points to a significant shift. We possess productive capacity sufficient for broad material security. This is not post-scarcity in the utopian sense but it represents a changed condition.";

    const rightMd = `The evidence points to a significant shift. We possess productive capacity sufficient for broad material security.

This is not post-scarcity in the utopian sense but it represents a changed condition.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Should be a split, not a modified+moved
    const splitPairs = pairs.filter(p => p.status === "split");
    const movedPairs = pairs.filter(p => p.status === "added" && p.moved);
    expect(splitPairs).toHaveLength(1);
    expect(movedPairs).toHaveLength(0);
  });

  it("should handle split + independent modification without interference", () => {
    // One paragraph is split, another is independently modified
    const leftMd = `Alpha beta gamma. Delta epsilon zeta.

The cat sat on the mat quietly.`;

    const rightMd = `Alpha beta gamma.

Delta epsilon zeta.

The dog sat on the mat quietly.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Should have a split for the first paragraph
    const splitPairs = pairs.filter(p => p.status === "split");
    expect(splitPairs).toHaveLength(1);

    // Should have a modified pair for cat→dog
    const modifiedPairs = pairs.filter(p => p.status === "modified");
    expect(modifiedPairs.length).toBeGreaterThanOrEqual(1);

    // The modified pair should show cat→dog, not something corrupted by the split
    const modPair = modifiedPairs.find(p => {
      if (p.status !== "modified") return false;
      const leftText = blockToText(p.left);
      return leftText.includes("cat");
    });
    expect(modPair).toBeDefined();
    if (modPair?.status === "modified") {
      const removedText = modPair.inlineDiff
        .filter(part => part.type === "removed")
        .map(part => part.value)
        .join("");
      expect(removedText).toContain("cat");
    }
  });

  it("should handle moved text that is also partially modified", () => {
    // Text is moved AND slightly changed — move detection should not
    // interfere with showing the modification
    const leftMd = `The framework introduces several key innovations in distributed computing. The measurement protocol requires careful calibration across multiple dimensions of analysis and repeated validation steps to ensure accuracy.

Unrelated paragraph about other topics entirely.`;

    const rightMd = `The framework introduces several key innovations in distributed computing.

The measurement protocol requires careful calibration across multiple dimensions of analysis and repeated validation steps to ensure accuracy. Unrelated paragraph about other topics entirely.`;

    const pairs = runPipeline(leftMd, rightMd);

    // No pair should have nonsensical metrics
    for (const p of pairs) {
      if (p.status === "modified") {
        expect(p.metrics.totalWords).toBeGreaterThan(0);
        // sharedWords should be reasonable (not 0 for a block with lots of shared text)
        expect(p.metrics.sharedWords).toBeGreaterThan(0);
      }
    }
  });

  it("should preserve pair count sanity: no pairs lost or duplicated", () => {
    const leftMd = `First paragraph with content.

Second paragraph with different content that is long enough to matter for move detection algorithms.

Third paragraph.`;

    const rightMd = `First paragraph with content.

Third paragraph.

Second paragraph with different content that is long enough to matter for move detection algorithms.`;

    const pairs = runPipeline(leftMd, rightMd);

    // Count unique blocks referenced on each side
    const leftBlocks = new Set<string>();
    const rightBlocks = new Set<string>();
    for (const p of pairs) {
      if ("left" in p && p.left) leftBlocks.add(blockToText(p.left));
      if ("right" in p && p.right) rightBlocks.add(blockToText(p.right));
      if (p.status === "split") {
        leftBlocks.add(blockToText(p.original));
        rightBlocks.add(blockToText(p.firstPart));
        rightBlocks.add(blockToText(p.secondPart));
      }
    }

    // We started with 3 left blocks and 3 right blocks
    expect(leftBlocks.size).toBe(3);
    expect(rightBlocks.size).toBe(3);
  });
});
