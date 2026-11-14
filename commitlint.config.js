export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [0, "always"],
    "scope-case": [2, "always", "lower-case"],
    "subject-case": [0, "always"],
  },
};
