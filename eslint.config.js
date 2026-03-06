import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

const noRawSqlPlugin = {
  rules: {
    "no-raw-sql": {
      meta: { type: "problem" },
      create(context) {
        const SQL_PATTERN =
          /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/i;
        function check(node, value) {
          if (SQL_PATTERN.test(value)) {
            context.report({
              node,
              message:
                "Raw SQL is forbidden in the SDK layer. Use dialect.buildXxx() methods instead.",
            });
          }
        }
        return {
          TemplateLiteral(node) {
            check(node, node.quasis.map((q) => q.value.raw).join(""));
          },
          Literal(node) {
            if (typeof node.value === "string") check(node, node.value);
          },
        };
      },
    },
  },
};

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript-specific rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "none",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",

      // General rules
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      "no-unused-vars": "off", // Disable base rule as TypeScript handles it
    },
  },
  {
    // Allow console statements in test files
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Intentionally SDK-only: db-adapter and dialect packages use raw SQL by design
    files: ["packages/sdk/src/**/*.ts"],
    ignores: ["**/__tests__/**", "**/*.test.ts"],
    plugins: { custom: noRawSqlPlugin },
    rules: { "custom/no-raw-sql": "error" },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
];
