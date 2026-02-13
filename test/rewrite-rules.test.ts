/**
 * Tests for the declarative stop word absorption system.
 */
import { describe, it, expect } from "vitest";
import {
  applyRewriteRules,
  applyRulesUntilStable,
  absorbStopWordsDeclarative,
  STOP_WORD_RULES,
  type RewriteRule,
  type MatchContext,
} from "../src/core/rewrite-rules.js";
import type { InlinePart } from "../src/core/inline-diff.js";

// Helper to create parts
const removed = (value: string, minor = false): InlinePart => ({ value, type: "removed", minor: minor || undefined });
const added = (value: string, minor = false): InlinePart => ({ value, type: "added", minor: minor || undefined });
const equal = (value: string): InlinePart => ({ value, type: "equal" });

describe("applyRewriteRules", () => {
  it("should apply a simple transformation rule", () => {
    const rule: RewriteRule = {
      name: "test-rule",
      pattern: ["equal"],
      condition: (match) => match[0].value === "target",
      transform: () => [{ value: "replaced", type: "equal" }],
    };

    const parts = [equal("before"), equal("target"), equal("after")];
    const result = applyRewriteRules(parts, [rule]);

    expect(result).toHaveLength(3);
    expect(result[1].value).toBe("replaced");
  });

  it("should handle multi-part patterns", () => {
    const rule: RewriteRule = {
      name: "merge-pair",
      pattern: ["removed", "added"],
      condition: () => true,
      transform: (match) => [{ value: match[0].value + match[1].value, type: "equal" }],
    };

    const parts = [removed("A"), added("B"), equal("C")];
    const result = applyRewriteRules(parts, [rule]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ value: "AB", type: "equal" });
  });

  it("should pass context to condition and transform", () => {
    let capturedContext: MatchContext | null = null;

    const rule: RewriteRule = {
      name: "context-test",
      pattern: ["equal"],
      condition: (_match, ctx) => {
        capturedContext = ctx;
        return false; // Don't transform, just capture
      },
      transform: () => [],
    };

    const parts = [equal("first"), equal("second"), equal("third")];
    applyRewriteRules(parts, [rule]);

    // Condition is checked for each equal part
    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.allParts).toBe(parts);
  });

  it("should try rules in priority order", () => {
    const log: string[] = [];

    const highPriority: RewriteRule = {
      name: "high",
      pattern: ["equal"],
      condition: () => { log.push("high"); return true; },
      transform: (match) => match,
    };

    const lowPriority: RewriteRule = {
      name: "low",
      pattern: ["equal"],
      condition: () => { log.push("low"); return true; },
      transform: (match) => match,
    };

    applyRewriteRules([equal("test")], [highPriority, lowPriority]);

    expect(log).toEqual(["high"]); // Low priority never checked
  });
});

describe("applyRulesUntilStable", () => {
  it("should apply rules multiple times until stable", () => {
    let callCount = 0;

    const rule: RewriteRule = {
      name: "reduce",
      pattern: ["equal", "equal"],
      condition: () => true,
      transform: (match) => {
        callCount++;
        return [{ value: match[0].value + match[1].value, type: "equal" }];
      },
    };

    // [a, b, c, d] -> [ab, cd] -> [abcd]
    const parts = [equal("a"), equal("b"), equal("c"), equal("d")];
    const result = applyRulesUntilStable(parts, [rule]);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("abcd");
  });

  it("should respect maxIterations", () => {
    const rule: RewriteRule = {
      name: "infinite",
      pattern: ["equal"],
      condition: () => true,
      transform: () => [equal("a"), equal("b")], // Always produces more parts
    };

    const result = applyRulesUntilStable([equal("start")], [rule], 3);

    // Should stop after 3 iterations, not infinite loop
    expect(result.length).toBeGreaterThan(1);
  });
});

describe("absorbStopWordsDeclarative", () => {
  it("should absorb stop words between changes", () => {
    // [removed:"old"] [equal:"the"] [added:"new"]
    const parts = [removed("old "), equal("the "), added("new")];
    const result = absorbStopWordsDeclarative(parts);

    // "the" should be absorbed into removed and added
    const equalParts = result.filter(p => p.type === "equal");
    expect(equalParts).toHaveLength(0);

    const removedPart = result.find(p => p.type === "removed");
    expect(removedPart?.value).toContain("the");
  });

  it("should preserve stop words with nearby meaningful equal", () => {
    // [removed:"X"] [equal:"was"] [added:"Y"] [equal:"diagnosed"]
    // "was" should NOT be absorbed because "diagnosed" is meaningful and only 1 change away
    const parts = [removed("X "), equal("was "), added("Y "), equal("diagnosed")];
    const result = absorbStopWordsDeclarative(parts);

    const equalParts = result.filter(p => p.type === "equal");
    expect(equalParts.some(p => p.value.includes("was"))).toBe(true);
  });

  it("should absorb minor stop-word pairs", () => {
    // [removed:"big change"] [removed(minor):"the"] [added(minor):"The"] [added:"more change"]
    const parts = [
      removed("big change "),
      removed("the ", true),
      added("The ", true),
      added("more change"),
    ];
    const result = absorbStopWordsDeclarative(parts);

    // Minor pair should be absorbed
    const resultTypes = result.map(p => p.type);
    expect(resultTypes).toEqual(["removed", "added"]);
  });

  it("should chain absorption of multiple stop words", () => {
    // Pattern: [removed] [equal:stop] [added] [equal:stop] [removed] [equal:stop] [added]
    // Each stop word is sandwiched between changes
    const parts = [
      removed("X "),
      equal("the "),
      added("Y "),
      removed("A "),
      equal("of "),
      added("B"),
    ];
    const result = absorbStopWordsDeclarative(parts);

    // Stop words should be absorbed when between changes
    const equalParts = result.filter(p => p.type === "equal");
    // Both "the" and "of" are between changes, so should be absorbed
    expect(equalParts).toHaveLength(0);
  });

  it("should not absorb non-stop-word equal parts", () => {
    const parts = [removed("old "), equal("important "), added("new")];
    const result = absorbStopWordsDeclarative(parts);

    const equalParts = result.filter(p => p.type === "equal");
    expect(equalParts.some(p => p.value.includes("important"))).toBe(true);
  });

  it("should handle real-world paragraph diff", () => {
    // Pattern: [removed] [equal:stop] [removed+added] [equal:stop] [removed+added]
    // Stop words sandwiched between changes should be absorbed
    const parts = [
      removed("researchers "),
      equal("in "),
      added("experts "),
      removed("field "),
      equal("of "),
      added("area "),
    ];

    const result = absorbStopWordsDeclarative(parts);

    // "in" is between removed("researchers") and added("experts") - should absorb
    // "of" is between removed("field") and added("area") - should absorb
    const equalParts = result.filter(p => p.type === "equal");
    expect(equalParts).toHaveLength(0);
  });
});

describe("STOP_WORD_RULES", () => {
  it("should have all required rules", () => {
    const ruleNames = STOP_WORD_RULES.map(r => r.name);

    expect(ruleNames).toContain("absorb-equal-stop-words");
    expect(ruleNames).toContain("absorb-single-word-large-changes");
    expect(ruleNames).toContain("absorb-minor-stop-word-pair");
  });
});
