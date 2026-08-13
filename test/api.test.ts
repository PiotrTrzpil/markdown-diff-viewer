import { describe, it, expect } from "vitest";
import {
  diffMarkdown,
  getPairs,
  computeAllLevels,
  createDiffContext,
  runWithDiffContext,
  setMatchingLevel,
  getMatchingLevel,
  planLayout,
  projectPairsToDocument,
  computeDocumentStats,
  toHostPayload,
  DIFF_SCHEMA_VERSION,
  MATCHING_LEVEL_NAMES,
  isModifiedBlock,
  isChangedBlock,
  changedBlocks,
  modifiedBlocks,
  cloneDocument,
  isDocumentUnchanged,
  collectInlineLeaves,
  walkDocumentInlineLeaves,
} from "../src/index.js";

describe("diffMarkdown public API", () => {
  it("returns a serializable document with stats, layout, and schema version", () => {
    const result = diffMarkdown(
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox leaps over the lazy cat.",
    );

    expect(result.schemaVersion).toBe(DIFF_SCHEMA_VERSION);
    expect(result.matchLevel).toBe("normal");
    expect(result.document.blocks.length).toBeGreaterThan(0);
    expect(result.stats.blocksModified + result.stats.blocksEqual).toBeGreaterThan(0);
    expect(result.layout.items.length).toBeGreaterThan(0);
    expect(result.pairs.length).toBe(result.document.blocks.length);

    // Document must be JSON-serializable (no cycles / functions)
    const json = JSON.stringify(result.document);
    const parsed = JSON.parse(json) as typeof result.document;
    expect(parsed.blocks[0]?.status).toBeDefined();
  });

  it("toHostPayload strips internal pairs for wire format", () => {
    const result = diffMarkdown("a b c", "a x c");
    const host = toHostPayload(result);
    expect(host.schemaVersion).toBe(DIFF_SCHEMA_VERSION);
    expect(host.document).toEqual(result.document);
    expect(host.stats).toEqual(result.stats);
    expect(host.layout).toEqual(result.layout);
    expect(host.matchLevel).toBe(result.matchLevel);
    expect("pairs" in host).toBe(false);
    // Host payload must round-trip through JSON
    expect(() => JSON.parse(JSON.stringify(host))).not.toThrow();
  });

  it("honors matchLevel option without mutating process default", () => {
    setMatchingLevel("normal");
    const strict = diffMarkdown("Hello world today", "Hello there today", { matchLevel: "strict" });
    const loose = diffMarkdown("Hello world today", "Hello there today", { matchLevel: "loose" });

    expect(strict.matchLevel).toBe("strict");
    expect(loose.matchLevel).toBe("loose");
    expect(getMatchingLevel()).toBe("normal");
  });

  it("is re-entrant across nested match levels", () => {
    const outer = createDiffContext({ matchLevel: "strict" });
    const innerResult = runWithDiffContext(outer, () => {
      return diffMarkdown("aaa bbb ccc ddd eee fff", "aaa bbb XXX ddd eee fff", {
        matchLevel: "loose",
      });
    });
    expect(innerResult.matchLevel).toBe("loose");
  });

  it("inherits ambient context when options omit matchLevel", () => {
    const result = runWithDiffContext(createDiffContext({ matchLevel: "loose" }), () =>
      diffMarkdown("aaa bbb ccc", "aaa xxx ccc"),
    );
    expect(result.matchLevel).toBe("loose");
  });

  it("projects modified blocks with inline parts", () => {
    const { document } = diffMarkdown(
      "We study the Algorithm effect on systems.",
      "We study the algorithm effect on systems.",
    );
    const modified = document.blocks.find(isModifiedBlock);
    expect(modified).toBeDefined();
    if (modified) {
      expect(modified.inline.length).toBeGreaterThan(0);
      expect(modified.left.markdown).toContain("Algorithm");
      expect(modified.right.markdown).toContain("algorithm");
      expect(modified.left.kind).toBe("paragraph");
    }
  });

  it("passes explicit context through the pipeline (strict vs loose can differ)", () => {
    // Shortish rewrite: loose may pair more aggressively than strict
    const left =
      "Opening shared words remain here while the rest of this paragraph is rewritten extensively for testing.";
    const right =
      "Opening shared words remain here while completely different material fills the remainder of the text.";
    const strict = diffMarkdown(left, right, { matchLevel: "strict" });
    const loose = diffMarkdown(left, right, { matchLevel: "loose" });
    // Both should produce a valid document; levels are recorded correctly
    expect(strict.matchLevel).toBe("strict");
    expect(loose.matchLevel).toBe("loose");
    expect(strict.document.blocks.length).toBeGreaterThan(0);
    expect(loose.document.blocks.length).toBeGreaterThan(0);
  });
});

