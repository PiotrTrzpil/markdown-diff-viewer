/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are not allowed",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Modules should be reachable from an entry point",
      from: {
        orphan: true,
        pathNot: ["\\.test\\.ts$", "\\.d\\.ts$", "src/index\\.ts$", "src/layout\\.ts$", "src/git\\.ts$"],
      },
      to: {},
    },
    {
      name: "core-not-to-adapters",
      severity: "error",
      comment: "Engine core must not depend on HTML, UI, CLI, or git adapters",
      from: { path: "^src/core/" },
      to: { path: "^src/(render|ui|cli|git)(/|$)" },
    },
    {
      name: "text-not-to-adapters",
      severity: "error",
      comment: "Text utilities must not depend on HTML render shell, UI, CLI, or git",
      from: { path: "^src/text/" },
      to: { path: "^src/(render|ui|cli|git)(/|$)" },
    },
    {
      name: "model-not-to-adapters",
      severity: "error",
      comment: "Serializable model must not depend on presentation or CLI",
      from: { path: "^src/model/" },
      to: { path: "^src/(render|ui|cli|git|html)(/|$)" },
    },
    {
      name: "layout-not-to-adapters",
      severity: "error",
      comment: "Layout planning is host-agnostic — no HTML/UI/CLI/git",
      from: { path: "^src/layout/" },
      to: { path: "^src/(render|ui|cli|git)(/|$)" },
    },
    {
      name: "api-not-to-cli-ui-git",
      severity: "error",
      comment: "Public engine API must not pull CLI, UI shell, or git",
      from: { path: "^src/(api|index)\\.ts$" },
      to: { path: "^src/(cli|ui|git)(/|$)" },
    },
    {
      name: "ui-not-to-cli",
      severity: "error",
      comment: "Standalone UI must not import CLI",
      from: { path: "^src/ui/" },
      to: { path: "^src/cli/" },
    },
    {
      name: "core-not-to-html-module",
      severity: "error",
      comment: "Core must use text/protect for markdown protection, not text/html",
      from: { path: "^src/core/" },
      to: { path: "^src/text/html\\.ts$" },
    },
    {
      name: "browser-entry-no-node-builtins",
      severity: "error",
      comment: "Library entry graph must not import Node builtins (git/cli only)",
      from: { path: "^src/(index|api|config|layout|model|core|text|debug|layout\\.ts)\\." },
      to: { path: "^node:" },
      // pathNot on `from` would be better but depcruise matches resolved module names
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
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/(@[^/]+/[^/]+|[^/]+)",
      },
      text: {
        highlightFocused: true,
      },
    },
  },
};
