import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, Nodes } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(source: string): Root {
  return parser.parse(source);
}

/** Extract top-level blocks from a markdown AST */
export function extractBlocks(tree: Root): RootContent[] {
  return tree.children;
}

/** Returns inner content of a block node (no heading prefix, no code fences) */
export function blockInnerText(node: RootContent): string {
  if (node.type === "heading") {
    return (node as import("mdast").Heading).children.map(serializeNode).join("");
  }
  if (node.type === "code") {
    return node.value;
  }
  return serializeNode(node);
}

/** Returns plain display text (no markdown markers like **, *, ~~, `) */
export function blockPlainText(node: RootContent): string {
  if (node.type === "heading") {
    return (node as import("mdast").Heading).children.map(plainTextNode).join("");
  }
  if (node.type === "code") {
    return node.value;
  }
  return plainTextNode(node);
}

function plainTextNode(node: Nodes): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return node.value;
    case "html":
      return node.value;
    case "thematicBreak":
      return "---";
    case "image":
      return node.alt || "";
    case "link":
      return node.children.map(plainTextNode).join("");
    case "break":
      return "\n";
    case "list":
      return node.children.map((item) => plainTextNode(item as Nodes)).join("\n");
    case "listItem":
      return (node.children as Nodes[]).map(plainTextNode).join("");
    case "blockquote":
      return (node.children as Nodes[]).map(plainTextNode).join("\n");
    case "paragraph":
      return (node.children as Nodes[]).map(plainTextNode).join("");
    default:
      if ("children" in node) {
        return (node.children as Nodes[]).map(plainTextNode).join("");
      }
      if ("value" in node) return (node as { value: string }).value;
      return "";
  }
}

/** Serialize a block node back to a stable string for comparison */
export function blockToText(node: RootContent): string {
  if (node.type === "heading") {
    return "#".repeat((node as import("mdast").Heading).depth) + " " + blockInnerText(node);
  }
  if (node.type === "code") {
    return "```" + (node.lang || "") + "\n" + blockInnerText(node) + "\n```";
  }
  return blockInnerText(node);
}

/** Get the HTML wrapper tag string for a block node */
export function getWrapTag(node: RootContent): string {
  switch (node.type) {
    case "heading":
      return `h${(node as import("mdast").Heading).depth}`;
    case "paragraph":
      return "p";
    case "blockquote":
      return "blockquote";
    case "code":
      return "pre";
    case "list":
      return "ul";
    default:
      return "div";
  }
}

function serializeNode(node: Nodes): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "inlineCode":
      return "`" + node.value + "`";
    case "code":
      return "```" + (node.lang || "") + "\n" + node.value + "\n```";
    case "html":
      return node.value;
    case "thematicBreak":
      return "---";
    case "image":
      return `![${node.alt || ""}](${node.url})`;
    case "link":
      return `[${node.children.map(serializeNode).join("")}](${node.url})`;
    case "heading":
      return "#".repeat(node.depth) + " " + node.children.map(serializeNode).join("");
    case "strong":
      return "**" + node.children.map(serializeNode).join("") + "**";
    case "emphasis":
      return "*" + node.children.map(serializeNode).join("") + "*";
    case "delete":
      return "~~" + node.children.map(serializeNode).join("") + "~~";
    case "break":
      return "\n";
    case "list": {
      const ordered = (node as { ordered?: boolean }).ordered;
      return node.children.map((item, i) => {
        const marker = ordered ? `${i + 1}. ` : "- ";
        return marker + serializeNode(item as Nodes);
      }).join("\n");
    }
    case "listItem":
      // List item children are typically paragraphs; extract their content
      return (node.children as Nodes[]).map(serializeNode).join("\n");
    default:
      if ("children" in node) {
        return (node.children as Nodes[]).map(serializeNode).join("");
      }
      if ("value" in node) {
        return String(node.value);
      }
      return "";
  }
}
