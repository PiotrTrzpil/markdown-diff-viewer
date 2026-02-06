import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(source: string): Root {
  return parser.parse(source);
}

/** Extract top-level blocks from a markdown AST */
export function extractBlocks(tree: Root): RootContent[] {
  return tree.children;
}

/** Serialize a block node back to a stable string for comparison */
export function blockToText(node: RootContent): string {
  return serializeNode(node);
}

function serializeNode(node: any): string {
  if (node.type === "text") return node.value;
  if (node.type === "inlineCode") return "`" + node.value + "`";
  if (node.type === "code") return "```" + (node.lang || "") + "\n" + node.value + "\n```";
  if (node.type === "html") return node.value;
  if (node.type === "thematicBreak") return "---";
  if (node.type === "image") return `![${node.alt || ""}](${node.url})`;
  if (node.type === "link") {
    const children = (node.children || []).map(serializeNode).join("");
    return `[${children}](${node.url})`;
  }
  if (node.type === "heading") {
    const prefix = "#".repeat(node.depth) + " ";
    const children = (node.children || []).map(serializeNode).join("");
    return prefix + children;
  }
  if (node.type === "strong") {
    return "**" + (node.children || []).map(serializeNode).join("") + "**";
  }
  if (node.type === "emphasis") {
    return "*" + (node.children || []).map(serializeNode).join("") + "*";
  }
  if (node.type === "delete") {
    return "~~" + (node.children || []).map(serializeNode).join("") + "~~";
  }
  if (node.type === "break") return "\n";
  if (node.children) {
    return (node.children as any[]).map(serializeNode).join("");
  }
  if (node.value) return node.value;
  return "";
}
