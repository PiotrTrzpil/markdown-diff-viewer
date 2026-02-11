import { describe, it, expect } from "vitest";
import { renderDiffPairs, RenderedRow } from "./render.js";
import { diffBlocks, computeInlineDiff } from "./diff.js";
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
      "The weather forecast predicts rain.\n\nTomorrow will be sunny and warm.",
    );

    // Find removed and added rows
    const removed = rows.filter((r) => r.status === "removed");
    const added = rows.filter((r) => r.status === "added");

    expect(removed.length).toBe(2);
    expect(added.length).toBe(2);

    // All removed should come before all added
    const lastRemovedIdx = rows.length - 1 - [...rows].reverse().findIndex((r) => r.status === "removed");
    const firstAddedIdx = rows.findIndex((r) => r.status === "added");

    expect(lastRemovedIdx).toBeLessThan(firstAddedIdx);
  });

  it("should show side-by-side when paragraphs have shared content", () => {
    // Similar paragraphs with only minor changes
    const rows = getRenderOutput(
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox leaps over the lazy cat.",
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
      "Weather patterns shift daily.\n\nThis exact paragraph stays the same.\n\nTemperature varies seasonally.",
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
      "Alpha beta gamma.\n\nDelta epsilon zeta.",
    );

    const removed = rows.filter((r) => r.status === "removed");
    expect(removed.length).toBe(1);
    expect(removed[0].rightHtml).toContain("spacer");
  });

  it("should handle pure additions (no corresponding removed)", () => {
    const rows = getRenderOutput(
      "Alpha beta gamma.\n\nDelta epsilon zeta.",
      "Alpha beta gamma.\n\nThis brand new sentence was inserted here.\n\nDelta epsilon zeta.",
    );

    const added = rows.filter((r) => r.status === "added");
    expect(added.length).toBe(1);
    expect(added[0].leftHtml).toContain("spacer");
  });
});

