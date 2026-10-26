import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  render,
  screen,
  userEvent,
  within,
} from "@testing-library/react-native";
import Index from "@/app/(tabs)/index";
import { MomentsProvider, type Moment } from "@/moments";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

// Thu 1 Oct 2026, 09:30 UTC (tests run in UTC), stored before kinds existed
const oldMoment: Moment = {
  id: "1",
  text: "Rain on the window",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

async function renderScreen(stored?: Moment[]) {
  await AsyncStorage.clear();
  if (stored) {
    await AsyncStorage.setItem("savor.moments", JSON.stringify(stored));
  }
  await render(
    <MomentsProvider>
      <Index />
    </MomentsProvider>,
  );
  return userEvent.setup();
}

const input = () => screen.getByPlaceholderText("What moved you just now?");
const chip = (name: string) => screen.getByRole("button", { name });

describe("Moments screen: keeping a moment", () => {
  it("clears the text and the kind after Keep", async () => {
    const user = await renderScreen();

    await user.type(input(), "Ramen with Ana");
    await user.press(chip("Meal"));
    await user.press(screen.getByText("Keep"));

    expect(await screen.findByText("Ramen with Ana")).toBeOnTheScreen();
    expect(input()).toHaveDisplayValue("");
    expect(chip("Meal")).not.toBeSelected();
  });
});

describe("Moments screen: timeline", () => {
  it("shows the kind's icon and 'Kind · date' for a moment kept with a kind", async () => {
    const user = await renderScreen();

    await user.type(input(), "Ramen with Ana");
    await user.press(chip("Meal"));
    await user.press(screen.getByText("Keep"));

    await screen.findByText("Ramen with Ana");
    const list = within(screen.getByTestId("timeline"));
    expect(list.getByTestId("icon-restaurant-outline")).toBeOnTheScreen();
    expect(list.getByText(/^Meal · \w{3} \d{1,2} \w{3}$/)).toBeOnTheScreen();
  });

  it("shows a sparkle and only the date for a moment kept without a kind", async () => {
    const user = await renderScreen();

    await user.type(input(), "A quiet morning");
    await user.press(screen.getByText("Keep"));

    await screen.findByText("A quiet morning");
    const list = within(screen.getByTestId("timeline"));
    expect(list.getByTestId("icon-sparkles-outline")).toBeOnTheScreen();
    expect(list.getByText(/^\w{3} \d{1,2} \w{3}$/)).toBeOnTheScreen();
  });

  it("shows a sparkle and only the date for a moment stored before kinds", async () => {
    await renderScreen([oldMoment]);

    await screen.findByText("Rain on the window");
    const list = within(screen.getByTestId("timeline"));
    expect(list.getByTestId("icon-sparkles-outline")).toBeOnTheScreen();
    expect(list.getByText("Thu 1 Oct")).toBeOnTheScreen();
  });
});
