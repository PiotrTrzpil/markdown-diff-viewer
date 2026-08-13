/**
 * Type guards and helpers for {@link DiffDocument}.
 */

import type { InlinePart } from "../core/inline-part.js";
import { flattenParts, walkLeafParts } from "../core/inline-part.js";
import type { DiffBlock, DiffDocument } from "./document.js";

export function isEqualBlock(b: DiffBlock): b is Extract<DiffBlock, { status: "equal" }> {
  return b.status === "equal";
}

export function isAddedBlock(b: DiffBlock): b is Extract<DiffBlock, { status: "added" }> {
  return b.status === "added";
}

export function isRemovedBlock(b: DiffBlock): b is Extract<DiffBlock, { status: "removed" }> {
  return b.status === "removed";
}

export function isModifiedBlock(b: DiffBlock): b is Extract<DiffBlock, { status: "modified" }> {
  return b.status === "modified";
}

export function isSplitBlock(b: DiffBlock): b is Extract<DiffBlock, { status: "split" }> {
  return b.status === "split";
}

export function isChangedBlock(b: DiffBlock): boolean {
  return b.status !== "equal";
}

export function changedBlocks(document: DiffDocument): DiffBlock[] {
  return document.blocks.filter(isChangedBlock);
}

export function modifiedBlocks(
  document: DiffDocument,
): Array<Extract<DiffBlock, { status: "modified" }>> {
  return document.blocks.filter(isModifiedBlock);
}

export function cloneDocument(document: DiffDocument): DiffDocument {
  return JSON.parse(JSON.stringify(document)) as DiffDocument;
}

export function isDocumentUnchanged(document: DiffDocument): boolean {
  return document.blocks.every(isEqualBlock);
}

export function collectInlineLeaves(document: DiffDocument): InlinePart[] {
  const out: InlinePart[] = [];
  for (const block of document.blocks) {
    if (block.status === "modified") {
      out.push(...flattenParts(block.inline));
    } else if (block.status === "added" && block.inline) {
      out.push(...flattenParts(block.inline));
    }
  }
  return out;
}

export function walkDocumentInlineLeaves(
  document: DiffDocument,
  fn: (part: InlinePart, blockIndex: number) => void,
): void {
  document.blocks.forEach((block, blockIndex) => {
    if (block.status === "modified") {
      walkLeafParts(block.inline, (part) => fn(part, blockIndex));
    } else if (block.status === "added" && block.inline) {
      walkLeafParts(block.inline, (part) => fn(part, blockIndex));
    }
  });
}
