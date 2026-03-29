import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { diffBlocks } from "../src/core/diff.js";
import { parseMarkdown, extractBlocks, blockToText } from "../src/text/parse.js";

const oldText = readFileSync(new URL("fixtures/enclaves-old.md", import.meta.url), "utf8");
const newText = readFileSync(new URL("fixtures/enclaves-new.md", import.meta.url), "utf8");

const oldBlocks = extractBlocks(parseMarkdown(oldText));
const newBlocks = extractBlocks(parseMarkdown(newText));
const pairs = diffBlocks(oldBlocks, newBlocks);

describe("enclaves-guilds-and-artifacts regression", () => {
  it("right-side block text must appear in file order", () => {
    const rightBlockTexts: string[] = [];
    for (const pair of pairs) {
      if ("right" in pair && pair.right) {
        rightBlockTexts.push(blockToText(pair.right));
      }
    }

    let lastPos = -1;
    for (const text of rightBlockTexts) {
      const pos = newText.indexOf(text.substring(0, 60));
      expect(pos, `Right-side text not found: "${text.substring(0, 60)}"`).toBeGreaterThanOrEqual(0);
      expect(
        pos,
        `Right-side out of order: "${text.substring(0, 40)}" at ${pos} should come after ${lastPos}`,
      ).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
  });

  it("modified pair should match paragraph sharing the opening", () => {
    const modified = pairs.filter(p => p.status === "modified");
    expect(modified.length).toBe(1);

    const mod = modified[0];
    expect(blockToText(mod.left)).toContain("These institutional forms");
    expect(
      blockToText(mod.right).startsWith("These institutional forms"),
      `Modified pair matched wrong block: "${blockToText(mod.right).substring(0, 60)}"`,
    ).toBe(true);
  });

  it("new paragraphs must be separate added blocks", () => {
    const addedTexts = pairs
      .filter(p => p.status === "added")
      .map(p => ("right" in p && p.right ? blockToText(p.right) : ""));

    expect(addedTexts.some(t => t.includes("Every human society"))).toBe(true);
    expect(addedTexts.some(t => t.includes("But institutional design, however sound"))).toBe(true);
  });
});
