import {
  render,
  screen,
  userEvent,
  within,
} from "@testing-library/react-native";
import { eq } from "drizzle-orm";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { ActionSheetIOS } from "react-native";
import Index from "@/app/(tabs)/index";
import { listMoments } from "@/db/moments-store";
import { momentPhotos } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { MomentsProvider } from "@/moments";
import { createTestDb, photosNamed, seedMoments } from "@/test-utils/db";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
}));
// Keeps the picked photo's file name instead of copying the file
jest.mock("@/photos", () => ({
  ...jest.requireActual("@/photos"),
  savePhoto: (uri: string) => uri.split("/").pop(),
}));

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

// After changing the database underneath the screen
async function renderAgain() {
  await render(
    <MomentsProvider db={db}>
      <Index />
    </MomentsProvider>,
  );
}

beforeEach(() => jest.mocked(router.push).mockClear());

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

describe("Moments screen: adding photos", () => {
  // The camera button opens the iOS action sheet; the test picks the option
  let option = 0;
  beforeEach(() => {
    jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((_options, callback) => callback(option));
  });

  const asset = (id: string, assetId: string | null = id) => ({
    uri: `file:///tmp/picker/${id}.jpg`,
    assetId,
    width: 1,
    height: 1,
  });

  async function chooseFromLibrary(
    user: ReturnType<typeof userEvent.setup>,
    assets: ReturnType<typeof asset>[],
  ) {
    option = 2;
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValueOnce({ canceled: false, assets });
    await user.press(screen.getByLabelText("Add photos"));
  }

  async function takePhoto(
    user: ReturnType<typeof userEvent.setup>,
    id: string,
  ) {
    option = 1;
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce({ canceled: false, assets: [asset(id, null)] });
    await user.press(screen.getByLabelText("Add photos"));
  }

  const draftPhotos = () => screen.queryAllByLabelText("Remove photo");

  it("ignores library photos already in the draft", async () => {
    const user = await renderScreen();

    await chooseFromLibrary(user, [asset("a"), asset("b")]);
    await chooseFromLibrary(user, [asset("b"), asset("c")]);

    expect(draftPhotos()).toHaveLength(3);
    await user.press(screen.getByText("Keep"));
    expect(listMoments(db)[0].photos!.map((p) => p.fileName)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("adds a photo again after it's removed from the draft", async () => {
    const user = await renderScreen();

    await chooseFromLibrary(user, [asset("a"), asset("b")]);
    await user.press(draftPhotos()[1]);
    expect(draftPhotos()).toHaveLength(1);
    await chooseFromLibrary(user, [asset("b")]);

    expect(draftPhotos()).toHaveLength(2);
  });

  it("adds library photos without an asset id, and every camera photo", async () => {
    const user = await renderScreen();

    await chooseFromLibrary(user, [asset("a", null)]);
    await chooseFromLibrary(user, [asset("b", null)]);
    await takePhoto(user, "c");
    await takePhoto(user, "d");

    expect(draftPhotos()).toHaveLength(4);
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
      {
        ...oldMoment,
        id: expect.any(String),
        kind: "book",
        photos: photosNamed("1-a.jpg"),
      },
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

describe("Moments screen: photos from another device", () => {
  // As a pulled photo is before its file arrives
  const onItsWay = (fileName: string) =>
    db
      .update(momentPhotos)
      .set({ fileName: null, uploadState: "remote" })
      .where(eq(momentPhotos.fileName, fileName))
      .run();

  it("shows a soft tile in place of a photo still on its way, which doesn't open", async () => {
    const user = await renderScreen([
      { ...oldMoment, photos: ["1-a.jpg", "1-b.jpg"] },
    ]);
    onItsWay("1-b.jpg");
    await renderAgain();

    const photos = screen.getAllByLabelText(/^(Open photo|Photo on its way)$/);
    expect(photos.map((p) => p.props.accessibilityLabel)).toEqual([
      "Open photo",
      "Photo on its way",
    ]);
    await user.press(screen.getByLabelText("Photo on its way"));
    expect(router.push).not.toHaveBeenCalled();

    await user.press(screen.getByLabelText("Open photo"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/moment/[id]",
      params: {
        id: listMoments(db)[0].id,
        photo: listMoments(db)[0].photos![0].id,
      },
    });
  });
});
