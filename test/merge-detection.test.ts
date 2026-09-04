import { describe, it, expect } from "vitest";
import { diffMarkdown, getPairs } from "../src/api.js";
import { blockToText, concatParagraphs, extractBlocks, parseMarkdown } from "../src/text/parse.js";

describe("concatParagraphs", () => {
  it("joins phrasing with a space", () => {
    const blocks = extractBlocks(parseMarkdown("Hello world.\n\nMore words here."));
    const joined = concatParagraphs(blocks);
    expect(blockToText(joined)).toBe("Hello world. More words here.");
  });
});

describe("paragraph merge detection", () => {
  it("folds two left paragraphs that were concatenated on the right", () => {
    const leftMd = `First sentence about the topic.

Second sentence continues the discussion.`;
    const rightMd = `First sentence about the topic. Second sentence continues the discussion.`;

    const result = diffMarkdown(leftMd, rightMd);
    expect(result.document.blocks).toHaveLength(1);
    const block = result.document.blocks[0];
    expect(block.status).toBe("modified");
    if (block.status !== "modified") throw new Error("expected modified");
    expect(block.left.markdown).toContain("First sentence");
    expect(block.left.markdown).toContain("Second sentence");
    expect(block.right.markdown).toContain("First sentence");
    expect(block.right.markdown).toContain("Second sentence");
  });

  it("folds several absorbed paragraphs into the surviving neighbor", () => {
    const market =
      "The market's motivational logic is transparent. Inefficiency gets eliminated, and a process that takes three steps gets collapsed into one. Optimization is the drive – reductive and compressive, pushing always to make the thing simpler and faster and cheaper – and the feedback is clear and immediate: the metric improves or it doesn't.";
    const guild =
      "The guild's drive works through a different experience entirely. In material, form, and the gap between intention and execution, a practitioner meets depth already present in the work. Grain under the hand holds a pattern that can be revealed rather than invented, and the same encounter runs through any craft that has depth to it.";
    const perception =
      "As perception develops, more becomes available to notice. Cloth that once looked only navy starts to show texture, weight, and the way it hangs, and rooms that passed as fine on a first walk-through begin to feel either alive or dead. Formation is rewarding in a perceptual rather than hedonic sense.";
    const deep =
      "The deep drive, then, is the desire to live among work that matches that finer perception – and to produce work adequate to what one can now see. A practitioner whose perception now demands a given resolution cannot produce work that falls below it without experiencing something like the dissonance a musician with trained ears feels when forced to ignore a wrong note.";
    const combined =
      "The market's motivational logic is transparent. Inefficiency gets eliminated, and a process that takes three steps gets collapsed into one. Optimization is the drive – reductive and compressive, pushing always to make the thing simpler and faster and cheaper – and the feedback is clear and immediate: the metric improves or it doesn't. The guild's drive works through a different experience. In material, form, and the gap between intention and execution, a practitioner meets depth already present in the work. Grain under the hand holds a pattern that can be revealed rather than invented, and the same encounter runs through any craft that has depth to it. As perception develops, more becomes available to notice. Cloth that once looked only navy starts to show texture, weight, and the way it hangs, and rooms that passed as fine on a first walk-through begin to feel either alive or dead. Formation is rewarding in a perceptual rather than hedonic sense: the desire to live among work that matches that finer perception, and to produce work adequate to what one can now see. A practitioner whose perception now demands a given resolution cannot produce work that falls below it without experiencing something like the dissonance a musician with trained ears feels when forced to ignore a wrong note.";
    const close = "Stay put closing paragraph with enough words to remain anchored here.";

    const leftMd = `${market}\n\n${guild}\n\n${perception}\n\n${deep}\n\n${close}`;
    const rightMd = `${combined}\n\n${close}`;

    const result = diffMarkdown(leftMd, rightMd, { matchLevel: "inline" });
    const blocks = result.document.blocks;
    expect(blocks.some((b) => b.status === "removed" && b.left.markdown.includes("perception develops"))).toBe(
      false,
    );
    expect(blocks.some((b) => b.status === "removed" && b.left.markdown.includes("guild's drive"))).toBe(false);
    const merged = blocks.find((b) => b.status === "modified" && b.right.markdown.includes("perception develops"));
    if (merged === undefined || merged.status !== "modified") {
      throw new Error("expected a modified block for the joined paragraph");
    }
    expect(merged.left.markdown).toContain("market's motivational");
    expect(merged.left.markdown).toContain("guild's drive");
    expect(merged.left.markdown).toContain("perception develops");
    expect(merged.left.markdown).toContain("deep drive");
    expect(blocks.filter((b) => (b.status === "added" || b.status === "removed") && b.moved && b.moveId === undefined)).toHaveLength(
      0,
    );
  });

  it("folds a rewritten neighbor that absorbed the following paragraphs", () => {
    const market =
      "The market's motivational logic is transparent. Inefficiency gets eliminated, and a process that takes three steps gets collapsed into one. Optimization is the drive – reductive and compressive, pushing always to make the thing simpler and faster and cheaper – and the feedback is clear and immediate: the metric improves or it doesn't.";
    const guild =
      "The guild's drive works through a different experience entirely. In material, form, and the gap between intention and execution, a practitioner meets depth already present in the work. Grain under the hand holds a pattern that can be revealed rather than invented, and the same encounter runs through any craft that has depth to it.";
    const perception =
      "As perception develops, more becomes available to notice. Cloth that once looked only navy starts to show texture, weight, and the way it hangs, and rooms that passed as fine on a first walk-through begin to feel either alive or dead. Formation is rewarding in a perceptual rather than hedonic sense.";
    const deep =
      "The deep drive, then, is the desire to live among work that matches that finer perception – and to produce work adequate to what one can now see. A practitioner whose perception now demands a given resolution cannot produce work that falls below it without experiencing something like the dissonance a musician with trained ears feels when forced to ignore a wrong note.";
    const combined =
      "In a market the pull is easy to see – inefficiency gets eliminated, a process that takes three steps gets collapsed into one, and the metric improves or it doesn't. The guild's drive works through a different experience. In material, form, and the gap between intention and execution, a practitioner meets depth already present in the work. Grain under the hand holds a pattern that can be revealed rather than invented, and the same encounter runs through any craft that has depth to it. As perception develops, more becomes available to notice. Cloth that once looked only navy starts to show texture, weight, and the way it hangs, and rooms that passed as fine on a first walk-through begin to feel either alive or dead. Formation is rewarding because you come to see more, not merely because it feels good: the desire to live among work that matches that finer perception, and to produce work adequate to what one can now see. A practitioner who can now see that much in the work cannot produce below it without experiencing something like the dissonance a musician with trained ears feels when forced to ignore a wrong note.";
    const close = "Stay put closing paragraph with enough words to remain anchored here.";

    const result = diffMarkdown(
      `${market}\n\n${guild}\n\n${perception}\n\n${deep}\n\n${close}`,
      `${combined}\n\n${close}`,
      { matchLevel: "inline" },
    );
    const blocks = result.document.blocks;
    const guildRemoved = blocks.find(
      (b) => b.status === "removed" && b.left.markdown.includes("guild's drive"),
    );
    expect(guildRemoved?.moved).toBeUndefined();
    const joined = blocks.find(
      (b) => b.status === "modified" && b.right.markdown.includes("guild's drive"),
    );
    if (joined === undefined || joined.status !== "modified") {
      throw new Error("expected the rewritten market paragraph to absorb the guild text");
    }
    expect(joined.left.markdown).toContain("guild's drive");
  });

  it("does not swallow an unrelated deleted neighbor", () => {
    const stay =
      "The measurement protocol requires careful calibration across multiple dimensions and repeated validation steps.";
    const gone =
      "Unrelated deleted paragraph about zebras, quasars, and submarine sandwich recipes with enough extra words.";
    const leftMd = `${stay}\n\n${gone}`;
    const rightMd = `${stay} A short extra clause about validation.`;

    const pairs = getPairs(leftMd, rightMd, { matchLevel: "inline" });
    expect(pairs.some((p) => p.status === "removed" && blockToText(p.left).includes("zebras"))).toBe(true);
  });
});
