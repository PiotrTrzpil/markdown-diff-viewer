/**
 * InlinePart - the unit of an inline diff within a block.
 * Lives in its own module so diff stages (inline-diff, boundary-optimize,
 * rewrite-rules) can all depend on it without circular imports.
 *
 * Parts are a single-level stream. Shared text appears once (type "equal").
 * Character-level edits are ordinary removed/added/equal parts, not a tree.
 */

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /**
   * True if the change is minor (case-only, punctuation-only).
   * Set during diff computation when normalized words match.
   * Can also be computed at render time via isMinorChange().
   */
  minor?: boolean;
  /**
   * True if this added/removed part is relocated text (same words, different
   * place) rather than a real edit. Hosts should paint both sites as a move.
   */
  moved?: true;
  /** Shared with the partner inline part when `moved` is set. */
  moveId?: number;
  /**
   * Indicates this part should be absorbed at a given merge level.
   * - "stopword": Absorbed in conservative mode (stop words between changes)
   * - "single": Absorbed only in aggressive mode (single words between large changes)
   */
  absorbLevel?: "stopword" | "single";
}

/**
 * Visit each part. Kept for hosts that used the old tree-walking helper;
 * the stream is already flat.
 */
export function walkLeafParts(
  parts: InlinePart[],
  fn: (part: InlinePart, parentType?: "removed" | "added") => void,
): void {
  for (const part of parts) {
    fn(part);
  }
}

/**
 * Identity — parts are already a single-level stream.
 * Kept so hosts that flattened children keep compiling.
 */
export function flattenParts(parts: InlinePart[]): InlinePart[] {
  return parts;
}
