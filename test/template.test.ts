import { describe, it, expect } from "vitest";

// Re-implement the grouping functions for testing (same logic as template.tsx)
function getDirectory(path: string): string {
  const effectivePath = path.includes(" → ") ? path.split(" → ")[1] : path;
  const parts = effectivePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

interface FileDiff {
  path: string;
  added?: number;
  removed?: number;
}

interface FileGroup {
  dir: string;
  files: Array<{ file: FileDiff; idx: number }>;
}

function groupFilesByDirectory(files: FileDiff[]): FileGroup[] {
  const byDir = new Map<string, Array<{ file: FileDiff; idx: number }>>();

  files.forEach((file, idx) => {
    const dir = getDirectory(file.path);
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push({ file, idx });
  });

  const groups: FileGroup[] = [];
  const sortedDirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b));

  for (const dir of sortedDirs) {
    groups.push({ dir, files: byDir.get(dir)! });
  }

  return groups;
}

describe("getDirectory", () => {
  it("should return empty string for root-level files", () => {
    expect(getDirectory("README.md")).toBe("");
    expect(getDirectory("file.md")).toBe("");
  });

  it("should return directory path for nested files", () => {
    expect(getDirectory("docs/intro.md")).toBe("docs");
    expect(getDirectory("src/components/Button.md")).toBe("src/components");
  });

  it("should handle rename format and use new path", () => {
    expect(getDirectory("old.md → new.md")).toBe("");
    expect(getDirectory("old/file.md → new/file.md")).toBe("new");
    expect(getDirectory("docs/old.md → docs/new.md")).toBe("docs");
  });
});

describe("groupFilesByDirectory", () => {
  it("should group files by directory", () => {
    const files: FileDiff[] = [
      { path: "docs/a.md" },
      { path: "docs/b.md" },
      { path: "src/x.md" },
    ];

    const groups = groupFilesByDirectory(files);

    expect(groups.length).toBe(2);
    expect(groups[0].dir).toBe("docs");
    expect(groups[0].files.length).toBe(2);
    expect(groups[1].dir).toBe("src");
    expect(groups[1].files.length).toBe(1);
  });

  it("should put root-level files in empty-string group", () => {
    const files: FileDiff[] = [
      { path: "README.md" },
      { path: "CHANGELOG.md" },
    ];

    const groups = groupFilesByDirectory(files);

    expect(groups.length).toBe(1);
    expect(groups[0].dir).toBe("");
    expect(groups[0].files.length).toBe(2);
  });

  it("should preserve original indices", () => {
    const files: FileDiff[] = [
      { path: "z.md" },      // idx 0
      { path: "docs/a.md" }, // idx 1
      { path: "a.md" },      // idx 2
    ];

    const groups = groupFilesByDirectory(files);

    // Root group should have files with original indices 0 and 2
    const rootGroup = groups.find(g => g.dir === "");
    expect(rootGroup).toBeDefined();
    expect(rootGroup!.files.map(f => f.idx)).toContain(0);
    expect(rootGroup!.files.map(f => f.idx)).toContain(2);

    // Docs group should have file with original index 1
    const docsGroup = groups.find(g => g.dir === "docs");
    expect(docsGroup).toBeDefined();
    expect(docsGroup!.files[0].idx).toBe(1);
  });

  it("should sort directories alphabetically", () => {
    const files: FileDiff[] = [
      { path: "zebra/file.md" },
      { path: "alpha/file.md" },
      { path: "middle/file.md" },
    ];

    const groups = groupFilesByDirectory(files);

    expect(groups.map(g => g.dir)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("should handle deeply nested paths", () => {
    const files: FileDiff[] = [
      { path: "a/b/c/file.md" },
      { path: "a/b/other.md" },
      { path: "a/top.md" },
    ];

    const groups = groupFilesByDirectory(files);

    // Each unique directory path gets its own group
    expect(groups.length).toBe(3);
    expect(groups.map(g => g.dir).sort()).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("should handle mixed root and nested files", () => {
    const files: FileDiff[] = [
      { path: "README.md" },
      { path: "docs/guide.md" },
      { path: "CONTRIBUTING.md" },
      { path: "src/main.md" },
    ];

    const groups = groupFilesByDirectory(files);

    // Root comes first (empty string sorts first), then docs, then src
    expect(groups[0].dir).toBe("");
    expect(groups[0].files.length).toBe(2); // README.md and CONTRIBUTING.md
  });

  it("should handle renamed files correctly", () => {
    const files: FileDiff[] = [
      { path: "old/file.md → new/file.md" },
    ];

    const groups = groupFilesByDirectory(files);

    // Should use the new path's directory
    expect(groups[0].dir).toBe("new");
  });
});

describe("file sorting", () => {
  // Re-implement sortFilesByPath for testing
  function sortFilesByPath<T extends { path: string }>(files: T[]): T[] {
    return [...files].sort((a, b) => a.path.localeCompare(b.path));
  }

  it("should sort files alphabetically by path", () => {
    const files = [
      { path: "z.md" },
      { path: "a.md" },
      { path: "m.md" },
    ];

    const sorted = sortFilesByPath(files);

    expect(sorted.map(f => f.path)).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("should group files in same directory together", () => {
    const files = [
      { path: "src/z.md" },
      { path: "docs/a.md" },
      { path: "src/a.md" },
      { path: "docs/z.md" },
    ];

    const sorted = sortFilesByPath(files);

    // docs/ files should come before src/ files
    expect(sorted.map(f => f.path)).toEqual([
      "docs/a.md",
      "docs/z.md",
      "src/a.md",
      "src/z.md",
    ]);
  });

  it("should handle root files vs nested files", () => {
    const files = [
      { path: "src/main.md" },
      { path: "readme.md" },
      { path: "docs/intro.md" },
    ];

    const sorted = sortFilesByPath(files);

    // localeCompare: docs < readme < src (alphabetical)
    expect(sorted.map(f => f.path)).toEqual([
      "docs/intro.md",
      "readme.md",
      "src/main.md",
    ]);
  });
});
