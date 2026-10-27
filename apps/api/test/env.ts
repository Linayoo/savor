// The test database from docker-compose.yml; CI sets its own
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://savor:savor@localhost:5433/savor_test";

// The test database refuses to write a moment with this text (global-setup.ts)
export const FAILING_TEXT = "[test] fail this write";
