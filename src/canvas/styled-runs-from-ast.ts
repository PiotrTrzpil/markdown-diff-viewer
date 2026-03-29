/**
 * Extract styled text runs directly from an mdast AST node.
 *
 * Unlike parseInlineMarkdown (which re-parses markdown text), this walks
 * the already-parsed AST. The resulting runs have the same total text
 * as blockPlainText() — no ** or * markers — but carry bold/italic/code
 * information from the AST structure.
 *
 * This ensures styled runs and diff parts (which both reference plain text)
 * are in the same character coordinate space.
 */
import type { RootContent, Nodes } from "mdast";
import type { StyledRun } from "./types.js";

interface StyleState {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link?: string;
}

function walkNode(node: Nodes, state: StyleState, runs: StyledRun[]): void {
  switch (node.type) {
    case "text":
      if (node.value.length > 0) {
        runs.push({
          text: node.value,
          bold: state.bold,
          italic: state.italic,
          code: state.code,
          strikethrough: state.strikethrough,
          ...(state.link !== undefined ? { link: state.link } : {}),
        });
      }
      break;

    case "inlineCode":
      if (node.value.length > 0) {
        runs.push({
          text: node.value,
          bold: state.bold,
          italic: state.italic,
          code: true,
          strikethrough: state.strikethrough,
        });
      }
      break;

    case "strong":
      for (const child of node.children) {
        walkNode(child as Nodes, { ...state, bold: true }, runs);
      }
      break;

    case "emphasis":
      for (const child of node.children) {
        walkNode(child as Nodes, { ...state, italic: true }, runs);
      }
      break;

    case "delete":
      for (const child of node.children) {
        walkNode(child as Nodes, { ...state, strikethrough: true }, runs);
      }
      break;

    case "link":
      for (const child of node.children) {
        walkNode(child as Nodes, { ...state, link: node.url }, runs);
      }
      break;

    case "image":
      if (node.alt) {
        runs.push({ text: node.alt, ...state });
      }
      break;

    case "break":
      runs.push({ text: "\n", ...state });
      break;

    case "html":
      if (node.value.length > 0) {
        runs.push({ text: node.value, ...state });
      }
      break;

    default:
      if ("children" in node) {
        for (const child of node.children as Nodes[]) {
          walkNode(child, state, runs);
        }
      } else if ("value" in node) {
        const val = (node as { value: string }).value;
        if (val.length > 0) {
          runs.push({ text: val, ...state });
        }
      }
      break;
  }
}

/** Merge adjacent runs with identical styling */
function mergeRuns(runs: StyledRun[]): StyledRun[] {
  if (runs.length === 0) return runs;
  const merged: StyledRun[] = [runs[0]];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = runs[i];
    if (
      prev.bold === curr.bold &&
      prev.italic === curr.italic &&
      prev.code === curr.code &&
      prev.strikethrough === curr.strikethrough &&
      prev.link === curr.link
    ) {
      merged[merged.length - 1] = { ...prev, text: prev.text + curr.text };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Extract styled runs from an mdast block node.
 * The total text matches blockPlainText(node) — no markdown markers.
 */
export function styledRunsFromAST(node: RootContent): StyledRun[] {
  const runs: StyledRun[] = [];
  const baseState: StyleState = { bold: false, italic: false, code: false, strikethrough: false };

  if (node.type === "heading") {
    for (const child of (node as import("mdast").Heading).children) {
      walkNode(child as Nodes, baseState, runs);
    }
  } else if (node.type === "code") {
    runs.push({ text: node.value, bold: false, italic: false, code: true, strikethrough: false });
  } else {
    walkNode(node as Nodes, baseState, runs);
  }

  return mergeRuns(runs);
}
