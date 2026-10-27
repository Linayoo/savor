import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { createDb } from "../src/db/client";
import { TEST_DATABASE_URL } from "./env";

// One pool per test file, closed when the file is done
export function testDb() {
  const { db, close } = createDb(TEST_DATABASE_URL);
  afterAll(close);
  return db;
}

// A user no other test touches
export const newUserId = () => `user-${randomUUID()}`;
