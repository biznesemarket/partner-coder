import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.superpowers/**",
      "apps/ide-extension/out/**",
      "apps/api/src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"],
    plugins: nextPlugin.configs["core-web-vitals"].plugins,
    rules: nextPlugin.configs["core-web-vitals"].rules,
    settings: {
      next: {
        rootDir: "apps/web",
      },
    },
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    files: ["packages/ui/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/[А-Яа-яЁё]/]",
          message: "Пользовательские строки — в apps/web/src/lib/messages.ts",
        },
        {
          selector: "JSXText[value=/[А-Яа-яЁё]/]",
          message: "Пользовательские строки — в apps/web/src/lib/messages.ts",
        },
        {
          selector: "TemplateElement[value.raw=/[А-Яа-яЁё]/]",
          message: "Пользовательские строки — в apps/web/src/lib/messages.ts",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.test.ts", "packages/testing/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
