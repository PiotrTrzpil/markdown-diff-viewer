import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginUnusedImports from "eslint-plugin-unused-imports";
import pluginImport from "eslint-plugin-import";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "unused-imports": pluginUnusedImports,
      import: pluginImport,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // ─── Formatting ────────────────────────────────────────────────────────
      semi: ["error", "always"],
      quotes: ["error", "double", { avoidEscape: true }],
      indent: ["error", 2, { SwitchCase: 1 }],
      "comma-dangle": ["error", "always-multiline"],
      "no-trailing-spaces": "error",
      "eol-last": ["error", "always"],

      // ─── Complexity Limits ─────────────────────────────────────────────────
      complexity: ["warn", { max: 60 }],
      "max-depth": ["warn", { max: 5 }],
      "max-lines": [
        "warn",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "warn",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      "max-len": [
        "warn",
        {
          code: 120,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
      "max-params": ["warn", { max: 7 }],
      "max-nested-callbacks": ["warn", { max: 3 }],

      // ─── Bug Prevention ────────────────────────────────────────────────────
      eqeqeq: ["warn", "smart"],
      "no-throw-literal": "error",
      "no-self-compare": "error",
      "no-template-curly-in-string": "warn",
      "no-unused-expressions": "error",
      "no-console": "off",
      "prefer-const": "error",
      "no-var": "error",

      // ─── Unused Imports ────────────────────────────────────────────────────
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      // ─── Import Rules ──────────────────────────────────────────────────────
      "import/no-cycle": ["error", { maxDepth: 5 }],
      "import/no-self-import": "error",
      "import/no-duplicates": "error",

      // ─── TypeScript Specific ───────────────────────────────────────────────
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Override for test files - allow more flexibility
    files: ["**/*.test.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Ignore patterns
    ignores: ["dist/**", "node_modules/**", "*.js", "*.cjs", "*.mjs"],
  }
);
