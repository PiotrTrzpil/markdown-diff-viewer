#!/usr/bin/env node

/**
 * `md-diff-lsp`: a language server that offers rich diffs of the open Markdown file as
 * code actions (and code lenses on its first line): vs HEAD, staged, vs the default
 * branch, and its last commit. Running one opens `md-diff` in the browser.
 * @module
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Connection } from "./protocol.js";
import { availableDiffs, type RichDiff } from "./diffs.js";

const OPEN_COMMAND = "md-diff.open";
/** Editors ask for code actions on every cursor move; git state rarely changes that fast. */
const DIFFS_TTL_MS = 2000;
const MESSAGE_ERROR = 1;

const CLI = fileURLToPath(new URL("../cli/index.js", import.meta.url));

interface TextDocumentParams {
  textDocument: { uri: string };
}

interface ExecuteCommandParams {
  command: string;
  arguments?: unknown[];
}

const connection = new Connection(process.stdin, process.stdout);
const cached = new Map<string, { at: number; diffs: Promise<RichDiff[]> }>();

function diffsFor(uri: string): Promise<RichDiff[]> {
  if (!uri.startsWith("file:")) return Promise.resolve([]);
  const hit = cached.get(uri);
  if (hit && Date.now() - hit.at < DIFFS_TTL_MS) return hit.diffs;
  const diffs = availableDiffs(fileURLToPath(uri));
  cached.set(uri, { at: Date.now(), diffs });
  return diffs;
}

function command(diff: RichDiff, title: string) {
  return { title, command: OPEN_COMMAND, arguments: [diff.cwd, ...diff.args] };
}

/** Runs `md-diff`, which writes the diff page and opens it; a failure shows in the editor. */
function openDiff(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => {
      if (code !== 0) {
        connection.notify("window/showMessage", {
          type: MESSAGE_ERROR,
          message: `md-diff ${args.join(" ")} failed in ${cwd}: ${stderr.trim() || `exit code ${code}`}`,
        });
      }
      resolve();
    });
  });
}

connection.onRequest("initialize", async () => ({
  capabilities: {
    codeActionProvider: true,
    codeLensProvider: { resolveProvider: false },
    executeCommandProvider: { commands: [OPEN_COMMAND] },
  },
  serverInfo: { name: "md-diff-lsp" },
}));

connection.onRequest("shutdown", async () => null);
connection.onNotification("exit", () => process.exit(0));

connection.onRequest("textDocument/codeAction", async (params) => {
  const { textDocument } = params as TextDocumentParams;
  const diffs = await diffsFor(textDocument.uri);
  return diffs.map((diff) => ({ title: diff.title, command: command(diff, diff.title) }));
});

connection.onRequest("textDocument/codeLens", async (params) => {
  const { textDocument } = params as TextDocumentParams;
  const diffs = await diffsFor(textDocument.uri);
  const firstLine = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  return diffs.map((diff) => ({ range: firstLine, command: command(diff, diff.lensTitle) }));
});

connection.onRequest("workspace/executeCommand", async (params) => {
  const { command: name, arguments: args = [] } = params as ExecuteCommandParams;
  if (name !== OPEN_COMMAND) {
    throw new Error(`Unknown command ${name}; this server runs ${OPEN_COMMAND}`);
  }
  const [cwd, ...rest] = args as string[];
  await openDiff(cwd, rest);
  return null;
});

connection.listen();
