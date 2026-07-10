/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupRustUiCore.ts"],
  modulePathIgnorePatterns: [
    "<rootDir>/src/generated/v7_ui_core/package.json",
    "<rootDir>/src/generated/v7_ui_core_node/package.json"
  ],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.jest.json" }]
  }
};
