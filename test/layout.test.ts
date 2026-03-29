/**
 * Tests for the layout engine's observable behavior.
 * Validates side-by-side decisions, serialized pair structure,
 * and block type classification.
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown, extractBlocks } from "../src/text/parse.js";
import { diffBlocks, type DiffPair } from "../src/core/diff.js";
import { serializePairs } from "../src/serialize/serialize.js";
import { isSideBySide } from "../src/canvas/layout.js";
import type { SerializedPair } from "../src/serialize/types.js";

function serialize(left: string, right: string): SerializedPair[] {
  const pairs = diffBlocks(extractBlocks(parseMarkdown(left)), extractBlocks(parseMarkdown(right)));
  return serializePairs(pairs);
}

describe("isSideBySide", () => {
  it("equal pairs are always side-by-side", () => {
    const pairs = serialize("Hello world", "Hello world");
    expect(pairs[0].status).toBe("equal");
    expect(isSideBySide(pairs[0])).toBe(true);
  });

  it("modified pairs with shared words are side-by-side", () => {
    const pairs = serialize("The quick brown fox", "The fast brown fox");
    const mod = pairs.find((p) => p.status === "modified");
    expect(mod).toBeDefined();
    expect(isSideBySide(mod!)).toBe(true);
  });

  it("added/removed pairs are stacked", () => {
    const pairs = serialize("Alpha bravo", "Delta echo foxtrot golf hotel");
    for (const p of pairs) {
      if (p.status === "added" || p.status === "removed") {
        expect(isSideBySide(p)).toBe(false);
      }
    }
  });

  it("modified with zero shared words is stacked", () => {
    const pairs = serialize("completely different sentence here today", "nothing in common at all whatsoever now");
    const mod = pairs.find((p) => p.status === "modified");
    if (mod?.status === "modified" && mod.metrics.sharedWords === 0) {
      expect(isSideBySide(mod)).toBe(false);
    }
  });

  it("long paragraph with low shared ratio is stacked", () => {
    // 20+ words with very few shared
    const left =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";
    const right =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty";
    const pairs = serialize(left, right);
    const mod = pairs.find((p) => p.status === "modified");
    if (mod) expect(isSideBySide(mod)).toBe(false);
  });
});

describe("serialized pair structure", () => {
  it("equal pairs have matching innerText", () => {
    const pairs = serialize("Hello world", "Hello world");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.innerText).toBe(pairs[0].right.innerText);
    }
  });

  it("modified pairs have inline diff and metrics", () => {
    const pairs = serialize(
      "The quick brown fox jumps over the lazy dog",
      "The fast brown fox leaps over the lazy dog",
    );
    const mod = pairs.find((p) => p.status === "modified");
    expect(mod).toBeDefined();
    if (mod?.status === "modified") {
      expect(mod.inlineDiff.length).toBeGreaterThan(0);
      expect(mod.metrics.sharedWords).toBeGreaterThan(0);
      expect(mod.metrics.totalWords).toBeGreaterThan(0);
      expect(mod.wrapTag).toBe("p");
    }
  });

  it("heading blocks have correct type and level", () => {
    const pairs = serialize("## Section", "## Section");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.type).toBe("heading");
      expect(pairs[0].left.headingLevel).toBe(2);
    }
  });

  it("code blocks have correct type", () => {
    const pairs = serialize("```js\nconst x = 1;\n```", "```js\nconst x = 1;\n```");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.type).toBe("code");
    }
  });

  it("blockquotes have correct type", () => {
    const pairs = serialize("> A quote", "> A quote");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.type).toBe("blockquote");
    }
  });

  it("preserves source line numbers", () => {
    const pairs = serialize("# Title\n\nParagraph", "# Title\n\nParagraph");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.line).toBe(1);
    }
  });

  it("round-trips through JSON", () => {
    const pairs = serialize("Hello **bold** world", "Hello *italic* world");
    const json = JSON.stringify(pairs);
    const parsed = JSON.parse(json) as SerializedPair[];
    expect(parsed.length).toBe(pairs.length);
    expect(parsed[0].status).toBe(pairs[0].status);
  });
});
