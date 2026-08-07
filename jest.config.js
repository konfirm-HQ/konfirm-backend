/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
  setupFiles: ['<rootDir>/test/env.ts'],
  // @stellar/stellar-sdk pulls in multiple transitive deps that ship
  // ESM-only files even under their "require" export condition
  // (@noble/hashes, uint8array-extras, possibly more) — Jest's default CJS
  // transform chokes on bare `import` syntax. Rather than chase each one by
  // name, transform all of node_modules; this test suite is small enough
  // that the extra transform cost doesn't matter.
  transformIgnorePatterns: [],
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  // Integration/E2E specs share one real Postgres connection pool and must
  // not run concurrently against it — collisions on unique constraints
  // (email, muxed_id) would produce flaky failures that have nothing to do
  // with real bugs.
  maxWorkers: 1,
  // The critical-path e2e spec makes real calls to Horizon and shells out
  // to the `stellar` CLI for compliance checks — both genuine network I/O,
  // not mocked, so the default 5s is too tight.
  testTimeout: 20_000,
};
