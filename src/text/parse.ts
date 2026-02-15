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

/** Serialize a block node back to a stable string for comparison */
export function blockToText(node: RootContent): string {
  return serializeNode(node);
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
