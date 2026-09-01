import { describe, expect, it } from "vitest";
import { diffMarkdown } from "../src/api.js";
import { MATCHING_LEVEL_NAMES } from "../src/config.js";

const REWRITE_LEFT =
  "## Title\n\nAlpha beta gamma delta epsilon zeta eta theta.\n\nClosing line.";
const REWRITE_RIGHT =
  "## Title\n\nQuantum flux pancake orchard willow nutmeg lantern brine.\n\nClosing line.";

describe("inline match level", () => {
  it("is a registered matching level", () => {
    expect(MATCHING_LEVEL_NAMES).toContain("inline");
  });

  it("pairs a rewrite that loose still leaves as delete then add", () => {
    const loose = diffMarkdown(REWRITE_LEFT, REWRITE_RIGHT, { matchLevel: "loose" });
    const inline = diffMarkdown(REWRITE_LEFT, REWRITE_RIGHT, { matchLevel: "inline" });

    expect(loose.document.blocks.some((b) => b.status === "removed")).toBe(true);
    expect(loose.document.blocks.some((b) => b.status === "added")).toBe(true);

    expect(inline.matchLevel).toBe("inline");
    expect(inline.document.blocks.some((b) => b.status === "removed")).toBe(false);
    expect(inline.document.blocks.some((b) => b.status === "added")).toBe(false);
    const modified = inline.document.blocks.filter((b) => b.status === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].inline.length).toBeGreaterThan(0);
    expect(modified[0].inline.some((p) => p.type === "removed" || p.type === "added")).toBe(
      true,
    );
  });

  it("plans rewritten blocks side-by-side instead of stacked", () => {
    const inline = diffMarkdown(REWRITE_LEFT, REWRITE_RIGHT, { matchLevel: "inline" });
    const loose = diffMarkdown(REWRITE_LEFT, REWRITE_RIGHT, { matchLevel: "loose" });

    expect(loose.layout.items.some((item) => item.mode === "stacked")).toBe(true);
    expect(inline.layout.items.every((item) => item.mode === "side-by-side")).toBe(true);
  });
});
