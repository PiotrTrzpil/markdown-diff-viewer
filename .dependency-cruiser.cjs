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
      comment: "Modules should be reachable from the entry point",
      from: {
        orphan: true,
        pathNot: [
          "\\.test\\.ts$",
          "\\.d\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "ui-cannot-import-cli",
      severity: "error",
      comment: "UI modules should not import CLI-specific code",
      from: {
        path: "^src/ui/",
      },
      to: {
        path: "^src/cli\\.ts$",
      },
    },
    {
      name: "utils-are-standalone",
      severity: "warn",
      comment: "Utility modules should not depend on higher-level modules",
      from: {
        path: "^src/(tokens|stopwords|html|config|lcs|similarity)\\.ts$",
      },
      to: {
        path: "^src/(diff|render|cli)\\.ts$",
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
