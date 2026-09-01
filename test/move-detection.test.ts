import { describe, it, expect } from "vitest";
import { diffBlocks, type DiffPair, type InlinePart } from "../src/core/diff.js";
import { parseMarkdown, extractBlocks, blockToText } from "../src/text/parse.js";
import { computeStats } from "../src/model/stats.js";
import { isWholeSentenceSpan } from "../src/text/sentences.js";
import { getPairs } from "../src/api.js";
import type { MatchingLevel } from "../src/config.js";

/** Helper: parse two markdown strings and run the full pipeline */
function runPipeline(leftMd: string, rightMd: string): DiffPair[] {
  const leftBlocks = extractBlocks(parseMarkdown(leftMd));
  const rightBlocks = extractBlocks(parseMarkdown(rightMd));
  return diffBlocks(leftBlocks, rightBlocks);
}

/** Collect inline parts matching a predicate */
function collectParts(pairs: DiffPair[], pred: (part: InlinePart) => boolean): InlinePart[] {
  const out: InlinePart[] = [];
  for (const p of pairs) {
    if (p.status === "modified") {
      for (const part of p.inlineDiff) {
        if (pred(part)) out.push(part);
      }
    }
  }
  return out;
}

function movedParts(pairs: DiffPair[]): InlinePart[] {
  return collectParts(pairs, (p) => p.moved === true);
}

describe("isWholeSentenceSpan", () => {
  it("accepts a complete sentence and rejects fragments", () => {
    expect(
      isWholeSentenceSpan(
        "The measurement protocol requires careful calibration across multiple dimensions.",
      ),
    ).toBe(true);
    expect(isWholeSentenceSpan("measurement protocol requires careful calibration")).toBe(false);
    expect(isWholeSentenceSpan("The measurement protocol requires")).toBe(false);
  });
});

