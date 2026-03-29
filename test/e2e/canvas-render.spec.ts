/**
 * E2E tests for the canvas renderer.
 * Generates HTML via the CLI, opens it in a real browser, checks for errors.
 */
import { test, expect } from "@playwright/test";
import { execSync, } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, "..", "..", "dist", "cli", "index.js");

function generateHtml(leftMd: string, rightMd: string): string {
  const left = join(tmpdir(), "md-diff-e2e-left.md");
  const right = join(tmpdir(), "md-diff-e2e-right.md");
  const out = join(tmpdir(), "md-diff-e2e-output.html");

  writeFileSync(left, leftMd);
  writeFileSync(right, rightMd);

  execSync(`node ${CLI} ${left} ${right} --no-open -o ${out}`, {
    cwd: join(__dirname, "..", ".."),
    stdio: "pipe",
  });

  return out;
}

test.describe("canvas renderer", () => {
  test("loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const htmlPath = generateHtml(
      "# Hello\n\nThe quick brown fox.",
      "# Hello\n\nThe fast brown fox.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000); // let boot() run

    expect(errors).toEqual([]);
  });

  test("renders text content in DOM", async ({ page }) => {
    const htmlPath = generateHtml(
      "# Title\n\nSome paragraph text here.",
      "# Title\n\nSome modified text here.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    // The text layer should contain real DOM text
    const textContent = await page.locator("#text").textContent();
    expect(textContent).toContain("Title");
    expect(textContent).toContain("paragraph");
  });

  test("canvas element exists and has dimensions", async ({ page }) => {
    const htmlPath = generateHtml("# Test", "# Test Modified");

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    const canvas = page.locator("#canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("header shows titles", async ({ page }) => {
    const htmlPath = generateHtml("# Left doc", "# Right doc");

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    const header = page.locator("header");
    await expect(header).toBeVisible();
    const headerText = await header.textContent();
    expect(headerText).toBeTruthy();
  });

  test("no console errors with large diff", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const left = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\nParagraph ${i} with some content about topic ${i}.`,
    ).join("\n\n");

    const right = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\nModified paragraph ${i} with different content about topic ${i + 100}.`,
    ).join("\n\n");

    const htmlPath = generateHtml(left, right);
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    expect(errors).toEqual([]);
  });

  test("text is selectable", async ({ page }) => {
    const htmlPath = generateHtml(
      "# Selectable\n\nThis text should be selectable.",
      "# Selectable\n\nThis text should be selectable.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    // Text layer spans should have user-select: text
    const textDiv = page.locator("#text");
    const userSelect = await textDiv.evaluate((el) => getComputedStyle(el).userSelect);
    expect(userSelect).toBe("text");
  });

  test("minimap canvas exists", async ({ page }) => {
    const htmlPath = generateHtml("# A\n\nParagraph.", "# B\n\nChanged.");

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    const minimap = page.locator("#minimap");
    await expect(minimap).toBeVisible();
  });

  test("handles markdown with special characters", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const htmlPath = generateHtml(
      "Code: `<script>alert('xss')</script>`\n\n\"Quotes\" & <angles> & 'apostrophes'",
      "Code: `<script>alert('fixed')</script>`\n\n\"Quotes\" & <angles> & 'changed'",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });

  test("handles empty documents", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    const htmlPath = generateHtml("", "# New content");
    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(1000);

    expect(errors).toEqual([]);
  });
});
