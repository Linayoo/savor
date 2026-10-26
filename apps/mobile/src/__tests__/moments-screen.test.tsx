import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen, userEvent } from "@testing-library/react-native";
import Index from "@/app/(tabs)/index";
import { MomentsProvider, type Moment } from "@/moments";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

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
