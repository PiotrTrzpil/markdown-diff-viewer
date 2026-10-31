import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageReader, frame, type Message } from "../src/lsp/protocol.js";
import { availableDiffs } from "../src/lsp/diffs.js";

describe("MessageReader", () => {
  it("splits framed messages, however the bytes arrive", () => {
    const messages: Message[] = [];
    const reader = new MessageReader((message) => messages.push(message));
    const bytes = Buffer.from(
      frame({ jsonrpc: "2.0", id: 1, method: "initialize" }) +
        frame({ jsonrpc: "2.0", method: "initialized", params: { text: "zażółć" } }),
    );
    for (const byte of bytes) reader.push(Buffer.from([byte]));
    expect(messages.map((message) => message.method)).toEqual(["initialize", "initialized"]);
    expect(messages[1].params).toEqual({ text: "zażółć" });
  });
});

describe("availableDiffs", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const titles = async (file: string) => (await availableDiffs(join(repo, file))).map((diff) => diff.title);

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "md-diff-lsp-"));
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(join(repo, "doc.md"), "# Doc\n\nFirst.\n");
    git("add", "doc.md");
    git("commit", "--quiet", "-m", "Add doc");
    writeFileSync(join(repo, "doc.md"), "# Doc\n\nSecond.\n");
    git("commit", "--quiet", "-am", "Edit doc");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("offers only the last commit for a clean file on the default branch", async () => {
    expect(await titles("doc.md")).toEqual([expect.stringMatching(/^Rich diff of last commit \(\w+ Edit doc\)$/)]);
  });

  it("offers HEAD and staged diffs for an edited, staged file", async () => {
    writeFileSync(join(repo, "doc.md"), "# Doc\n\nThird.\n");
    git("add", "doc.md");
    expect((await titles("doc.md")).slice(0, 2)).toEqual(["Rich diff vs HEAD", "Rich diff of staged changes"]);
  });

  it("offers the default branch from another branch once the file differs", async () => {
    git("switch", "--quiet", "-c", "feature");
    writeFileSync(join(repo, "doc.md"), "# Doc\n\nOn a branch.\n");
    git("commit", "--quiet", "-am", "Branch edit");
    const diffs = await availableDiffs(join(repo, "doc.md"));
    expect(diffs.find((diff) => diff.title === "Rich diff vs main")?.args).toEqual(["--compare", "main", "doc.md"]);
  });

  it("offers nothing for an untracked file", async () => {
    writeFileSync(join(repo, "new.md"), "# New\n");
    expect(await titles("new.md")).toEqual([]);
  });
});
