import type { DiffPair } from "./diff.js";
export interface RenderedRow {
    leftHtml: string;
    rightHtml: string;
    status: string;
}
/** Render all diff pairs into aligned HTML rows */
export declare function renderDiffPairs(pairs: DiffPair[]): RenderedRow[];
