export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "release", "sdk", "react", "core", "customer", "product", "category", "cart", "checkout", "payment", "price", "media", "segment", "auth", "http", "logger", "deps", "docs", "examples"]
    ]
  }
};
