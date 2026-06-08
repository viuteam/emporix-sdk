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
      ],
    },
  },
  {
    // Build-time tooling + CLI legitimately log to stdout/stderr.
    files: ["src/cli.ts", "src/codegen/**/*.ts"],
    rules: { "no-console": "off" },
  },
];
