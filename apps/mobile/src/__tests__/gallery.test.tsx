import { render, screen } from "@testing-library/react-native";
import { eq } from "drizzle-orm";
import Gallery from "@/app/(tabs)/gallery";
import { momentPhotos } from "@/db/schema";
import { MomentsProvider } from "@/moments";
import { createTestDb, seedMoments } from "@/test-utils/db";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

describe("Gallery", () => {
  it("shows the photos that are here, like photos taken on this phone, and leaves out those on their way", async () => {
    const db = createTestDb();
    seedMoments(db, [
      {
        text: "Walk",
        photos: ["1-a.jpg", "1-b.jpg"],
        createdAt: Date.UTC(2026, 9, 1, 9, 30),
      },
    ]);
    // A downloaded photo, and one still on its way
    db.update(momentPhotos)
      .set({ fileName: "photo-a.jpg", uploadState: "uploaded" })
      .where(eq(momentPhotos.fileName, "1-a.jpg"))
      .run();
    db.update(momentPhotos)
      .set({ fileName: null, uploadState: "remote" })
      .where(eq(momentPhotos.fileName, "1-b.jpg"))
      .run();

    await render(
      <MomentsProvider db={db}>
        <Gallery />
      </MomentsProvider>,
    );

    expect(
      screen.container
        .queryAll((node) => node.type === "Image")
        .map((image) => (image.props.source as { uri: string }).uri),
    ).toEqual([expect.stringMatching(/photos\/photo-a\.jpg$/)]);
  });
});