describe("computeAllLevels", () => {
  it("returns a result for every matching level without HTML", () => {
    const all = computeAllLevels("# Title\n\nHello world.", "# Title\n\nHello there.");
    for (const level of MATCHING_LEVEL_NAMES) {
      expect(all.byLevel[level]).toBeDefined();
      expect(all.byLevel[level].matchLevel).toBe(level);
      expect(all.byLevel[level].schemaVersion).toBe(DIFF_SCHEMA_VERSION);
      expect(all.byLevel[level].document.blocks.length).toBeGreaterThan(0);
    }
    expect(all.matchLevel).toBe("normal");
    expect(all.result).toBe(all.byLevel.normal);
  });

  it("respects activeLevel argument", () => {
    const all = computeAllLevels("a b c d e f", "a b x d e f", "strict");
    expect(all.matchLevel).toBe("strict");
    expect(all.result).toBe(all.byLevel.strict);
    expect(all.result.pairs).toBe(all.byLevel.strict.pairs);
  });
});

describe("getPairs / projectPairsToDocument", () => {
  it("round-trips pairs into a document of equal length", () => {
    const pairs = getPairs("One.\n\nTwo.", "One.\n\nThree.");
    const doc = projectPairsToDocument(pairs);
    expect(doc.blocks).toHaveLength(pairs.length);
    const stats = computeDocumentStats(doc);
    expect(stats.filesChanged).toBe(1);
  });
});

describe("planLayout", () => {
  it("plans side-by-side for similar paragraphs", () => {
    const { document, layout } = diffMarkdown(
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox leaps over the lazy dog.",
    );
    const planned = planLayout(document);
    expect(planned.items.length).toBe(layout.items.length);
    expect(planned.items.some((i) => i.mode === "side-by-side")).toBe(true);
  });

  it("stacks unrelated long paragraphs", () => {
    const { layout } = diffMarkdown(
      "Philosophy explores abstract concepts of being and knowledge across centuries of thought.",
      "The weather forecast predicts heavy rain across the region with strong coastal winds.",
    );
    expect(layout.items.some((i) => i.mode === "stacked")).toBe(true);
  });
});

describe("document guards and helpers", () => {
  it("filters changed / modified blocks", () => {
    const { document } = diffMarkdown(
      "Alpha paragraph stays.\n\nBeta will change.",
      "Alpha paragraph stays.\n\nBeta was changed.",
    );
    const changed = changedBlocks(document);
    expect(changed.every(isChangedBlock)).toBe(true);
    expect(changed.some((b) => b.status === "equal")).toBe(false);

    const mods = modifiedBlocks(document);
    expect(mods.every(isModifiedBlock)).toBe(true);
  });

  it("cloneDocument round-trips and detects unchanged", () => {
    const same = diffMarkdown("Same text.", "Same text.");
    expect(isDocumentUnchanged(same.document)).toBe(true);
    const clone = cloneDocument(same.document);
    expect(clone).toEqual(same.document);
    expect(clone).not.toBe(same.document);
  });

  it("collects and walks inline leaves on modified blocks", () => {
    const { document } = diffMarkdown(
      "We study the Algorithm effect.",
      "We study the algorithm effect.",
    );
    const leaves = collectInlineLeaves(document);
    expect(leaves.length).toBeGreaterThan(0);

    let walked = 0;
    walkDocumentInlineLeaves(document, () => {
      walked++;
    });
    expect(walked).toBeGreaterThan(0);
  });
});
