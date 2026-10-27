// The test database from docker-compose.yml; CI sets its own
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://savor:savor@localhost:5433/savor_test";
