import {
  clearLetters,
  getLetter,
  listLetters,
  replaceLetters,
} from "@/db/letters-store";
import { createTestDb } from "@/test-utils/db";

const letter = (month: string, body = `Letter for ${month}`) => ({
  id: `letter-${month}`,
  month,
  body,
  createdAt: 1,
});

describe("the letters cache", () => {
  it("lists letters newest month first", () => {
    const db = createTestDb();
    replaceLetters(db, [
      letter("2026-09"),
      letter("2026-10"),
      letter("2025-12"),
    ]);

    expect(listLetters(db).map((l) => l.month)).toEqual([
      "2026-10",
      "2026-09",
      "2025-12",
    ]);
  });

  it("is replaced as a whole by the server's letters", () => {
    const db = createTestDb();
    replaceLetters(db, [letter("2026-09"), letter("2026-10")]);

    replaceLetters(db, [letter("2026-10", "Rewritten"), letter("2026-11")]);

    expect(listLetters(db)).toEqual([
      letter("2026-11"),
      letter("2026-10", "Rewritten"),
    ]);
  });

  it("finds one letter by id", () => {
    const db = createTestDb();
    replaceLetters(db, [letter("2026-10")]);

    expect(getLetter(db, "letter-2026-10")).toEqual(letter("2026-10"));
    expect(getLetter(db, "letter-2030-01")).toBeNull();
  });

  it("is emptied on sign-out", () => {
    const db = createTestDb();
    replaceLetters(db, [letter("2026-10")]);

    clearLetters(db);

    expect(listLetters(db)).toEqual([]);
  });
});
