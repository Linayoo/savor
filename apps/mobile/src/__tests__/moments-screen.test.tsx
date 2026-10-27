import {
  render,
  screen,
  userEvent,
  within,
} from "@testing-library/react-native";
import { ActionSheetIOS } from "react-native";
import Index from "@/app/(tabs)/index";
import { listMoments } from "@/db/moments-store";
import type { AppDb } from "@/db/types";
import { MomentsProvider } from "@/moments";
import { createTestDb, seedMoments } from "@/test-utils/db";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

// Thu 1 Oct 2026, 09:30 UTC (tests run in UTC), stored before kinds existed
const oldMoment = {
  text: "Rain on the window",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

let db: AppDb;

async function renderScreen(stored: Parameters<typeof seedMoments>[1] = []) {
  db = createTestDb();
  seedMoments(db, stored);
  await render(
    <MomentsProvider db={db}>
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

describe("Moments screen: editing a moment", () => {
  let menuOptions: string[] = [];

  // Long-press opens the iOS action sheet; choose "Edit moment" (index 1)
  beforeEach(() => {
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((options, callback) => {
        menuOptions = options.options;
        callback(1);
      });
  });

  async function startEditing(text: string) {
    const user = userEvent.setup();
    await user.longPress(await screen.findByText(text));
    return user;
  }

  it("calls the menu option 'Edit moment'", async () => {
    await renderScreen([oldMoment]);
    await startEditing("Rain on the window");

    expect(menuOptions).toContain("Edit moment");
    expect(menuOptions).not.toContain("Edit words");
  });

  it("loads the moment's text and kind into the card", async () => {
    await renderScreen([{ ...oldMoment, kind: "nature" }]);
    await startEditing("Rain on the window");

    expect(input()).toHaveDisplayValue("Rain on the window");
    expect(chip("Nature")).toBeSelected();
  });

  it("saves a new kind, keeping the text and photos", async () => {
    await renderScreen([oldMoment]);
    const user = await startEditing("Rain on the window");

    await user.press(chip("Book"));
    await user.press(screen.getByText("Save"));

    const list = within(screen.getByTestId("timeline"));
    expect(await list.findByText("Book · Thu 1 Oct")).toBeOnTheScreen();
    expect(list.getByTestId("icon-book-outline")).toBeOnTheScreen();
    expect(list.getByText("Rain on the window")).toBeOnTheScreen();
    expect(listMoments(db)).toEqual([
      { ...oldMoment, id: expect.any(String), kind: "book" },
    ]);
  });

  it("clears the kind when it's unselected before saving", async () => {
    await renderScreen([{ ...oldMoment, kind: "meal" }]);
    const user = await startEditing("Rain on the window");

    await user.press(chip("Meal"));
    await user.press(screen.getByText("Save"));

    const list = within(screen.getByTestId("timeline"));
    expect(await list.findByText("Thu 1 Oct")).toBeOnTheScreen();
    expect(list.getByTestId("icon-sparkles-outline")).toBeOnTheScreen();
    expect(listMoments(db)[0]).not.toHaveProperty("kind");
  });

  it("restores an empty card with no kind on Cancel", async () => {
    await renderScreen([{ ...oldMoment, kind: "meal" }]);
    const user = await startEditing("Rain on the window");

    await user.press(screen.getByText("Cancel"));

    expect(input()).toHaveDisplayValue("");
    expect(chip("Meal")).not.toBeSelected();
    expect(screen.getByText("Keep")).toBeOnTheScreen();
  });
});
