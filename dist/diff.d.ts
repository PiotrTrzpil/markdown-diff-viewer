import type { RootContent } from "mdast";
export type DiffStatus = "equal" | "added" | "removed" | "modified";
export interface DiffPair {
    status: DiffStatus;
    left: RootContent | null;
    right: RootContent | null;
    /** For modified blocks, word-level diff of the text content */
    inlineDiff?: InlinePart[];
}
export interface InlinePart {
    value: string;
    type: "equal" | "added" | "removed";
}
/**
 * LCS-based block diff.
 * Matches blocks by content similarity, then aligns with spacers.
 */
export declare function diffBlocks(leftBlocks: RootContent[], rightBlocks: RootContent[]): DiffPair[];