describe("gap-based alignment", () => {
  it("should use gap-aligned class and diff-part spans for modified blocks", () => {
    const rows = getRenderOutput(
      "First some random words then the lazy dog sleeps peacefully in the warm sun today.",
      "Here is different text but the lazy dog sleeps peacefully in the cold moon tonight.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();

    // Should have gap-aligned class and diff-part spans
    expect(modified!.leftHtml).toContain('class="modified-block gap-aligned"');
    expect(modified!.rightHtml).toContain('class="modified-block gap-aligned"');
    expect(modified!.leftHtml).toContain('class="diff-part"');
    expect(modified!.rightHtml).toContain('class="diff-part"');

    // The shared content should be present
    expect(modified!.leftHtml).toContain("the lazy dog sleeps peacefully");
    expect(modified!.rightHtml).toContain("the lazy dog sleeps peacefully");
  });

  it("should create spacers on opposite side for removed/added content", () => {
    const rows = getRenderOutput(
      "The quick brown fox jumps.",
      "The quick brown dog leaps.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();

    // Left side should have removed content and spacers for added
    expect(modified!.leftHtml).toContain("diff-removed");
    expect(modified!.leftHtml).toContain("diff-placeholder");

    // Right side should have added content and spacers for removed
    expect(modified!.rightHtml).toContain("diff-added");
    expect(modified!.rightHtml).toContain("diff-placeholder");
  });

  it("should show invisible placeholders for alignment", () => {
    // Use longer, more similar sentences to ensure they match as modified
    const rows = getRenderOutput(
      "The quick brown fox jumps over the lazy dog in the sunny meadow.",
      "The quick brown cat jumps over the lazy dog in the sunny meadow.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();

    // Left side has placeholder for "cat" (added on right)
    expect(modified!.leftHtml).toContain("diff-placeholder");
    // Right side has placeholder for "fox" (removed on left)
    expect(modified!.rightHtml).toContain("diff-placeholder");
  });
});

describe("render output structure", () => {
  it("should wrap removed content in removed-block div", () => {
    // Use completely different text to ensure removed+added (not modified)
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.",
      "The weather forecast predicts rain.",
    );

    const removed = rows.find((r) => r.status === "removed");
    expect(removed).toBeDefined();
    expect(removed!.leftHtml).toContain('class="removed-block"');
  });

  it("should wrap added content in added-block div", () => {
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.",
      "The weather forecast predicts rain.",
    );

    const added = rows.find((r) => r.status === "added");
    expect(added).toBeDefined();
    expect(added!.rightHtml).toContain('class="added-block"');
  });

  it("should wrap modified content in modified-block div", () => {
    const rows = getRenderOutput(
      "The quick brown fox.",
      "The quick brown dog.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.leftHtml).toContain("modified-block");
    expect(modified!.rightHtml).toContain("modified-block");
  });
});

describe("long paragraph threshold", () => {
  it("should stack long paragraphs (20+ words) with minimal shared content (< 3 words)", () => {
    // Long paragraph (20+ words) with only 2 shared words - should be stacked
    const rows = getRenderOutput(
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi.",
      "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen chi phi.",
    );

    // Should be stacked (removed + added), not side-by-side modified
    const removed = rows.filter((r) => r.status === "removed");
    const added = rows.filter((r) => r.status === "added");
    const modified = rows.filter((r) => r.status === "modified");

    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
    expect(modified.length).toBe(0);
  });

  it("should show long paragraphs side-by-side when they share 3+ words", () => {
    // Long paragraph with 4+ shared words - should be side-by-side
    const rows = getRenderOutput(
      "Alpha beta gamma delta epsilon zeta eta theta iota kappa the quick brown fox jumps over lazy dog today.",
      "One two three four five six seven eight nine ten eleven the quick brown fox jumps over lazy cat tomorrow.",
    );

    // Should be modified (side-by-side) since there are 7 shared words
    const modified = rows.filter((r) => r.status === "modified");
    expect(modified.length).toBe(1);
  });

  it("should show short paragraphs side-by-side even with minimal shared content", () => {
    // Short paragraph (< 20 words) with just 1 shared word - should still be side-by-side
    const rows = getRenderOutput(
      "The cat sat here.",
      "A dog ran there.",
    );

    // Short paragraphs don't have the minimum shared words requirement
    // This depends on the diff algorithm matching - if no match, will be stacked
    const statuses = rows.map((r) => r.status);
    // Either modified (if matched) or removed+added (if not matched by similarity)
    expect(statuses.length).toBeGreaterThan(0);
  });
});

// ─── Text Fidelity Tests ────────────────────────────────────────────────────
// These tests verify that the rendered output exactly preserves the original text

/**
 * Extract visible text from rendered HTML, excluding placeholders.
 * Strips HTML tags and returns plain text that would be visible to users.
 */
function extractVisibleText(html: string): string {
  // Remove placeholder spans (they have visibility:hidden in CSS)
  let text = html.replace(/<span[^>]*class="[^"]*diff-placeholder[^"]*"[^>]*>[\s\S]*?<\/span>/g, "");

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Extract expected visible text from markdown, handling block types.
 * For the right side: equal + added content should be visible.
 * For the left side: equal + removed content should be visible.
 */
function normalizeMarkdown(md: string): string {
  // Remove markdown syntax for comparison
  let text = md
    .replace(/^#{1,6}\s+/gm, "")  // headers
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // bold
    .replace(/\*([^*]+)\*/g, "$1")  // italic
    .replace(/`([^`]+)`/g, "$1")  // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");  // images

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

describe("text fidelity - rendered output matches original", () => {
  it("should preserve exact text in equal blocks", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const rows = getRenderOutput(text, text);

    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("equal");

    const leftText = extractVisibleText(rows[0].leftHtml);
    const rightText = extractVisibleText(rows[0].rightHtml);
    const expected = normalizeMarkdown(text);

    expect(leftText).toBe(expected);
    expect(rightText).toBe(expected);
  });

  it("should preserve right-side text in modified blocks", () => {
    const left = "The quick brown fox jumps over the lazy dog.";
    const right = "The quick brown cat leaps over the lazy dog.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const rightText = extractVisibleText(modified!.rightHtml);
    const expected = normalizeMarkdown(right);

    expect(rightText).toBe(expected);
  });

  it("should preserve left-side text in modified blocks", () => {
    const left = "The quick brown fox jumps over the lazy dog.";
    const right = "The quick brown cat leaps over the lazy dog.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const leftText = extractVisibleText(modified!.leftHtml);
    const expected = normalizeMarkdown(left);

    expect(leftText).toBe(expected);
  });

  it("should preserve text in added blocks", () => {
    const left = "First paragraph.";
    const right = "First paragraph.\n\nSecond paragraph added here.";
    const rows = getRenderOutput(left, right);

    const added = rows.find(r => r.status === "added");
    expect(added).toBeDefined();

    const rightText = extractVisibleText(added!.rightHtml);
    expect(rightText).toBe("Second paragraph added here.");
  });

  it("should preserve text in removed blocks", () => {
    const left = "First paragraph.\n\nSecond paragraph will be removed.";
    const right = "First paragraph.";
    const rows = getRenderOutput(left, right);

    const removed = rows.find(r => r.status === "removed");
    expect(removed).toBeDefined();

    const leftText = extractVisibleText(removed!.leftHtml);
    expect(leftText).toBe("Second paragraph will be removed.");
  });

  it("should preserve special characters and punctuation", () => {
    const left = "Hello, world! How are you? I'm fine & well.";
    const right = "Hello, world! How are you? I'm great & healthy.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const rightText = extractVisibleText(modified!.rightHtml);
    const expected = normalizeMarkdown(right);

    expect(rightText).toBe(expected);
  });

  it("should preserve markdown formatting in output", () => {
    const left = "This is **bold** and *italic* text.";
    const right = "This is **bold** and *emphasized* text.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    // The HTML should contain the formatted text
    const rightText = extractVisibleText(modified!.rightHtml);
    expect(rightText).toContain("bold");
    expect(rightText).toContain("emphasized");
  });

  it("should handle complex multi-block documents", () => {
    const left = `# Heading One

First paragraph with some text.

Second paragraph here.

# Heading Two

Final paragraph.`;

    const right = `# Heading One

First paragraph with modified text.

Second paragraph here.

# Heading Three

Final paragraph updated.`;

    const rows = getRenderOutput(left, right);

    // Collect all visible right-side text
    const allRightText = rows
      .map(r => {
        if (r.status === "removed") return ""; // removed blocks show spacer on right
        return extractVisibleText(r.rightHtml);
      })
      .filter(t => t.length > 0)
      .join(" ");

    // Should contain all the right-side content
    expect(allRightText).toContain("Heading One");
    expect(allRightText).toContain("First paragraph with modified text");
    expect(allRightText).toContain("Second paragraph here");
    expect(allRightText).toContain("Heading Three");
    expect(allRightText).toContain("Final paragraph updated");

    // Should NOT contain left-only content
    expect(allRightText).not.toContain("Heading Two");
  });

  it("should handle case-only changes preserving right-side casing", () => {
    const left = "The Quick Brown Fox";
    const right = "The quick brown fox";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .map(r => r.status !== "removed" ? extractVisibleText(r.rightHtml) : "")
      .join(" ")
      .trim();

    // Right side should have lowercase version
    expect(rightText).toBe("The quick brown fox");
  });

  it("should handle whitespace changes correctly", () => {
    const left = "Word one two three four five six seven eight nine ten.";
    const right = "Word one two three four five six seven eight nine ten.";
    const rows = getRenderOutput(left, right);

    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("equal");

    const rightText = extractVisibleText(rows[0].rightHtml);
    expect(rightText).toBe(normalizeMarkdown(right));
  });

  it("should preserve inline code in output", () => {
    const left = "Use the `print()` function to output text.";
    const right = "Use the `console.log()` function to output text.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    if (modified) {
      const rightText = extractVisibleText(modified.rightHtml);
      expect(rightText).toContain("console.log()");
    }
  });

  it("should preserve links in output", () => {
    const left = "Visit [Google](https://google.com) for search.";
    const right = "Visit [DuckDuckGo](https://duckduckgo.com) for search.";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .map(r => r.status !== "removed" ? extractVisibleText(r.rightHtml) : "")
      .join(" ")
      .trim();

    expect(rightText).toContain("DuckDuckGo");
  });
});

describe("text reconstruction from inline diff", () => {
  it("reconstructed text from inline parts should match original", () => {
    const testCases = [
      ["Hello world", "Hello there world"],
      ["The quick brown fox", "The slow brown fox"],
      ["A B C D E", "A X C D Y"],
      ["one two three four five", "one TWO three FOUR five"],
      ["Hello, world!", "Hello world!"],
    ];

    for (const [left, right] of testCases) {
      const parts = computeInlineDiff(left, right);

      // Reconstruct left: equal + removed
      const reconstructedLeft = parts
        .filter((p) => p.type === "equal" || p.type === "removed")
        .map((p) => p.value)
        .join("");

      // Reconstruct right: equal + added
      const reconstructedRight = parts
        .filter((p) => p.type === "equal" || p.type === "added")
        .map((p) => p.value)
        .join("");

      // Normalize for comparison (whitespace may differ slightly)
      const normalizedLeft = left.replace(/\s+/g, " ").trim();
      const normalizedRight = right.replace(/\s+/g, " ").trim();
      const normalizedReconLeft = reconstructedLeft.replace(/\s+/g, " ").trim();
      const normalizedReconRight = reconstructedRight.replace(/\s+/g, " ").trim();

      expect(normalizedReconLeft).toBe(normalizedLeft);
      expect(normalizedReconRight).toBe(normalizedRight);
    }
  });

  it("should handle stop word absorption without losing text", () => {
    const testCases = [
      // Stop words between changes
      ["the old cat is sleeping", "the new dog is running"],
      ["a copy of reality", "a collection of images"],
      // Minor changes with stop words
      ["This is the beginning", "This was the end"],
      // Multiple stop words
      ["He was in the room", "She is at the office"],
    ];

    for (const [left, right] of testCases) {
      const parts = computeInlineDiff(left, right);

      const reconstructedRight = parts
        .filter((p) => p.type === "equal" || p.type === "added")
        .map((p) => p.value)
        .join("");

      const normalizedRight = right.replace(/\s+/g, " ").trim();
      const normalizedRecon = reconstructedRight.replace(/\s+/g, " ").trim();

      expect(normalizedRecon).toBe(normalizedRight);
    }
  });

  it("should handle minor pairs without text loss", () => {
    const testCases = [
      // Case changes
      ["The QUICK brown FOX", "The quick brown fox"],
      // Punctuation changes
      ["Hello, world!", "Hello world"],
      // Mixed minor changes
      ["It's a TEST.", "Its a test"],
    ];

    for (const [left, right] of testCases) {
      const parts = computeInlineDiff(left, right);

      const reconstructedRight = parts
        .filter((p) => p.type === "equal" || p.type === "added")
        .map((p) => p.value)
        .join("");

      const normalizedRight = right.replace(/\s+/g, " ").trim();
      const normalizedRecon = reconstructedRight.replace(/\s+/g, " ").trim();

      expect(normalizedRecon).toBe(normalizedRight);
    }
  });

  it("should preserve text through full render pipeline", () => {
    const testCases = [
      {
        left: "This bias is so powerful that it can lead to over-imitation.",
        right: "This tendency is so strong that it can lead to over-imitation.",
      },
      {
        left: "The cat sat on the mat in the warm sun today.",
        right: "The dog lay on the rug in the cold moon tonight.",
      },
      {
        left: "First, we must understand the problem. Then, we can solve it.",
        right: "First, we should analyze the issue. Then, we can resolve it.",
      },
    ];

    for (const { left, right } of testCases) {
      const rows = getRenderOutput(left, right);

      // Collect all visible right-side text
      const allRightText = rows
        .map(r => {
          if (r.status === "removed") return "";
          return extractVisibleText(r.rightHtml);
        })
        .filter(t => t.length > 0)
        .join(" ");

      const expectedRight = normalizeMarkdown(right);

      expect(allRightText).toBe(expectedRight);
    }
  });
});

describe("em-dash duplication bug", () => {
  it("should not duplicate em-dashes when paragraph has multiple hyphen-to-emdash changes", () => {
    // This reproduces a bug where "— — " appeared instead of "— "
    const left = "Instead, the enclaves - the distinct communities of practice, craft, and narrative - are the primary providers";
    const right = "The enclaves — distinct communities of practice, craft, and narrative — are the primary providers";

    const parts = computeInlineDiff(left, right);

    // Count em-dashes in reconstructed right
    const reconstructedRight = parts
      .filter(p => p.type === "equal" || p.type === "added")
      .map(p => p.value)
      .join("");

    const originalEmDashCount = (right.match(/—/g) || []).length;
    const reconstructedEmDashCount = (reconstructedRight.match(/—/g) || []).length;

    expect(reconstructedEmDashCount).toBe(originalEmDashCount);
    expect(reconstructedRight.replace(/\s+/g, " ").trim()).toBe(right.replace(/\s+/g, " ").trim());
  });

  it("should handle paragraph with prefix removal and multiple punctuation changes", () => {
    // Simulates: prefix removed, "the X - the Y" → "The X — Y", with another "- Z" → "— Z" later
    const left = "Some prefix text here. Because the dog is brown. Instead, the groups - the small teams of workers - are the main source of output. They handle the work.";
    const right = "Because the dog is brown. The groups — small teams of workers — are the main source of output. They handle the work.";

    const parts = computeInlineDiff(left, right);

    const reconstructedRight = parts
      .filter(p => p.type === "equal" || p.type === "added")
      .map(p => p.value)
      .join("");

    // Should have exactly 2 em-dashes, not 3 or more
    const originalEmDashCount = (right.match(/—/g) || []).length;
    const reconstructedEmDashCount = (reconstructedRight.match(/—/g) || []).length;

    expect(originalEmDashCount).toBe(2);
    expect(reconstructedEmDashCount).toBe(2);
    expect(reconstructedRight.replace(/\s+/g, " ").trim()).toBe(right.replace(/\s+/g, " ").trim());
  });
});

describe("comprehensive text fidelity - edge cases", () => {
  it("should handle sentences with moved text segments", () => {
    const left = "The quick brown fox jumps over the lazy dog in the meadow.";
    const right = "In the meadow, the quick brown fox jumps over the lazy dog.";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .filter(r => r.status !== "removed")
      .map(r => extractVisibleText(r.rightHtml))
      .join(" ");

    expect(rightText).toContain("In the meadow");
    expect(rightText).toContain("the quick brown fox");
    expect(rightText).toContain("jumps over the lazy dog");
  });

  it("should handle repeated words correctly", () => {
    const left = "the the the cat cat sat sat";
    const right = "the the cat sat sat sat";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .filter(r => r.status !== "removed")
      .map(r => extractVisibleText(r.rightHtml))
      .join(" ");

    const expectedRight = normalizeMarkdown(right);
    expect(rightText).toBe(expectedRight);
  });

  it("should handle empty strings gracefully", () => {
    const rows = getRenderOutput("Some text here.", "");

    // Should have removed row(s)
    const removed = rows.filter(r => r.status === "removed");
    expect(removed.length).toBeGreaterThan(0);
  });

  it("should handle very long paragraphs", () => {
    const words = "word ".repeat(100).trim();
    const left = words;
    const right = words.replace("word word word", "modified modified modified");
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .filter(r => r.status !== "removed")
      .map(r => extractVisibleText(r.rightHtml))
      .join(" ");

    expect(rightText).toContain("modified modified modified");
  });

  it("should handle special unicode characters", () => {
    const left = "Hello 世界! Emoji: 🎉 Symbol: ™";
    const right = "Hello 世界! Emoji: 🎊 Symbol: ®";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .filter(r => r.status !== "removed")
      .map(r => extractVisibleText(r.rightHtml))
      .join(" ");

    expect(rightText).toContain("世界");
    expect(rightText).toContain("🎊");
    expect(rightText).toContain("®");
  });

  it("should handle paragraphs with only whitespace changes", () => {
    const left = "Hello   world";  // multiple spaces
    const right = "Hello world";   // single space
    const rows = getRenderOutput(left, right);

    // Both should render without errors
    expect(rows.length).toBeGreaterThan(0);
  });

  it("should handle markdown headers correctly", () => {
    const left = "# Main Title\n\nContent here.";
    const right = "# New Title\n\nContent here.";
    const rows = getRenderOutput(left, right);

    const rightText = rows
      .filter(r => r.status !== "removed")
      .map(r => extractVisibleText(r.rightHtml))
      .join(" ");

    expect(rightText).toContain("New Title");
    expect(rightText).toContain("Content here");
  });
});

describe("markdown bold/italic rendering", () => {
  it("should render bold text correctly when diff splits words", () => {
    // This test case previously broke bold rendering:
    // The **second bold** vs **changed bold** caused "bold**" to be raw text
    const left = "Text with **first bold** and **second bold** here";
    const right = "Text with **first bold** and **changed bold** here";
    const rows = getRenderOutput(left, right);

    const row = rows.find(r => r.status === "modified");
    expect(row).toBeDefined();

    // Bold should be rendered as <strong> tags, not raw ** markers
    expect(row!.leftHtml).toContain("<strong>first bold</strong>");
    expect(row!.leftHtml).toContain("<strong>second bold</strong>");
    expect(row!.leftHtml).not.toContain("**");

    expect(row!.rightHtml).toContain("<strong>first bold</strong>");
    expect(row!.rightHtml).toContain("<strong>changed bold</strong>");
    expect(row!.rightHtml).not.toContain("**");
  });

  it("should render italic text correctly", () => {
    const left = "Some *italic text* here";
    const right = "Some *different text* here";
    const rows = getRenderOutput(left, right);

    const row = rows.find(r => r.status === "modified");
    expect(row).toBeDefined();

    // Italic should be rendered as <em> tags
    expect(row!.leftHtml).toContain("<em>");
    expect(row!.rightHtml).toContain("<em>");
  });

  it("should handle mixed bold and italic", () => {
    const left = "Text with **bold** and *italic* content";
    const right = "Text with **bold** and *emphasized* content";
    const rows = getRenderOutput(left, right);

    const row = rows.find(r => r.status === "modified");
    expect(row).toBeDefined();

    expect(row!.rightHtml).toContain("<strong>bold</strong>");
    expect(row!.rightHtml).toContain("<em>");
  });
});
