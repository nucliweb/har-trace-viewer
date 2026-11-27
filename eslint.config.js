import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-site/**",
      "**/node_modules/**",
      "e2e/.output/**",
      "playwright-report/**",
      "test-results/**",
      "packages/core/tests/fixtures/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      // Non-null assertions are used deliberately for narrowed lookups in tests and DOM access.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // The terminal UI is React (Ink): its hooks follow the same rules as the web app.
    files: ["packages/cli/**/*.tsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    // Rules that need type information: the .mjs scripts are in no TypeScript project and skip them.
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        // projectService only looks at the nearest tsconfig.json, which in each package leaves the
        // tests and config files (tsconfig.node.json) out; listing every project covers them all.
        project: ["packages/*/tsconfig.json", "packages/*/tsconfig.node.json", "e2e/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  prettier
);
