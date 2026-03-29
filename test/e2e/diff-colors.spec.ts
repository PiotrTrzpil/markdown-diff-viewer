/**
 * E2E regression test: diff colors must align at word boundaries.
 * No single-character alphabetic fragments should appear.
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
  const left = join(tmpdir(), "dc-left.md");
  const right = join(tmpdir(), "dc-right.md");
  const out = join(tmpdir(), "dc-output.html");
  writeFileSync(left, leftMd);
  writeFileSync(right, rightMd);
  execSync(`node ${CLI} ${left} ${right} --no-open -o ${out}`, {
    cwd: join(__dirname, "..", ".."),
    stdio: "pipe",
  });
  return out;
}

test.describe("diff color word boundaries", () => {
  test("no single-character alphabetic fragments in colored spans", async ({ page }) => {
    // Text with bold markdown — the change is inside bold
    const htmlPath = generateHtml(
      "The **Multinarrative Flow Culture** is a theoretical model for design.",
      "The **Multinarrative Flow Design** is a practical framework for design.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const coloredSpans = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#text span"))
        .filter((s) => (s as HTMLElement).style.color !== "rgb(212, 212, 212)")
        .map((s) => (s as HTMLElement).textContent || ""),
    );

    // No single-char alpha fragments
    const fragments = coloredSpans.filter((t) => t.length === 1 && /^[a-zA-Z]$/.test(t));
    expect(fragments, `Found single-char fragments: ${JSON.stringify(fragments)}`).toHaveLength(0);
  });

  test("removed text shows complete words on left side", async ({ page }) => {
    const htmlPath = generateHtml(
      "The quick brown fox jumps over the lazy dog.",
      "The fast brown fox leaps over the lazy dog.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const redSpans = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#text span"))
        .filter((s) => (s as HTMLElement).style.color === "rgb(212, 115, 128)")
        .map((s) => (s as HTMLElement).textContent || ""),
    );

    // "quick " and "jumps " should be the removed words — complete words
    expect(redSpans).toContain("quick ");
    expect(redSpans).toContain("jumps ");
    // No partial words
    for (const t of redSpans) {
      expect(t.trim().length, `"${t}" is too short to be a word`).toBeGreaterThanOrEqual(3);
    }
  });

  test("added text shows complete words on right side", async ({ page }) => {
    const htmlPath = generateHtml(
      "The quick brown fox jumps over the lazy dog.",
      "The fast brown fox leaps over the lazy dog.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const greenSpans = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#text span"))
        .filter((s) => (s as HTMLElement).style.color === "rgb(107, 197, 126)")
        .map((s) => (s as HTMLElement).textContent || ""),
    );

    expect(greenSpans).toContain("fast ");
    expect(greenSpans).toContain("leaps ");
  });

  test("bold text renders as bold in equal blocks", async ({ page }) => {
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
        .map((s) => (s as HTMLElement).textContent || ""),
    );

    expect(boldSpans.some((t) => t.includes("bold text"))).toBe(true);
  });

  test("diff data + rendered DOM are consistent for modified paragraphs", async ({ page }) => {
    const htmlPath = generateHtml(
      "This chapter explores that question through a theoretical model: the Multinarrative Flow Culture. It integrates the narrative engine of the mind.",
      "The Multinarrative Flow Culture is a theoretical model for exactly that design. It integrates the narrative capacity of the mind.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      // Read the embedded diff data
      const dataEl = document.getElementById("diff-data");
      const data = JSON.parse(dataEl!.textContent!);
      const mod = data.files[0].pairs.find((p: { status: string }) => p.status === "modified");
      if (!mod) return { error: "no modified pair" };

      // Flatten inline parts (expanding children) for left side
      type Part = { type: string; value: string; minor?: boolean; children?: Part[] };
      const flatParts: Part[] = [];
      for (const p of mod.inlineDiff as Part[]) {
        if (p.children && p.children.length > 0) {
          for (const c of p.children) flatParts.push(c);
        } else {
          flatParts.push(p);
        }
      }

      // Build expected char-by-char color map for left side
      const expectedChars: Array<{ char: string; type: string }> = [];
      for (const p of flatParts) {
        if (p.type === "added") continue; // skip on left
        for (const ch of p.value) {
          expectedChars.push({ char: ch, type: p.type });
        }
      }

      // Build actual char-by-char color map from DOM (left side only)
      const leftSpans = Array.from(document.querySelectorAll("#text span"))
        .filter((s) => parseFloat((s as HTMLElement).style.left) < 680)
        .sort((a, b) => {
          const ay = parseFloat((a as HTMLElement).style.top);
          const by = parseFloat((b as HTMLElement).style.top);
          return ay !== by ? ay - by : parseFloat((a as HTMLElement).style.left) - parseFloat((b as HTMLElement).style.left);
        });

      const actualChars: Array<{ char: string; type: string }> = [];
      for (const s of leftSpans) {
        const el = s as HTMLElement;
        const color = el.style.color;
        const type = color === "rgb(212, 212, 212)" ? "equal" : color === "rgb(212, 115, 128)" ? "removed" : "added";
        for (const ch of el.textContent || "") {
          actualChars.push({ char: ch, type });
        }
      }

      // Find first text mismatch
      for (let i = 0; i < Math.min(expectedChars.length, actualChars.length); i++) {
        if (expectedChars[i].char !== actualChars[i].char) {
          return {
            textMismatchAt: i,
            expected: expectedChars[i],
            actual: actualChars[i],
            expectedContext: expectedChars.slice(Math.max(0, i - 5), i + 5).map((c) => c.char).join(""),
            actualContext: actualChars.slice(Math.max(0, i - 5), i + 5).map((c) => c.char).join(""),
          };
        }
      }

      // Find first color mismatch
      for (let i = 0; i < Math.min(expectedChars.length, actualChars.length); i++) {
        if (expectedChars[i].type !== actualChars[i].type) {
          return {
            colorMismatchAt: i,
            char: expectedChars[i].char,
            expectedType: expectedChars[i].type,
            actualType: actualChars[i].type,
          };
        }
      }

      return {
        match: true,
        expectedLen: expectedChars.length,
        actualLen: actualChars.length,
      };
    });

    if ("textMismatchAt" in result || "colorMismatchAt" in result || "error" in result) {
      console.log("MISMATCH:", JSON.stringify(result));
    }
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("textMismatchAt");
    expect(result).not.toHaveProperty("colorMismatchAt");
    expect(result).toHaveProperty("match", true);
  });

  test("no ** markers visible in output", async ({ page }) => {
    const htmlPath = generateHtml(
      "The **bold** word and *italic* word.",
      "The **strong** word and *emphasis* word.",
    );

    await page.goto(`file://${htmlPath}`);
    await page.waitForTimeout(2000);

    const allText = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#text span"))
        .map((s) => (s as HTMLElement).textContent || ""),
    );

    for (const t of allText) {
      expect(t).not.toContain("**");
      expect(t).not.toContain("\\u0002");
      expect(t).not.toContain("\\u0003");
    }
  });
});
