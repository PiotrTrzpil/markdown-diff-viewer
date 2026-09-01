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

  it("does not glue a deleted paragraph onto an unrelated neighbor that shares a short tail", () => {
    const left = `Opening stays put with enough words here.

Graham's description, Cantrill's call for a mechanism, and the warnings in the failure cases are pieces of that older arrangement: the guild. A guild is a self-governing community of practitioners that sets its own standards of quality, controls entry through demonstrated mastery, and transmits its knowledge across generations through formation rather than instruction.

Closing stays put with enough words here.`;
    const right = `Opening stays put with enough words here.

At Apple, Jobs was doing what these earlier masters did: insisting that the person who can see the work most deeply should govern it, overriding the organizational logic that said otherwise. Frederick Brooks, writing about large software systems, called the same requirement conceptual integrity: a product that reflects one set of design ideas, even if it leaves some good ideas out, rather than many good ideas that do not cohere. Wherever that depth has been sustained across time, the same structure appears around that judgment: practitioners who set their own standard of quality, controlled entry by demonstrated mastery, and transmitted what they knew by keeping the next generation in the work long enough for the standard to live in them.

Closing stays put with enough words here.`;
    const inline = diffMarkdown(left, right, { matchLevel: "inline" });
    const graham = inline.document.blocks.find((b) =>
      (b.status === "removed" ? b.left.markdown : b.status === "modified" ? b.left.markdown : "").includes(
        "Graham's description",
      ),
    );
    expect(graham?.status).toBe("removed");
    const apple = inline.document.blocks.find((b) =>
      (b.status === "added" ? b.right.markdown : b.status === "modified" ? b.right.markdown : "").includes(
        "At Apple, Jobs",
      ),
    );
    expect(apple?.status).toBe("added");
  });

  it("does not leftover-zip two long unlike paragraphs of similar length", () => {
    const left = `Stay put opening paragraph with enough words here.

What does it look like when these two logics diverge? The divergence takes recurring shapes. Here are three of them, drawn from industries where practitioners care about excellence and firms spend heavily to cultivate it.

Stay put closing paragraph with enough words here.`;
    const right = `Stay put opening paragraph with enough words here.

Practitioners in industries where firms spend heavily on craft can already see the work at the grain that matters. The institution has no way to let that seeing govern once excellence and revenue point in different directions.

Stay put closing paragraph with enough words here.`;
    const inline = diffMarkdown(left, right, { matchLevel: "inline" });
    expect(
      inline.document.blocks.some(
        (b) => b.status === "removed" && b.left.markdown.includes("What does it look like"),
      ),
    ).toBe(true);
    expect(
      inline.document.blocks.some(
        (b) => b.status === "added" && b.right.markdown.includes("Practitioners in industries"),
      ),
    ).toBe(true);
  });

  it("does not pair a list with a paragraph that only shares one extracted sentence", () => {
    const sentence =
      "The academic art historian who knows which living painters matter and the hedge-fund collector who could buy them";
    const left = `Stay put opening paragraph with enough words here.

- **Patronage class dissolution.** The wealth that historically anchored the agency set has concentrated in people whose formation was in other domains entirely. ${sentence} live in different economies and conversations. Cultural capital and economic capital rest in different hands, and this list item continues with enough extra words about advisors, brands, prestige indices, investment logic, and purchases that do not track personal perception of the work itself.

Stay put closing paragraph with enough words here.`;
    const right = `Stay put opening paragraph with enough words here.

At population scale the same split runs as stratified capital. ${sentence} live in different economies and conversations.

Stay put closing paragraph with enough words here.`;
    const result = diffMarkdown(left, right, { matchLevel: "loose" });
    const mashed = result.document.blocks.find(
      (b) =>
        b.status === "modified" &&
        b.left.kind === "list" &&
        b.right.kind === "paragraph",
    );
    expect(mashed).toBeUndefined();
  });

  it("does not zip an HTML comment leftover onto the next prose paragraph", () => {
    const left = `Same opening paragraph with enough words here.

<!-- verify:ignore llm-tell "the real question is" -->

Same closing paragraph with enough words here.`;
    const right = `Same opening paragraph with enough words here.

That is a problem of institutions rather than of a founder's presence: how a standard is carried.

Same closing paragraph with enough words here.`;
    const inline = diffMarkdown(left, right, { matchLevel: "inline" });
    expect(inline.document.blocks.some((b) => b.status === "removed" && b.left.markdown.includes("verify:ignore"))).toBe(
      true,
    );
    expect(inline.document.blocks.some((b) => b.status === "added" && b.right.markdown.includes("problem of institutions"))).toBe(
      true,
    );
  });
});
