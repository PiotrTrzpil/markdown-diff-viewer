import { describe, expect, it } from "vitest";
import {
  inspectDocument,
  mashOpening,
  parseArgs,
  sidesFromParts,
  unprotect,
} from "../scripts/check-corpus.mjs";
import { diffMarkdown } from "../src/api.js";

describe("check-corpus helpers", () => {
  it("flags a long rem-then-add opening as a mash", () => {
    const mash = mashOpening([
      { type: "removed", value: "Graham's description, Cantrill's call for a mechanism, extra words here." },
      { type: "added", value: "At Apple, Jobs was doing what these earlier masters did in the firm." },
    ]);
    expect(mash).toContain("Graham's description");
    expect(mash).toContain("At Apple, Jobs");
  });

  it("does not flag a short punctuation swap as a mash", () => {
    expect(mashOpening([{ type: "removed", value: "cat" }, { type: "added", value: "dog" }])).toBeNull();
  });

  it("does not treat a rewritten alt on the same image as a mash", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: {
            markdown:
              "![The perception-economy diagram. The producer curve on the seller side; the buyer curve on the buyer side. The viable depth market is the overlap of the two upper tails.](../../notes/economics/figures/fig-1-base-diagram.png)",
            kind: "paragraph",
            wrapTag: "p",
          },
          right: {
            markdown:
              "![Producer and buyer capacity along perceptual depth. Where the two upper tails overlap, deep work can actually sell.](../../notes/economics/figures/fig-1-base-diagram.png)",
            kind: "paragraph",
            wrapTag: "p",
          },
          inline: [
            { type: "removed", value: "![The perception-economy diagram. The producer curve on the seller side; " },
            { type: "added", value: "![Producer and buyer capacity along perceptual depth. Where " },
            { type: "equal", value: "the two upper tails" },
          ],
          metrics: { sharedWords: 5, totalWords: 41 },
        },
      ],
    });
    expect(findings.filter((f) => f.kind === "mash")).toEqual([]);
  });

  it("reconstructs sides from a flat stream", () => {
    const { left, right } = sidesFromParts([
      { type: "equal", value: "The " },
      { type: "removed", value: "cat" },
      { type: "added", value: "dog" },
      { type: "equal", value: " sat." },
    ]);
    expect(left).toBe("The cat sat.");
    expect(right).toBe("The dog sat.");
  });

  it("reconstructs sides from the old nested children shape", () => {
    const { left, right } = sidesFromParts([
      { type: "equal", value: "The " },
      {
        type: "removed",
        value: "cat",
        children: [{ type: "removed", value: "cat" }],
      },
      {
        type: "added",
        value: "dog",
        children: [{ type: "added", value: "dog" }],
      },
      { type: "equal", value: " sat." },
    ]);
    expect(left).toBe("The cat sat.");
    expect(right).toBe("The dog sat.");
  });

  it("restores protect-markdown markers before comparing text", () => {
    expect(unprotect("a\x00b")).toBe("a b");
    expect(unprotect("\x02bold\x03")).toBe("**bold**");
    expect(unprotect("\x04it\x05")).toBe("*it*");
  });

  it("accepts --git repo rev glob as positional args after the repo", () => {
    const args = parseArgs(["--git", "/repo", "HEAD~1", "src/guilds/chapters"]);
    expect(args.git).toBe("/repo");
    expect(args.rev).toBe("HEAD~1");
    expect(args.glob).toBe("src/guilds/chapters");
  });

  it("parses --merge-base and --to-worktree", () => {
    const args = parseArgs(["--git", "/repo", "--merge-base", "main", "--to-worktree", "src/guilds/chapters"]);
    expect(args.mergeBase).toBe("main");
    expect(args.toWorktree).toBe(true);
    expect(args.glob).toBe("src/guilds/chapters");
  });
});

