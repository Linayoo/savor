import { render, screen } from "@testing-library/react-native";
import MomentPhotos from "@/app/moment/[id]";
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

async function renderViewer(seed: Parameters<typeof seedMoments>[1][number]) {
  const db = createTestDb();
  const [stored] = seedMoments(db, [seed]);
  mockParams = { id: stored.id, photo: "1-a.jpg" };
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
