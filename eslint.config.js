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
  prettier
);
