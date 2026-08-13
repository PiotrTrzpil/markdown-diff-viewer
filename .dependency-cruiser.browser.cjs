/**
 * Stricter cruise for the browser-safe entry graph.
 * Ensures `src/index.ts` / engine never pull CLI, git, UI shell, or Node builtins.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "browser-entry-no-adapters",
      severity: "error",
      comment: "Library entry must not import CLI, git, UI shell, or HTML page template",
      from: {
        path: "^src/(index|api|config|layout|model|core|text|debug|layout\\.ts)",
      },
      to: {
        path: "^src/(cli|git|ui)(/|$)",
      },
    },
    {
      name: "browser-entry-no-render-shell",
      severity: "error",
      comment: "Engine entry should not pull HTML row renderer (CLI-only adapter)",
      from: {
        path: "^src/(index|api|config|layout|model|core|text|debug|layout\\.ts)",
      },
      to: {
        path: "^src/render/",
      },
    },
    {
      name: "browser-entry-no-node-core",
      severity: "error",
      comment: "Browser entry graph must not import Node core modules",
      from: {
        path: "^src/(index|api|config|layout|model|core|text|debug|layout\\.ts)",
      },
      to: {
        dependencyTypes: ["core"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
