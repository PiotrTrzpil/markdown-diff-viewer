/**
 * Integration tests for the canvas rendering pipeline.
 * Tests the full flow: markdown → diff → serialize → HTML output.
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown, extractBlocks } from "../src/text/parse.js";
import { diffBlocks, type DiffPair } from "../src/core/diff.js";
import { serializeDiffData, serializePairs } from "../src/serialize/serialize.js";
import { parseInlineMarkdown } from "../src/canvas/markdown-spans.js";
import { resolveFont, toCanvasFont, defaultFontConfig } from "../src/canvas/fonts.js";
import { generateCanvasHtml } from "../src/canvas/shell.js";
import type { DiffData } from "../src/serialize/types.js";
import type { StyledRun } from "../src/canvas/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPairs(left: string, right: string): DiffPair[] {
  return diffBlocks(extractBlocks(parseMarkdown(left)), extractBlocks(parseMarkdown(right)));
}

function getDiffData(left: string, right: string): DiffData {
  return serializeDiffData(
    [{ path: "test.md", pairs: getPairs(left, right) }],
    { theme: "dark" },
    { leftTitle: "old", rightTitle: "new", version: "test" },
  );
}

// ─── Serializer ─────────────────────────────────────────────────────────────

describe("serializer", () => {
  it("serializes equal pairs with block data", () => {
    const pairs = serializePairs(getPairs("Hello world", "Hello world"));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("equal");
    if (pairs[0].status === "equal") {
      expect(pairs[0].left.type).toBe("paragraph");
      expect(pairs[0].left.innerText).toBe("Hello world");
    }
  });

  it("serializes modified pairs with inline diff", () => {
    const pairs = serializePairs(getPairs("The quick brown fox", "The fast brown fox"));
    const mod = pairs.find((p) => p.status === "modified");
    expect(mod).toBeDefined();
    if (mod?.status === "modified") {
      expect(mod.inlineDiff.length).toBeGreaterThan(0);
      expect(mod.metrics.sharedWords).toBeGreaterThan(0);
    }
  });

  it("produces valid DiffData", () => {
    const data = getDiffData("Hello world", "Hello new world");
    expect(data.files).toHaveLength(1);
    expect(data.meta.leftTitle).toBe("old");
    expect(data.settings.theme).toBe("dark");
  });

  it("handles empty documents", () => {
    const pairs = serializePairs(getPairs("", ""));
    expect(pairs).toHaveLength(0);
  });

  it("handles identical documents", () => {
    const md = "# Title\n\nParagraph one.\n\nParagraph two.";
    const pairs = serializePairs(getPairs(md, md));
    expect(pairs.every((p) => p.status === "equal")).toBe(true);
  });
});

// ─── Inline Markdown Parser ─────────────────────────────────────────────────

describe("parseInlineMarkdown", () => {
  it("plain text → single run", () => {
    const runs = parseInlineMarkdown("Hello world");
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("Hello world");
    expect(runs[0].bold).toBe(false);
  });

  it("parses **bold**", () => {
    const runs = parseInlineMarkdown("Hello **bold** world");
    const bold = runs.find((r) => r.bold);
    expect(bold).toBeDefined();
    expect(bold!.text).toBe("bold");
  });

  it("parses *italic*", () => {
    const italic = parseInlineMarkdown("Hello *italic* world").find((r) => r.italic);
    expect(italic).toBeDefined();
    expect(italic!.text).toBe("italic");
  });

  it("parses `code`", () => {
    const code = parseInlineMarkdown("Use `const` here").find((r) => r.code);
    expect(code).toBeDefined();
    expect(code!.text).toBe("const");
  });

  it("parses [links](url)", () => {
    const link = parseInlineMarkdown("Click [here](https://x.com) now").find((r) => r.link);
    expect(link).toBeDefined();
    expect(link!.text).toBe("here");
    expect(link!.link).toBe("https://x.com");
  });

  it("handles **bold *nested italic***", () => {
    const runs = parseInlineMarkdown("**bold *nested* text**");
    const boldItalic = runs.find((r) => r.bold && r.italic);
    expect(boldItalic).toBeDefined();
    expect(boldItalic!.text).toBe("nested");
  });

  it("handles escape sequences", () => {
    const runs = parseInlineMarkdown("not \\*italic\\*");
    expect(runs.every((r) => !r.italic)).toBe(true);
  });

  it("preserves all text content", () => {
    const input = "Hello **bold** and *italic* `code` world";
    const output = parseInlineMarkdown(input)
      .map((r) => r.text)
      .join("");
    expect(output).toBe("Hello bold and italic code world");
  });
});

// ─── Font Registry ──────────────────────────────────────────────────────────

describe("font registry", () => {
  const config = defaultFontConfig(16);
  const plain: StyledRun = { text: "t", bold: false, italic: false, code: false, strikethrough: false };

  it("paragraph → 16px, weight 400", () => {
    const spec = resolveFont("paragraph", undefined, plain, config);
    expect(spec.size).toBe(16);
    expect(spec.weight).toBe(400);
  });

  it("heading h1 → larger + bold", () => {
    const spec = resolveFont("heading", 1, plain, config);
    expect(spec.size).toBeGreaterThan(16);
    expect(spec.weight).toBe(700);
  });

  it("bold modifier → weight 700", () => {
    const spec = resolveFont("paragraph", undefined, { ...plain, bold: true }, config);
    expect(spec.weight).toBe(700);
  });

  it("italic modifier → style italic", () => {
    const spec = resolveFont("paragraph", undefined, { ...plain, italic: true }, config);
    expect(spec.style).toBe("italic");
  });

  it("code → mono family", () => {
    const spec = resolveFont("code", undefined, plain, config);
    expect(spec.family).toBe(config.monoFamily);
  });

  it("toCanvasFont produces valid string", () => {
    const font = toCanvasFont(resolveFont("paragraph", undefined, plain, config));
    expect(font).toMatch(/16px/);
    expect(font).toContain(config.fontFamily);
  });
});

// ─── HTML Shell ─────────────────────────────────────────────────────────────

describe("HTML shell", () => {
  it("generates valid HTML with embedded data", () => {
    const html = generateCanvasHtml(getDiffData("Hello", "World"), "console.log('boot');");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("diff-data");
    expect(html).toContain("console.log('boot')");
    expect(html).toContain("#canvas");
    expect(html).toContain("#text");
  });

  it("dark theme → #2b2b2b background", () => {
    const html = generateCanvasHtml(getDiffData("Hello", "World"), "");
    expect(html).toContain("#2b2b2b");
  });

  it("solar theme → #faf4e8 background", () => {
    const data = serializeDiffData(
      [{ path: "t.md", pairs: getPairs("Hello", "World") }],
      { theme: "solar" },
      { leftTitle: "a", rightTitle: "b", version: "t" },
    );
    expect(generateCanvasHtml(data, "")).toContain("#faf4e8");
  });

  it("embeds diff text in HTML (for Cmd+F search)", () => {
    const data = getDiffData("# Unique Title Alpha", "# Unique Title Beta");
    const html = generateCanvasHtml(data, "");
    // The DIFF_DATA JSON should contain both titles
    expect(html).toContain("Unique Title Alpha");
    expect(html).toContain("Unique Title Beta");
  });
});

// ─── Full Pipeline ──────────────────────────────────────────────────────────

describe("full pipeline", () => {
  it("generates non-empty HTML for real diffs", () => {
    const data = getDiffData(
      "# Old Title\n\nThe quick brown fox jumps over the lazy dog.",
      "# New Title\n\nThe fast brown fox leaps over the lazy dog.",
    );
    const html = generateCanvasHtml(data, "// boot");
    expect(html.length).toBeGreaterThan(1000);
  });

  it("DiffData round-trips through JSON", () => {
    const data = getDiffData("Hello **bold**", "Hello *italic*");
    const parsed = JSON.parse(JSON.stringify(data)) as DiffData;
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].pairs.length).toBeGreaterThan(0);
    expect(parsed.meta.version).toBe("test");
  });

  it("multi-file DiffData has correct structure", () => {
    const pairs1 = getPairs("File one content", "File one modified");
    const pairs2 = getPairs("File two content", "File two different");
    const data = serializeDiffData(
      [
        { path: "a.md", pairs: pairs1 },
        { path: "b.md", pairs: pairs2 },
      ],
      { theme: "dark" },
      { leftTitle: "old", rightTitle: "new", version: "t" },
    );
    expect(data.files).toHaveLength(2);
    expect(data.files[0].path).toBe("a.md");
    expect(data.files[1].path).toBe("b.md");
  });
});
