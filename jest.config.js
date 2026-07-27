/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  setupFiles: ["reflect-metadata"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts"],
  // Lock in the HTTP integration coverage (issue #39) so route/auth regressions
  // are caught. Thresholds sit just below the measured values; raise them as
  // more flows are covered. Only enforced under `--coverage` (npm run test:coverage).
  coverageThreshold: {
    global: { statements: 48, branches: 30, functions: 48, lines: 48 },
    "./src/routes/": { statements: 28, lines: 28 },
    "./src/auth/": { statements: 45, lines: 45 },
    "./src/http/": { statements: 90, lines: 90 },
  },
};
