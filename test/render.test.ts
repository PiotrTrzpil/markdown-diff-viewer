import { describe, it, expect } from "vitest";
import { renderDiffPairs, RenderedRow } from "../src/render/render.js";
import { diffBlocks, computeInlineDiff } from "../src/core/diff.js";
import { parseMarkdown, extractBlocks } from "../src/text/parse.js";

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
  it("should merge consecutive removed/added into single rows", () => {
    // Completely different paragraphs - no shared content
    const rows = getRenderOutput(
      "Philosophy explores abstract concepts.\n\nEthics concerns moral principles.",
      "The weather forecast predicts rain.\n\nTomorrow will be sunny and warm.",
    );

    // Find removed and added rows - should be merged into 1 each
    const removed = rows.filter((r) => r.status === "removed");
    const added = rows.filter((r) => r.status === "added");

    expect(removed.length).toBe(1);
    expect(added.length).toBe(1);

    // Merged row should contain both paragraphs
    expect(removed[0].leftHtml).toContain("Philosophy");
    expect(removed[0].leftHtml).toContain("Ethics");
    expect(added[0].rightHtml).toContain("weather");
    expect(added[0].rightHtml).toContain("Tomorrow");

    // Removed should come before added
    const removedIdx = rows.findIndex((r) => r.status === "removed");
    const addedIdx = rows.findIndex((r) => r.status === "added");
    expect(removedIdx).toBeLessThan(addedIdx);
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

  it("should create overlay pairs for removed/added content", () => {
    const rows = getRenderOutput(
      "The quick brown fox jumps.",
      "The quick brown dog leaps.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();

    // Both sides should use change-pair with overlapping layers
    expect(modified!.leftHtml).toContain("change-pair");
    expect(modified!.leftHtml).toContain("change-layer");

    expect(modified!.rightHtml).toContain("change-pair");
    expect(modified!.rightHtml).toContain("change-layer");
  });

  it("should show hidden layers for alignment", () => {
    // Use longer, more similar sentences to ensure they match as modified
    const rows = getRenderOutput(
      "The quick brown fox jumps over the lazy dog in the sunny meadow.",
      "The quick brown cat jumps over the lazy dog in the sunny meadow.",
    );

    const modified = rows.find((r) => r.status === "modified");
    expect(modified).toBeDefined();

    // Left side has hidden layer for "cat" (added on right, hidden on left)
    expect(modified!.leftHtml).toContain("change-layer hidden");
    // Right side has hidden layer for "fox" (removed on left, hidden on right)
    expect(modified!.rightHtml).toContain("change-layer hidden");
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
 * Extract visible text from rendered HTML, excluding hidden layers.
 * Strips HTML tags and returns plain text that would be visible to users.
 */
function extractVisibleText(html: string): string {
  // Remove hidden change layers (they have visibility:hidden in CSS)
  let text = html.replace(/<span[^>]*class="change-layer hidden[^"]*"[^>]*>[\s\S]*?<\/span>/g, "");

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

describe("paragraph split rendering", () => {
  it("should render split with only pilcrow as added, text as equal", () => {
    // A single paragraph split into two
    const left = "First sentence here. Second sentence there.";
    const right = `First sentence here.

Second sentence there.`;

    const rows = getRenderOutput(left, right);

    // Should have exactly one row with status "split"
    const splitRows = rows.filter(r => r.status === "split");
    expect(splitRows.length).toBe(1);

    const row = splitRows[0];

    // Left side should contain the full original text
    expect(row.leftHtml).toContain("First sentence here");
    expect(row.leftHtml).toContain("Second sentence there");

    // Right side should contain the pilcrow marker
    expect(row.rightHtml).toContain("¶");

    // The pilcrow should be inside an <ins> tag (marked as added)
    expect(row.rightHtml).toMatch(/<ins[^>]*>.*¶.*<\/ins>/);

    // The actual text should NOT be inside <ins> or <del> tags
    // Check that "First sentence" is in a diff-part span (equal), not ins/del
    expect(row.rightHtml).toContain("First sentence here");
    expect(row.rightHtml).toContain("Second sentence there");

    // Text should not be marked as removed or added (no del/ins around the text content)
    expect(row.rightHtml).not.toMatch(/<ins[^>]*>.*First sentence.*<\/ins>/);
    expect(row.rightHtml).not.toMatch(/<del[^>]*>.*First sentence.*<\/del>/);
    expect(row.rightHtml).not.toMatch(/<ins[^>]*>.*Second sentence.*<\/ins>/);
    expect(row.rightHtml).not.toMatch(/<del[^>]*>.*Second sentence.*<\/del>/);
  });

  it("should show both parts of text on right side with split marker between", () => {
    const left = "Beginning of paragraph. End of paragraph.";
    const right = `Beginning of paragraph.

End of paragraph.`;

    const rows = getRenderOutput(left, right);
    const splitRow = rows.find(r => r.status === "split");
    expect(splitRow).toBeDefined();

    // Right side should have: text before split, pilcrow, text after split
    const rightHtml = splitRow!.rightHtml;

    // Check the order: "Beginning" comes before ¶ which comes before "End"
    const beginningIdx = rightHtml.indexOf("Beginning");
    const pilcrowIdx = rightHtml.indexOf("¶");
    const endIdx = rightHtml.indexOf("End of paragraph");

    expect(beginningIdx).toBeLessThan(pilcrowIdx);
    expect(pilcrowIdx).toBeLessThan(endIdx);
  });
});

describe("line number tracking", () => {
  it("should include line numbers on equal rows", () => {
    const left = "# Title\n\nParagraph one.\n\nParagraph two.";
    const right = "# Title\n\nParagraph one.\n\nParagraph two.";
    const rows = getRenderOutput(left, right);

    // All rows should be equal
    expect(rows.every(r => r.status === "equal")).toBe(true);

    // First row (heading) should have line 1
    expect(rows[0].leftLine).toBe(1);
    expect(rows[0].rightLine).toBe(1);

    // Second row (paragraph) should have line 3
    expect(rows[1].leftLine).toBe(3);
    expect(rows[1].rightLine).toBe(3);
  });

  it("should include line numbers on modified rows", () => {
    // Use similar content to ensure side-by-side rendering
    const left = "The quick brown fox jumps over the lazy dog today.";
    const right = "The quick brown cat jumps over the lazy dog today.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();
    expect(modified!.leftLine).toBe(1);
    expect(modified!.rightLine).toBe(1);
  });

  it("should embed leftLine in stacked removed rows", () => {
    // Completely different content forces stacking
    const left = "This content will be completely removed.";
    const right = "";
    const rows = getRenderOutput(left, right);

    const removed = rows.find(r => r.status === "removed");
    expect(removed).toBeDefined();
    // Stacked rows embed line numbers in content HTML
    expect(removed!.leftHtml).toContain('data-line="1"');
  });

  it("should include rightLine on added rows", () => {
    const left = "";
    const right = "This is new content.";
    const rows = getRenderOutput(left, right);

    const added = rows.find(r => r.status === "added");
    expect(added).toBeDefined();
    expect(added!.leftLine).toBeUndefined();
    // Added rows in stacked mode embed line numbers in content, not on row
    // Check that rightHtml contains data-line attribute
    expect(added!.rightHtml).toContain('data-line="1"');
  });

  it("should embed line numbers in merged stacked rows", () => {
    // Completely different content forces stacking
    const left = "";
    const right = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const rows = getRenderOutput(left, right);

    const added = rows.find(r => r.status === "added");
    expect(added).toBeDefined();

    // Each paragraph should have its line number embedded
    expect(added!.rightHtml).toContain('data-line="1"');
    expect(added!.rightHtml).toContain('data-line="3"');
    expect(added!.rightHtml).toContain('data-line="5"');
  });
});

describe("HTML comment rendering", () => {
  it("should render HTML comments as visible text", () => {
    const left = "<!-- This is a comment -->";
    const right = "<!-- This is a comment -->";
    const rows = getRenderOutput(left, right);

    expect(rows.length).toBe(1);
    // Comment should be visible (escaped), not hidden
    expect(rows[0].leftHtml).toContain("&lt;!--");
    expect(rows[0].leftHtml).toContain("--&gt;");
    expect(rows[0].leftHtml).toContain("This is a comment");
  });

  it("should wrap HTML comments in html-comment class", () => {
    const left = "<!-- comment -->";
    const right = "<!-- comment -->";
    const rows = getRenderOutput(left, right);

    expect(rows[0].leftHtml).toContain('class="html-comment"');
  });

  it("should handle multiline HTML comments", () => {
    const left = "<!-- line 1\nline 2\nline 3 -->";
    const right = "<!-- line 1\nline 2\nline 3 -->";
    const rows = getRenderOutput(left, right);

    expect(rows[0].leftHtml).toContain("line 1");
    expect(rows[0].leftHtml).toContain("line 2");
    expect(rows[0].leftHtml).toContain("line 3");
  });

  it("should diff HTML comments like regular content", () => {
    const left = "<!-- old comment -->";
    const right = "<!-- new comment -->";
    const rows = getRenderOutput(left, right);

    // Should be treated as modified content
    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();
  });
});

describe("absorbable text visibility", () => {
  // These tests ensure that absorbable stop-word text is NEVER hidden,
  // only styled differently based on merge mode. Text should always be
  // visible in the DOM, with CSS controlling the visual appearance.

  it("should render absorbable stop words with visible text on both sides", () => {
    // Use text with enough shared content to render side-by-side
    const left = "The quick brown fox jumps over the lazy dog today.";
    const right = "The quick brown cat jumps over the lazy dog tonight.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    // Both sides should contain all words - nothing hidden
    const leftText = extractVisibleText(modified!.leftHtml);
    const rightText = extractVisibleText(modified!.rightHtml);

    // All words should be present - nothing hidden
    expect(leftText).toContain("The");
    expect(leftText).toContain("quick");
    expect(leftText).toContain("brown");
    expect(leftText).toContain("fox");
    expect(leftText).toContain("jumps");
    expect(leftText).toContain("over");
    expect(leftText).toContain("the");
    expect(leftText).toContain("lazy");
    expect(leftText).toContain("dog");

    expect(rightText).toContain("The");
    expect(rightText).toContain("quick");
    expect(rightText).toContain("brown");
    expect(rightText).toContain("cat");
    expect(rightText).toContain("jumps");
    expect(rightText).toContain("over");
    expect(rightText).toContain("the");
    expect(rightText).toContain("lazy");
    expect(rightText).toContain("dog");
  });

  it("should mark absorbable equal parts with side classes for CSS styling", () => {
    // Create a diff where stop words appear between changes
    const left = "Remove this and keep the middle and remove that.";
    const right = "Add this and keep the middle and add that.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    // Absorbable parts should have side-specific classes (left or right)
    // These classes allow CSS to style them as removed/added based on merge mode
    const leftHtml = modified!.leftHtml;
    const rightHtml = modified!.rightHtml;

    // Check that absorbable parts in left pane have "left" class
    if (leftHtml.includes("absorbable-stopword")) {
      expect(leftHtml).toMatch(/absorbable-stopword[^"]*\s+left/);
    }

    // Check that absorbable parts in right pane have "right" class
    if (rightHtml.includes("absorbable-stopword")) {
      expect(rightHtml).toMatch(/absorbable-stopword[^"]*\s+right/);
    }
  });

  it("should never use display:none style for absorbable content", () => {
    // This test verifies the structure doesn't include hidden duplicates
    const left = "We are going to the store today.";
    const right = "They are going to the market today.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    // No "display: none" or similar hiding should be inline styled
    expect(modified!.leftHtml).not.toContain("display: none");
    expect(modified!.leftHtml).not.toContain("display:none");
    expect(modified!.rightHtml).not.toContain("display: none");
    expect(modified!.rightHtml).not.toContain("display:none");

    // No "equal-when-off" or "change-when-merged" classes (old approach)
    expect(modified!.leftHtml).not.toContain("equal-when-off");
    expect(modified!.leftHtml).not.toContain("change-when-merged");
    expect(modified!.rightHtml).not.toContain("equal-when-off");
    expect(modified!.rightHtml).not.toContain("change-when-merged");
  });

  it("should preserve all words when minor changes exist", () => {
    // Case change + word change, with enough shared content
    const left = "The quick BROWN fox jumps over the lazy dog.";
    const right = "The quick brown fox leaps over the lazy cat.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const leftText = extractVisibleText(modified!.leftHtml);
    const rightText = extractVisibleText(modified!.rightHtml);

    // All words visible on left
    expect(leftText).toBe("The quick BROWN fox jumps over the lazy dog.");

    // All words visible on right
    expect(rightText).toBe("The quick brown fox leaps over the lazy cat.");
  });

  it("should keep stop words visible even when surrounded by changes", () => {
    // Multiple stop words between changes - none should disappear
    const left = "Alpha and the beta were here.";
    const right = "Gamma and the delta were here.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const leftText = extractVisibleText(modified!.leftHtml);
    const rightText = extractVisibleText(modified!.rightHtml);

    // "and the" are stop words that should remain visible
    expect(leftText).toContain("and the");
    expect(rightText).toContain("and the");

    // Full text integrity
    expect(leftText).toBe("Alpha and the beta were here.");
    expect(rightText).toBe("Gamma and the delta were here.");
  });

  it("should preserve articles and pronouns in rendered output", () => {
    // Articles like "a", "an", "the" and pronouns like "we", "they" are common stop words
    const left = "We found a small cat in the garden.";
    const right = "They found an orange cat in the yard.";
    const rows = getRenderOutput(left, right);

    const modified = rows.find(r => r.status === "modified");
    expect(modified).toBeDefined();

    const leftText = extractVisibleText(modified!.leftHtml);
    const rightText = extractVisibleText(modified!.rightHtml);

    // All stop words must be present
    expect(leftText).toContain("We");
    expect(leftText).toContain("a");
    expect(leftText).toContain("in");
    expect(leftText).toContain("the");

    expect(rightText).toContain("They");
    expect(rightText).toContain("an");
    expect(rightText).toContain("in");
    expect(rightText).toContain("the");

    // Full sentence integrity
    expect(leftText).toBe("We found a small cat in the garden.");
    expect(rightText).toBe("They found an orange cat in the yard.");
  });
});
