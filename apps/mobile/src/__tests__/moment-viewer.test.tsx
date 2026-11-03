import { fireEvent, render, screen } from "@testing-library/react-native";
import { eq } from "drizzle-orm";
import MomentPhotos from "@/app/moment/[id]";
import { momentPhotos } from "@/db/schema";
import { MomentsProvider } from "@/moments";
import { createTestDb, seedMoments } from "@/test-utils/db";

let mockParams: { id: string; photo?: string } = { id: "" };
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

// Thu 1 Oct 2026, 09:30 UTC (tests run in UTC)
const moment = {
  text: "Ramen with Ana",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

async function renderViewer(
  seed: Parameters<typeof seedMoments>[1][number],
  { openAt = 0, onItsWay = [] as number[] } = {},
) {
  const db = createTestDb();
  const [stored] = seedMoments(db, [seed]);
  for (const i of onItsWay) {
    db.update(momentPhotos)
      .set({ fileName: null, uploadState: "remote" })
      .where(eq(momentPhotos.id, stored.photos![i].id))
      .run();
  }
  mockParams = { id: stored.id, photo: stored.photos![openAt].id };
  await render(
    <MomentsProvider db={db}>
      <MomentPhotos />
    </MomentsProvider>,
  );
}

describe("Photo viewer caption", () => {
  it("shows 'Kind · date' for a moment with a kind", async () => {
    await renderViewer({ ...moment, kind: "meal" });

    expect(await screen.findByText("Meal · Thu 1 Oct")).toBeOnTheScreen();
  });

  it("shows only the date for a moment without a kind", async () => {
    await renderViewer(moment);

    expect(await screen.findByText("Thu 1 Oct")).toBeOnTheScreen();
  });
});

describe("Photo viewer", () => {
  const walk = {
    text: "Walk",
    photos: ["1-a.jpg", "1-b.jpg", "1-c.jpg"],
    createdAt: Date.UTC(2026, 9, 1, 9, 30),
  };
  const shown = () =>
    screen.container
      .queryAll((node) => node.type === "Image")
      .map((image) => (image.props.source as { uri: string }).uri);

  it("shows the photos that are here, leaving out those on their way", async () => {
    await renderViewer(walk, { onItsWay: [1] });
    // The photos appear once their area has a size
    const [area] = screen.container.queryAll((node) =>
      Boolean(node.props.onLayout),
    );
    await fireEvent(area, "layout", {
      nativeEvent: { layout: { width: 390, height: 700 } },
    });

    expect(shown()).toEqual([
      expect.stringMatching(/photos\/1-a\.jpg$/),
      expect.stringMatching(/photos\/1-c\.jpg$/),
    ]);
  });
});
