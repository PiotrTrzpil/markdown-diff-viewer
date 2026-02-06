import { describe, it, expect } from "vitest";
import { renderDiffPairs, RenderedRow } from "./render.js";
import { diffBlocks } from "./diff.js";
import { parseMarkdown, extractBlocks } from "./parse.js";

/** Helper: get rendered rows from two markdown strings */
function getRenderOutput(left: string, right: string): RenderedRow[] {
  const leftTree = parseMarkdown(left);
  const rightTree = parseMarkdown(right);
  const leftBlocks = extractBlocks(leftTree);
  const rightBlocks = extractBlocks(rightTree);
  const pairs = diffBlocks(leftBlocks, rightBlocks);
  return renderDiffPairs(pairs);
}

describe("render stacking behavior", () => {
  it("should stack consecutive removed rows before added rows", () => {
    // Completely different paragraphs - no shared content
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.\n\nEthics concerns moral principles.",
      "The weather forecast predicts rain.\n\nTomorrow will be sunny and warm."
    );

    // Find removed and added rows
    const removed = rows.filter((r) => r.status === "removed");
    const added = rows.filter((r) => r.status === "added");

    expect(removed.length).toBe(2);
    expect(added.length).toBe(2);

    // All removed should come before all added
    const firstRemovedIdx = rows.findIndex((r) => r.status === "removed");
    const lastRemovedIdx = rows.length - 1 - [...rows].reverse().findIndex((r) => r.status === "removed");
    const firstAddedIdx = rows.findIndex((r) => r.status === "added");

    expect(lastRemovedIdx).toBeLessThan(firstAddedIdx);
  });

  it("should show side-by-side when paragraphs have shared content", () => {
    // Similar paragraphs with only minor changes
    const rows = getRenderOutput(
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox leaps over the lazy cat."
    );

    // Should be a single modified row (side-by-side), not removed+added
    const modified = rows.filter((r) => r.status === "modified");
    expect(modified.length).toBe(1);

    // Both sides should have content
    expect(modified[0].leftHtml).toContain("fox");
    expect(modified[0].rightHtml).toContain("fox");
  });

  it("should reset stacking at equal paragraphs", () => {
    // Completely different intro/conclusion, but same middle
    const rows = getRenderOutput(
      "Philosophy explores ethics.\n\nThis exact paragraph stays the same.\n\nMorality guides behavior.",
      "Weather patterns shift daily.\n\nThis exact paragraph stays the same.\n\nTemperature varies seasonally."
    );

    const statuses = rows.map((r) => r.status);

    // Find the equal row
    const equalIdx = statuses.indexOf("equal");
    expect(equalIdx).toBeGreaterThan(-1);

    // Check that stacking works: removed before added, both before equal
    const removedBeforeEqual = statuses.slice(0, equalIdx).filter((s) => s === "removed").length;
    const addedBeforeEqual = statuses.slice(0, equalIdx).filter((s) => s === "added").length;
    expect(removedBeforeEqual).toBe(1);
    expect(addedBeforeEqual).toBe(1);

    // Removed comes before added
    const firstRemoved = statuses.indexOf("removed");
    const firstAdded = statuses.indexOf("added");
    expect(firstRemoved).toBeLessThan(firstAdded);
  });

  it("should handle pure removals (no corresponding added)", () => {
    const rows = getRenderOutput(
      "Alpha beta gamma.\n\nThis specific sentence will be deleted entirely.\n\nDelta epsilon zeta.",
      "Alpha beta gamma.\n\nDelta epsilon zeta."
    );

    const removed = rows.filter((r) => r.status === "removed");
    expect(removed.length).toBe(1);
    expect(removed[0].rightHtml).toContain("spacer");
  });

  it("should handle pure additions (no corresponding removed)", () => {
    const rows = getRenderOutput(
      "Alpha beta gamma.\n\nDelta epsilon zeta.",
      "Alpha beta gamma.\n\nThis brand new sentence was inserted here.\n\nDelta epsilon zeta."
    );

    const added = rows.filter((r) => r.status === "added");
    expect(added.length).toBe(1);
    expect(added[0].leftHtml).toContain("spacer");
  });
});

describe("render output structure", () => {
  it("should wrap removed content in removed-block div", () => {
    // Use completely different text to ensure removed+added (not modified)
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.",
      "The weather forecast predicts rain."
    );

    const removed = rows.find((r) => r.status === "removed");
    expect(removed).toBeDefined();
    expect(removed!.leftHtml).toContain('class="removed-block"');
  });

  it("should wrap added content in added-block div", () => {
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.",
      "The weather forecast predicts rain."
    );

    const added = rows.find((r) => r.status === "added");
    expect(added).toBeDefined();
    expect(added!.rightHtml).toContain('class="added-block"');
  });

  it("should wrap modified content in modified-block div", () => {
    const rows = getRenderOutput(
      "The quick brown fox.",
      "The quick brown dog."
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.leftHtml).toContain('class="modified-block"');
    expect(modified!.rightHtml).toContain('class="modified-block"');
  });
});
