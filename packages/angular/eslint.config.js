import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsparser },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports — use named exports." },
        {
          selector: "Decorator",
          message:
            "No decorators in this package. Decorators require the Angular compiler, and this package is built with tsup precisely because it has none. See docs/superpowers/specs/2026-08-25-angular-package-design.md.",
        },
      ],
    },
  },
];
