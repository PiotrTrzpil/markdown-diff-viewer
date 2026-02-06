import type { Root, RootContent } from "mdast";
export declare function parseMarkdown(source: string): Root;
/** Extract top-level blocks from a markdown AST */
export declare function extractBlocks(tree: Root): RootContent[];
/** Serialize a block node back to a stable string for comparison */
export declare function blockToText(node: RootContent): string;
