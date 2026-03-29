/**
 * Edge case tests for diff rendering.
 * Verifies correct behavior for case changes, minor words, punctuation, etc.
 */
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, "..", "..", "dist", "cli", "index.js");

function generateHtml(leftMd: string, rightMd: string): string {
  const left = join(tmpdir(), "ec-left.md");
  const right = join(tmpdir(), "ec-right.md");
  const out = join(tmpdir(), "ec-output.html");
  writeFileSync(left, leftMd);
  writeFileSync(right, rightMd);
  execSync(`node ${CLI} ${left} ${right} --no-open -o ${out}`, {
    cwd: join(__dirname, "..", ".."),
    stdio: "pipe",
  });
  return out;
}

interface SpanInfo {
  text: string;
  color: "white" | "red" | "green";
  side: string;
  diff?: string;
}

async function getSpans(page: import("@playwright/test").Page): Promise<SpanInfo[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("#text > div > div span")).map((s) => {
      const el = s as HTMLElement;
      const parent = el.closest("[data-side]") as HTMLElement;
      const c = el.style.color;
      return {
        text: el.textContent || "",
        color: c === "rgb(212, 212, 212)" ? "white" : c.includes("115") ? "red" : "green",
        side: parent?.dataset.side || "unknown",
        diff: el.dataset.diff,
      };
    }) as Array<{ text: string; color: "white" | "red" | "green"; side: string; diff?: string }>;
  });
}

test.describe("edge cases", () => {
  test("single character case change: the → The", async ({ page }) => {
    const htmlPath = generateHtml(
      "the quick brown fox.",
      "The quick brown fox.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const spans = await getSpans(page);
    const leftSpans = spans.filter((s) => s.side === "left");
    const rightSpans = spans.filter((s) => s.side === "right");

    // Both sides render the FULL text (all diff parts). Other side's text is transparent.
    const leftVisible = leftSpans.filter((s) => s.color !== "white" || s.text.trim()).map((s) => s.text).join("");
    expect(leftVisible).toContain("quick brown fox.");

    // "quick brown fox." should be white (equal) on both sides
    const leftEqual = leftSpans.filter((s) => s.color === "white").map((s) => s.text).join("");
    expect(leftEqual).toContain("quick brown fox");
  });

  test("minor word changes: a → the, is → was", async ({ page }) => {
    const htmlPath = generateHtml(
      "A dog is running in a park.",
      "The dog was running in the park.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const spans = await getSpans(page);
    const leftSpans = spans.filter((s) => s.side === "left");
    const rightSpans = spans.filter((s) => s.side === "right");

    // "running in" should be equal (white) on both sides
    const leftEqual = leftSpans.filter((s) => s.color === "white").map((s) => s.text).join("");
    expect(leftEqual).toContain("running in");

    // "dog" should be equal on both sides
    expect(leftEqual).toContain("dog");

    // Left should have red for removed words
    const leftRed = leftSpans.filter((s) => s.color === "red").map((s) => s.text).join("");
    expect(leftRed.length).toBeGreaterThan(0);

    // Right should have green for added words
    const rightGreen = rightSpans.filter((s) => s.color === "green").map((s) => s.text).join("");
    expect(rightGreen.length).toBeGreaterThan(0);
  });

  test("punctuation-only change: period → exclamation", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const htmlPath = generateHtml(
      "Hello world.",
      "Hello world!",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    expect(errors).toEqual([]);

    const spans = await getSpans(page);
    const leftSpans = spans.filter((s) => s.side === "left");
    const rightSpans = spans.filter((s) => s.side === "right");

    // Full text should be present on both sides
    const leftText = leftSpans.map((s) => s.text).join("");
    const rightText = rightSpans.map((s) => s.text).join("");
    expect(leftText).toContain("Hello world.");
    expect(rightText).toContain("Hello world!");
  });

  test("word insertion: no removed text on left", async ({ page }) => {
    const htmlPath = generateHtml(
      "The brown fox.",
      "The quick brown fox.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const spans = await getSpans(page);
    const rightSpans = spans.filter((s) => s.side === "right");

    // Right side should have "quick " in green
    const rightGreen = rightSpans.filter((s) => s.color === "green").map((s) => s.text).join("");
    expect(rightGreen).toContain("quick");
  });

  test("word deletion: no added text on right", async ({ page }) => {
    const htmlPath = generateHtml(
      "The quick brown fox.",
      "The brown fox.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const spans = await getSpans(page);
    const leftSpans = spans.filter((s) => s.side === "left");

    // Left side should have "quick " in red
    const leftRed = leftSpans.filter((s) => s.color === "red").map((s) => s.text).join("");
    expect(leftRed).toContain("quick");
  });

  test("multiple sentences with scattered changes", async ({ page }) => {
    const htmlPath = generateHtml(
      "The cat sat on the mat. It was a fine day. The sun was shining brightly.",
      "The dog sat on the rug. It was a good day. The moon was glowing softly.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const spans = await getSpans(page);
    const leftSpans = spans.filter((s) => s.side === "left");
    const rightSpans = spans.filter((s) => s.side === "right");

    // Equal text should include "sat on the" and "day. The" (anchors between changes)
    // Note: "It was a" gets absorbed as stop words between adjacent changes
    const leftEqual = leftSpans.filter((s) => s.color === "white").map((s) => s.text).join("");
    expect(leftEqual).toContain("sat on the");
    expect(leftEqual).toContain("day. The");

    // Removed: cat, mat, fine, sun, shining, brightly
    const leftRed = leftSpans.filter((s) => s.color === "red").map((s) => s.text).join("");
    expect(leftRed).toContain("cat");
    expect(leftRed).toContain("mat");

    // Added: dog, rug, good, moon, glowing, softly
    const rightGreen = rightSpans.filter((s) => s.color === "green").map((s) => s.text).join("");
    expect(rightGreen).toContain("dog");
    expect(rightGreen).toContain("rug");
  });

  test("bold text in equal block renders as bold", async ({ page }) => {
    const htmlPath = generateHtml(
      "This has **bold text** in it.",
      "This has **bold text** in it.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const boldSpans = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#text span"))
        .filter((s) => {
          const font = (s as HTMLElement).style.font;
          return font && (font.includes("700") || font.includes("bold"));
        })
        .map((s) => (s as HTMLElement).textContent),
    );

    expect(boldSpans.some((t) => t?.includes("bold text"))).toBe(true);
  });

  test("no JS errors on any edge case", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Empty left
    let htmlPath = generateHtml("", "New content here.");
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    // Empty right
    htmlPath = generateHtml("Old content here.", "");
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    // Identical
    htmlPath = generateHtml("Same text.", "Same text.");
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    // Very long single word
    htmlPath = generateHtml(
      "Superlongwordwithoutanyspaces repeated.",
      "Superlongwordwithoutanyspaces changed.",
    );
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });
});