describe("check-corpus quality rules", () => {
  it("flags mashed unlike openings on a low-ratio modified block", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: {
            markdown:
              "Graham's description, Cantrill's call for a mechanism, and the warnings in the failure cases.",
            kind: "paragraph",
            wrapTag: "p",
          },
          right: {
            markdown: "At Apple, Jobs was doing what these earlier masters did in the firm and the product.",
            kind: "paragraph",
            wrapTag: "p",
          },
          inline: [
            {
              type: "removed",
              value:
                "Graham's description, Cantrill's call for a mechanism, and the warnings in the failure cases.",
            },
            {
              type: "added",
              value: "At Apple, Jobs was doing what these earlier masters did in the firm and the product.",
            },
          ],
          metrics: { sharedWords: 2, totalWords: 20 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toContain("mash");
  });

  it("flags an HTML comment zipped onto prose", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "<!-- verify:ignore llm-tell -->", kind: "html", wrapTag: "div" },
          right: {
            markdown: "That is a problem of institutions rather than of a founder's presence.",
            kind: "paragraph",
            wrapTag: "p",
          },
          inline: [
            { type: "removed", value: "<!-- verify:ignore llm-tell -->" },
            { type: "added", value: "That is a problem of institutions rather than of a founder's presence." },
          ],
          metrics: { sharedWords: 0, totalWords: 4 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toContain("html-comment-zip");
  });

  it("flags two different cite keys zipped into one modified block", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "[cite:alpha] First bibliography line with extra words.", kind: "paragraph", wrapTag: "p" },
          right: { markdown: "[cite:beta] Second bibliography line with extra words.", kind: "paragraph", wrapTag: "p" },
          inline: [
            { type: "removed", value: "[cite:alpha] First bibliography line with extra words." },
            { type: "added", value: "[cite:beta] Second bibliography line with extra words." },
          ],
          metrics: { sharedWords: 3, totalWords: 8 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toContain("cite-zip");
  });

  it("flags protect markers that never pair on a reconstructed side", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "hello world extra words here", kind: "paragraph", wrapTag: "p" },
          right: { markdown: "hello there extra words here", kind: "paragraph", wrapTag: "p" },
          inline: [
            { type: "equal", value: "hello " },
            { type: "removed", value: "\x02world extra" },
            { type: "added", value: "there extra\x03" },
            { type: "equal", value: " words here" },
          ],
          metrics: { sharedWords: 4, totalWords: 5 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toContain("protect-leak");
  });

  it("does not flag intact protect spans that unprotect restores", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "a **trust spectrum** here", kind: "paragraph", wrapTag: "p" },
          right: { markdown: "a **trust spectrum** here", kind: "paragraph", wrapTag: "p" },
          inline: [{ type: "equal", value: "a \x02trust\x00spectrum\x03 here" }],
          metrics: { sharedWords: 4, totalWords: 4 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toEqual([]);
  });

  it("flags reconstructed sides that drop source text", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "The guild is a self-governing community of practitioners.", kind: "paragraph", wrapTag: "p" },
          right: { markdown: "The guild is a self-governing community of practitioners.", kind: "paragraph", wrapTag: "p" },
          inline: [
            { type: "equal", value: "The guild is a " },
            { type: "removed", value: "self-governing " },
            { type: "equal", value: "community of practitioners." },
          ],
          metrics: { sharedWords: 7, totalWords: 8 },
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toContain("inline-misses-right");
  });

  it("does not treat fenced code as an inline-miss just because fences are stripped", () => {
    const findings = inspectDocument({
      blocks: [
        {
          status: "modified",
          left: { markdown: "```js\nconst x = 1;\n```", kind: "code", wrapTag: "pre" },
          right: { markdown: "```js\nconst x = 2;\n```", kind: "code", wrapTag: "pre" },
          inline: [
            { type: "equal", value: "const x = " },
            { type: "removed", value: "1" },
            { type: "added", value: "2" },
            { type: "equal", value: ";" },
          ],
          metrics: { sharedWords: 3, totalWords: 4 },
        },
      ],
    });
    expect(findings.filter((f) => f.kind.startsWith("inline-misses"))).toEqual([]);
  });

  it("does not drop the space when a sentence is appended to a paragraph", () => {
    const result = diffMarkdown(
      "Creates a new user.",
      "Creates a new user. Requires admin role.",
      { matchLevel: "normal" },
    );
    expect(inspectDocument(result.document).filter((f) => f.kind.startsWith("inline-misses"))).toEqual([]);
  });

  it("does not zip Graham/Apple as a mashed modified block at inline", () => {
    const left = `Stay put opening paragraph with enough words here.

Graham's description, Cantrill's call for a mechanism, and the warnings in the failure cases are pieces of that older arrangement: the guild. A guild is a self-governing community of practitioners that sets its own standards of quality, controls entry through demonstrated mastery, and transmits its knowledge across generations through formation rather than instruction.

Stay put closing paragraph with enough words here.`;
    const right = `Stay put opening paragraph with enough words here.

At Apple, Jobs was doing what these earlier masters did: insisting that the person who can see the work most deeply should govern it, overriding the organizational logic that said otherwise. Frederick Brooks, writing about large software systems, called the same requirement conceptual integrity: a product that reflects one set of design ideas, even if it leaves some good ideas out, rather than many good ideas that do not cohere. That integrity, he argued, requires the design to proceed from one mind, or from a very small number of people who already share a judgment. Wherever that depth has been sustained across time, the same structure appears around that judgment: practitioners who set their own standard of quality, controlled entry by demonstrated mastery, and transmitted what they knew by keeping the next generation in the work long enough for the standard to live in them.

Stay put closing paragraph with enough words here.`;
    const result = diffMarkdown(left, right, { matchLevel: "inline" });
    const findings = inspectDocument(result.document);
    expect(findings.filter((f) => f.kind === "mash")).toEqual([]);
    expect(result.document.blocks.some((b) => b.status === "removed")).toBe(true);
    expect(result.document.blocks.some((b) => b.status === "added")).toBe(true);
  });
});