describe("move detection", () => {
  it("marks both sites when a sentence hops between two modified paragraphs", () => {
    const leftMd = `The first concept establishes the framework for understanding complex systems. The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.

The second concept builds on different foundations entirely.`;

    const rightMd = `The first concept establishes the framework for understanding complex systems.

The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps. The second concept builds on different foundations entirely.`;

    const pairs = runPipeline(leftMd, rightMd);

    const moved = movedParts(pairs);
    const phrase = "measurement protocol requires careful calibration";
    expect(moved.some((p) => p.type === "removed" && p.value.includes(phrase))).toBe(true);
    expect(moved.some((p) => p.type === "added" && p.value.includes(phrase))).toBe(true);
  });

  it("marks a whole paragraph relocated earlier in the document", () => {
    const para =
      "The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.";
    const leftMd = `# Title

Alpha paragraph stays exactly the same here in both versions.

${para}

Closing paragraph stays put here with enough words.`;
    const rightMd = `# Title

${para}

Alpha paragraph stays exactly the same here in both versions.

Closing paragraph stays put here with enough words.`;

    const pairs = runPipeline(leftMd, rightMd);
    expect(pairs.some((p) => p.status === "removed" && p.moved)).toBe(true);
    expect(pairs.some((p) => p.status === "added" && p.moved)).toBe(true);
    const origin = pairs.find((p) => p.status === "removed" && p.moved);
    const dest = pairs.find((p) => p.status === "added" && p.moved);
    if (origin?.status !== "removed" || dest?.status !== "added") {
      throw new Error("expected a whole-paragraph origin and destination");
    }
    expect(origin.moveId).toBeDefined();
    expect(origin.moveId).toBe(dest.moveId);
  });

  it("does not mark mid-sentence fragments as a move", () => {
    const leftMd =
      "The cat sat on the mat for a long quiet afternoon. The dog ran across the yard very quickly today. The bird flew over the trees in total silence.";

    const rightMd =
      "The cat sat on the mat for a long quiet afternoon. The bird flew over the trees in total silence. The dog ran across the yard very quickly today.";

    const pairs = runPipeline(leftMd, rightMd);
    // LCS splits "The " onto the previous equal, so the slices are not whole sentences.
    expect(movedParts(pairs)).toHaveLength(0);
  });

  it.each(["normal", "inline"] as MatchingLevel[])(
    "marks a rewritten section that moved later (%s)",
    (level) => {
      const oldSchein =
        "Edgar Schein, the psychologist whose work on culture formation remains the field's foundation, defined organizational culture as the pattern of shared assumptions a group develops as it learns to cope with its environment – assumptions that work well enough to be taught to new members as the correct way to perceive, think, and feel.";
      const newSchein =
        "A culture is a pattern of shared assumptions a group develops as it learns to cope with its environment – assumptions that work well enough to be taught to new members as the correct way to perceive, think, and feel. Edgar Schein, the psychologist whose work on culture formation remains the field's foundation, defined it that way.";
      const oldTailor =
        "When a tailor who cuts clothes to measure can see that this year's garment hangs better on the body than last year's, and her colleagues can too, the improvement is real in a way that no performance review can substitute for. The work means something because it is perceived fully, at the right resolution, by people whose judgment the practitioner has reason to trust.";
      const newTailor =
        "When a tailor who cuts clothes to measure can see that this year's garment hangs better on the body than last year's, and her colleagues can too, the improvement is real in a way that no performance review can substitute for. The work means something because it is perceived fully, at the right resolution, by people whose judgment the practitioner has reason to trust – and because that perception has consequences.";

      const leftMd = `## What Culture Sees

${oldSchein}

${oldTailor}

## What the Firm Can Track

The firm organizes what it can track, and that tracking is not without power. Revenue, margins, output per employee, customer satisfaction scores, defect rates, time to delivery: a well-run company tracks all of these, measurements of real things.`;

      const rightMd = `## What the Firm Can Track

The firm organizes what it can track, and that tracking is not without power. Revenue, margins, output per employee, customer satisfaction scores, defect rates, time to delivery: a well-run company tracks all of these, measurements of real things.

## What Culture Does

${newSchein}

${newTailor}`;

      const pairs = getPairs(leftMd, rightMd, { matchLevel: level });
      const remMoved = pairs.filter((p) => p.status === "removed" && p.moved);
      const addMoved = pairs.filter((p) => p.status === "added" && p.moved);
      // Tailor is almost the same paragraph relocated (equal words > 2/3).
      expect(remMoved.some((p) => p.status === "removed" && blockToText(p.left).includes("tailor"))).toBe(true);
      expect(addMoved.some((p) => p.status === "added" && blockToText(p.right).includes("tailor"))).toBe(true);
      expect(pairs.some((p) => p.status === "equal" && "right" in p && blockToText(p.right).includes("What the Firm Can Track"))).toBe(true);

      const tailorFrom = remMoved.find((p) => p.status === "removed" && blockToText(p.left).includes("tailor"));
      const tailorTo = addMoved.find((p) => p.status === "added" && blockToText(p.right).includes("tailor"));
      expect(tailorFrom?.status === "removed" && tailorFrom.inlineDiff).toBeTruthy();
      expect(tailorTo?.status === "added" && tailorTo.inlineDiff).toBeTruthy();
      if (tailorFrom?.status === "removed" && tailorFrom.inlineDiff && tailorTo?.status === "added" && tailorTo.inlineDiff) {
        expect(tailorTo.inlineDiff.some((p) => p.type === "added" && p.value.includes("consequences"))).toBe(true);
      }

      // Schein is rewritten enough that it is a plain delete + add, not a move.
      const scheinFrom = pairs.find((p) => p.status === "removed" && blockToText(p.left).includes("Schein"));
      const scheinTo = pairs.find((p) => p.status === "added" && blockToText(p.right).includes("Schein"));
      expect(scheinFrom?.moved).toBeUndefined();
      expect(scheinTo?.moved).toBeUndefined();
      if (scheinFrom?.status === "removed") expect(scheinFrom.inlineDiff).toBeUndefined();
      if (scheinTo?.status === "added") expect(scheinTo.inlineDiff).toBeUndefined();
    },
  );

  it("keeps dropped lead-in as removed inside a moved paragraph", () => {
    const body =
      "When a tailor who cuts clothes to measure can see that this year's garment hangs better on the body than last year's, and her colleagues can too, the improvement is real in a way that no performance review can substitute for.";
    const leftMd = `## Stay

This perceptual capacity is where meaning lives. ${body}

The firm organizes what it can track, and that tracking is not without power. Revenue margins output per employee stay put here.`;
    const rightMd = `## Stay

The firm organizes what it can track, and that tracking is not without power. Revenue margins output per employee stay put here.

${body} The work means something because it is perceived fully at the right resolution.`;

    const pairs = getPairs(leftMd, rightMd, { matchLevel: "inline" });
    const origin = pairs.find((p) => p.status === "removed" && p.moved && "left" in p && blockToText(p.left).includes("tailor"));
    expect(origin?.status).toBe("removed");
    if (origin?.status === "removed") {
      expect(origin.inlineDiff).toBeDefined();
      const removed = origin.inlineDiff!.filter((p) => p.type === "removed").map((p) => p.value).join("");
      expect(removed).toContain("perceptual capacity");
    }
  });

  it("marks a relocated identical paragraph as a block-level move", () => {
    const para =
      "The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.";
    const leftMd = `Opening paragraph stays put here with enough words.

${para}

Closing paragraph also stays put here with enough words.`;
    const rightMd = `Opening paragraph stays put here with enough words.

Closing paragraph also stays put here with enough words.

${para}`;

    const pairs = runPipeline(leftMd, rightMd);
    expect(pairs.some((p) => p.status === "removed" && p.moved)).toBe(true);
    expect(pairs.some((p) => p.status === "added" && p.moved)).toBe(true);
  });

  it("does not detect moves for short text segments", () => {
    const leftMd = `The cat sat on the mat. A long paragraph follows with enough words.

A different paragraph here with other content.`;

    const rightMd = `The dog sat on the mat. A long paragraph follows with enough words.

A different paragraph here with other content.`;

    const pairs = runPipeline(leftMd, rightMd);
    expect(pairs.filter((p) => p.status === "added" && p.moved)).toHaveLength(0);
    expect(movedParts(pairs)).toHaveLength(0);
  });

  it("does not mark an in-place rewrite of a long similar sentence as a move", () => {
    const leftMd =
      "The measurement protocol requires careful calibration across multiple dimensions of analysis and repeated validation.";
    const rightMd =
      "The measurement protocol requires careful calibration across several dimensions of analysis and repeated validation.";

    const pairs = runPipeline(leftMd, rightMd);
    expect(movedParts(pairs)).toHaveLength(0);
  });

  it("counts moved words on the origin side only", () => {
    const para =
      "The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.";
    const pairs = runPipeline(
      `Stay put opening paragraph with enough words.\n\n${para}\n\nStay put closing paragraph with enough words.`,
      `Stay put opening paragraph with enough words.\n\nStay put closing paragraph with enough words.\n\n${para}`,
    );
    const stats = computeStats(pairs);
    expect(stats.wordsMoved).toBeGreaterThan(0);
    expect(stats.wordsAdded).toBe(0);
    expect(stats.wordsRemoved).toBe(0);
  });

  it("produces valid ModifiedPair structure with correct metrics", () => {
    const leftMd =
      "The framework was designed for large-scale distributed processing. Several years later, the research team published their comprehensive findings about network effects.";

    const rightMd = `The framework was designed for large-scale distributed processing.

Several years later, the research team published their comprehensive findings about network effects.`;

    const pairs = runPipeline(leftMd, rightMd);

    for (const p of pairs) {
      if (p.status === "modified") {
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
    const leftMd = `Some prefix.

Opening phrase of the content. Continuation of the same thought with more detail.`;

    const rightMd = `Some prefix.

Opening phrase of the content.

Continuation of the same thought with more detail.`;

    const pairs = runPipeline(leftMd, rightMd);

    const splitPairs = pairs.filter(p => p.status === "split");
    expect(splitPairs).toHaveLength(1);
  });
});

describe("split detection and move detection interaction", () => {
  it("should not double-detect: split handles the case before move detection runs", () => {
    const leftMd =
      "The evidence points to a significant shift. We possess productive capacity sufficient for broad material security. This is not post-scarcity in the utopian sense but it represents a changed condition.";

    const rightMd = `The evidence points to a significant shift. We possess productive capacity sufficient for broad material security.

This is not post-scarcity in the utopian sense but it represents a changed condition.`;

    const pairs = runPipeline(leftMd, rightMd);

    const splitPairs = pairs.filter(p => p.status === "split");
    const movedPairs = pairs.filter(p => p.status === "added" && p.moved);
    expect(splitPairs).toHaveLength(1);
    expect(movedPairs).toHaveLength(0);
  });

  it("should handle split + independent modification without interference", () => {
    const leftMd = `Alpha beta gamma. Delta epsilon zeta.

The cat sat on the mat quietly.`;

    const rightMd = `Alpha beta gamma.

Delta epsilon zeta.

The dog sat on the mat quietly.`;

    const pairs = runPipeline(leftMd, rightMd);

    const splitPairs = pairs.filter(p => p.status === "split");
    expect(splitPairs).toHaveLength(1);

    const modifiedPairs = pairs.filter(p => p.status === "modified");
    expect(modifiedPairs.length).toBeGreaterThanOrEqual(1);

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
    const leftMd = `The framework introduces several key innovations in distributed computing. The measurement protocol requires careful calibration across multiple dimensions of analysis and repeated validation steps to ensure accuracy.

Unrelated paragraph about other topics entirely.`;

    const rightMd = `The framework introduces several key innovations in distributed computing.

The measurement protocol requires careful calibration across multiple dimensions of analysis and repeated validation steps to ensure accuracy. Unrelated paragraph about other topics entirely.`;

    const pairs = runPipeline(leftMd, rightMd);

    for (const p of pairs) {
      if (p.status === "modified") {
        expect(p.metrics.totalWords).toBeGreaterThan(0);
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

    expect(leftBlocks.size).toBe(3);
    expect(rightBlocks.size).toBe(3);
  });
});
