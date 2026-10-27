import { act, renderHook } from "@testing-library/react-native";
import { File } from "expo-file-system";
import type { ReactNode } from "react";
import { listMoments } from "@/db/moments-store";
import { momentPhotos, moments as momentRows } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { createTestDb, seedMoments } from "@/test-utils/db";
import { MomentsProvider, useMoments } from "../moments";

const rain = {
  text: "Rain on the window",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

async function renderMoments(db: AppDb) {
  return renderHook(() => useMoments(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MomentsProvider db={db}>{children}</MomentsProvider>
    ),
  });
}

describe("addMoment", () => {
  it("keeps the kind when one is chosen", async () => {
    const db = createTestDb();
    const { result } = await renderMoments(db);

    await act(() => result.current.addMoment("Ramen", [], "meal"));

    expect(result.current.moments).toEqual([
      expect.objectContaining({ text: "Ramen", kind: "meal" }),
    ]);
    expect(listMoments(db)[0].kind).toBe("meal");
  });

  it("keeps a moment without a kind", async () => {
    const db = createTestDb();
    const { result } = await renderMoments(db);

    await act(() => result.current.addMoment("A quiet morning", []));

    expect(result.current.moments).toHaveLength(1);
    expect(result.current.moments[0]).not.toHaveProperty("kind");
  });
});

describe("updateMoment", () => {
  it("sets a kind and leaves the photos alone", async () => {
    const db = createTestDb();
    const [moment] = seedMoments(db, [rain]);
    const { result } = await renderMoments(db);

    await act(() =>
      result.current.updateMoment(moment.id, "Rain on the window", "book"),
    );

    expect(result.current.moments).toEqual([{ ...moment, kind: "book" }]);
  });

  it("changes the text and the kind together", async () => {
    const db = createTestDb();
    const [moment] = seedMoments(db, [{ ...rain, kind: "meal" }]);
    const { result } = await renderMoments(db);

    await act(() => result.current.updateMoment(moment.id, "Soup", "friends"));

    expect(result.current.moments[0]).toMatchObject({
      text: "Soup",
      kind: "friends",
    });
  });

  it("clears the kind when none is passed", async () => {
    const db = createTestDb();
    const [moment] = seedMoments(db, [{ ...rain, kind: "meal" }]);
    const { result } = await renderMoments(db);

    await act(() => result.current.updateMoment(moment.id, rain.text));

    expect(result.current.moments[0]).not.toHaveProperty("kind");
    expect(listMoments(db)[0]).not.toHaveProperty("kind");
  });
});

describe("deleteMoment", () => {
  afterEach(() => jest.restoreAllMocks());

  it("hides the moment, keeps its rows marked deleted and removes its photo files", async () => {
    const db = createTestDb();
    const [kept, gone] = seedMoments(db, [
      { text: "kept", createdAt: rain.createdAt + 1 },
      {
        text: "gone",
        photos: ["9-a.jpg", "file:///tmp/old.jpg"],
        createdAt: rain.createdAt,
      },
    ]);
    jest.spyOn(File.prototype, "exists", "get").mockReturnValue(true);
    const deleted: string[] = [];
    jest.spyOn(File.prototype, "delete").mockImplementation(function (
      this: File,
    ) {
      deleted.push(this.uri);
    });
    const { result } = await renderMoments(db);

    await act(() => result.current.deleteMoment(gone.id));

    expect(result.current.moments.map((m) => m.id)).toEqual([kept.id]);
    expect(
      db
        .select()
        .from(momentRows)
        .all()
        .find((m) => m.id === gone.id)?.deletedAt,
    ).not.toBeNull();
    expect(
      db
        .select()
        .from(momentPhotos)
        .all()
        .every((p) => p.deletedAt !== null),
    ).toBe(true);
    // Only the photo in our folder; old temporary photos aren't ours
    expect(deleted).toEqual([expect.stringMatching(/photos\/9-a\.jpg$/)]);
  });
});

describe("loading", () => {
  it("lists the moments in the database, newest first", async () => {
    const db = createTestDb();
    const [older, newer] = seedMoments(db, [
      rain,
      { text: "Later", createdAt: rain.createdAt + 1000 },
    ]);

    const { result } = await renderMoments(db);

    expect(result.current.moments).toEqual([newer, older]);
  });
});
