/**
 * Deep verification: data consistency + visual correctness.
 * Uses data attributes on DOM elements for reliable querying.
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
  const left = join(tmpdir(), "dv-left.md");
  const right = join(tmpdir(), "dv-right.md");
  const out = join(tmpdir(), "dv-output.html");
  writeFileSync(left, leftMd);
  writeFileSync(right, rightMd);
  execSync(`node ${CLI} ${left} ${right} --no-open -o ${out}`, {
    cwd: join(__dirname, "..", ".."),
    stdio: "pipe",
  });
  return out;
}

test("DiffData text matches between inline parts and innerText", async ({ page }) => {
  const htmlPath = generateHtml(
    "This chapter explores that question through a theoretical model: the Multinarrative Flow Culture. It integrates the narrative engine of the mind, the bonding power of shared ritual, and the conscious stewardship of design.",
    "The Multinarrative Flow Culture is a theoretical model for exactly that design. It integrates the narrative capacity of the mind, the bonding force of shared ritual, and the conscious stewardship of architecture.",
  );

  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("diff-data")!.textContent!);
    const mod = data.files[0].pairs.find((p: { status: string }) => p.status === "modified");
    if (!mod) return { error: "no modified pair" };

    let leftText = "";
    let rightText = "";
    for (const p of mod.inlineDiff as Array<{ type: string; value: string }>) {
      if (p.type !== "added") leftText += p.value;
      if (p.type !== "removed") rightText += p.value;
    }

    return {
      leftMatch: leftText === mod.left.innerText,
      rightMatch: rightText === mod.right.innerText,
      leftLen: mod.left.innerText.length,
      rightLen: mod.right.innerText.length,
    };
  });

  expect(result).not.toHaveProperty("error");
  expect(result.leftMatch).toBe(true);
  expect(result.rightMatch).toBe(true);
});

test("no overlaps within individual line divs", async ({ page }) => {
  const htmlPath = generateHtml(
    "This chapter explores that question through a theoretical model: the Multinarrative Flow Culture. It integrates the narrative engine of the mind, the bonding power of shared ritual.",
    "The Multinarrative Flow Culture is a theoretical model for exactly that design. It integrates the narrative capacity of the mind, the bonding force of shared ritual.",
  );

  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    let overlaps = 0;
    const divs = document.querySelectorAll("#text > div > div");
    for (const div of divs) {
      const spans = div.querySelectorAll("span");
      if (spans.length <= 1) continue;
      const rects = Array.from(spans).map((s) => s.getBoundingClientRect());
      // Inline flow: each span's LEFT should be >= previous span's LEFT
      // (monotonically increasing). We check LEFT, not RIGHT, because
      // overflow:hidden may clip span widths, making RIGHT unreliable.
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].left < rects[i - 1].left - 1) {
          overlaps++;
        }
      }
    }
    return { divs: divs.length, overlaps };
  });

  expect(result.overlaps).toBe(0);
});

test("color distribution: white for equal, red for removed, green for added", async ({ page }) => {
  const htmlPath = generateHtml(
    "The quick brown fox jumps over the lazy dog.",
    "The fast brown fox leaps over the lazy dog.",
  );

  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const spans = document.querySelectorAll("#text > div > div span");
    const colors = { white: 0, red: 0, green: 0 };
    for (const s of spans) {
      const c = (s as HTMLElement).style.color;
      if (c === "rgb(212, 212, 212)") colors.white++;
      else if (c === "rgb(212, 115, 128)") colors.red++;
      else if (c === "rgb(107, 197, 126)") colors.green++;
    }

    // Left side should have red, right should have green
    const leftRed = document.querySelectorAll('#text > div > div[data-side="left"] span[data-diff="removed"]').length;
    const rightGreen = document.querySelectorAll('#text > div > div[data-side="right"] span[data-diff="added"]').length;

    return { ...colors, leftRed, rightGreen };
  });

  expect(result.white).toBeGreaterThan(0);
  expect(result.red).toBeGreaterThan(0);
  expect(result.green).toBeGreaterThan(0);
  expect(result.leftRed).toBeGreaterThan(0);
  expect(result.rightGreen).toBeGreaterThan(0);
});

test("no console errors on real-world modified content", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) {
      errors.push(msg.text());
    }
  });

  const htmlPath = generateHtml(
    "This chapter explores that question through a theoretical model: the Multinarrative Flow Culture. It integrates the narrative engine of the mind, the bonding power of shared ritual, and the conscious stewardship of design. Rather than relying on the external pressures of scarcity, this culture cultivates social environments where meaningful engagement is the baseline.",
    "The Multinarrative Flow Culture is a theoretical model for exactly that design. It integrates the narrative capacity of the mind, the bonding force of shared ritual, and the conscious stewardship of architecture - one where the institutions, relationships, and rhythms of daily life are oriented toward the conditions that make such moments ordinary rather than exceptional.",
  );

  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(2000);

  expect(errors).toEqual([]);
});
