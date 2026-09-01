/**
 * InlinePart - the unit of an inline diff within a block.
 * Lives in its own module so diff stages (inline-diff, boundary-optimize,
 * rewrite-rules) can all depend on it without circular imports.
 */

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /**
   * Character-level sub-diff within a changed word/phrase.
   * When present, `value` is the concatenated text (for metrics on the whole chunk)
   * and `children` contains the char-level breakdown (for rendering).
   * Consumers MUST use walkLeafParts/flattenParts rather than iterating directly.
   */
  children?: InlinePart[];
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
  /**
   * Indicates this part should be absorbed at a given merge level.
   * - "stopword": Absorbed in conservative mode (stop words between changes)
   * - "single": Absorbed only in aggressive mode (single words between large changes)
   */
  absorbLevel?: "stopword" | "single";
}

/**
 * Visit leaf parts of an inline diff. When a part has children,
 * visits each child (the leaves); otherwise visits the part itself.
 * This is the correct way to iterate for metrics — never hand-roll traversal.
 */
export function walkLeafParts(
  parts: InlinePart[],
  fn: (part: InlinePart, parentType?: "removed" | "added") => void,
): void {
  for (const part of parts) {
    if (part.children) {
      for (const child of part.children) {
        fn(child, part.type as "removed" | "added");
      }
    } else {
      fn(part);
    }
  }
}

/**
 * Flatten an InlinePart[] by inlining children into the top level.
 * Each flattened child inherits the parent's `minor` flag if not already set.
 * Useful for serialization or simple iteration where tree structure isn't needed.
 */
export function flattenParts(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];
  for (const part of parts) {
    if (part.children) {
      for (const child of part.children) {
        result.push(child.minor !== undefined ? child : { ...child, minor: part.minor });
      }
    } else {
      result.push(part);
    }
  }
  return result;
}
