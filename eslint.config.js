import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";

const sourceFiles = ["src/**/*.{js,jsx}"];
const testFiles = ["src/**/*.test.{js,jsx}"];

export default [
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "output/**",
      "public/**",
      "SampleDocuments/**",
    ],
  },
  js.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      security,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      ...security.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react/prop-types": "off",
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Tests intentionally resolve fixture paths before checking and reading them.
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    files: ["src/dashboard.js"],
    rules: {
      // escapeHtml indexes a closed, locally declared entity map with regex-matched characters.
      "security/detect-object-injection": "off",
    },
  },
  {
    files: ["eslint.config.js", "vite.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
