import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import MomentPhotos from "@/app/moment/[id]";
import { MomentsProvider, type Moment } from "@/moments";

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: "1", photo: "1-a.jpg" }),
}));

// Thu 1 Oct 2026, 09:30 UTC (tests run in UTC)
const moment: Moment = {
  id: "1",
  text: "Ramen with Ana",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

async function renderViewer(stored: Moment) {
  await AsyncStorage.setItem("savor.moments", JSON.stringify([stored]));
  await render(
    <MomentsProvider>
      <MomentPhotos />
    </MomentsProvider>,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

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
