export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "release", "sdk", "react", "core", "customer", "product", "category", "cart", "auth", "http", "logger", "deps", "docs", "examples"]
    ]
  }
};
