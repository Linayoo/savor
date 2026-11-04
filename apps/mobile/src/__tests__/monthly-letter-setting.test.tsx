import {
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from "@testing-library/react-native";
import { router } from "expo-router";
import type { ComponentType } from "react";
import { AccountProvider } from "@/account";
import Account from "@/app/account/index";
import MonthlyLetter from "@/app/account/monthly-letter";
import { LettersProvider } from "@/letters/provider";
import { deviceTimeZone } from "@/letters/time-zone";
import { createTestDb } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock("@/auth/auth", () => ({}));
jest.mock("@/letters/time-zone", () => ({
  deviceTimeZone: jest.fn(() => "Europe/Zurich"),
}));

const ana = { email: "ana@example.com", password: "x", userId: "sub-ana" };
let server: FakeSyncServer;

async function renderScreen(Screen: ComponentType, { signedIn = true } = {}) {
  await render(
    <AccountProvider
      db={createTestDb()}
      auth={fakeAuth({
        users: [ana],
        signedIn: signedIn ? { userId: ana.userId, email: ana.email } : null,
      })}
    >
      <LettersProvider
        db={createTestDb()}
        createApi={() => server.lettersApi(ana.userId)}
      >
        <Screen />
      </LettersProvider>
    </AccountProvider>,
  );
  return userEvent.setup();
}

const letterSwitch = () =>
  screen.findByRole("switch", { name: "Monthly letter" });

beforeEach(() => {
  server = new FakeSyncServer();
  jest.clearAllMocks();
});

describe("Account screen: monthly letter", () => {
  it("shows the switch off when signed in", async () => {
    await renderScreen(Account);

    const toggle = await letterSwitch();
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveProp("value", false);
  });

  it("explains first instead of turning letters on", async () => {
    await renderScreen(Account);
    const toggle = await letterSwitch();
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent(toggle, "valueChange", true);

    expect(router.push).toHaveBeenCalledWith("/account/monthly-letter");
    expect(server.letterSettingsOf(ana.userId).enabled).toBe(false);
  });

  it("turns letters off at once, keeping the time zone", async () => {
    await server
      .lettersApi(ana.userId)
      .setSettings({ enabled: true, timeZone: "Asia/Tokyo" });
    await renderScreen(Account);
    const toggle = await letterSwitch();
    await waitFor(() => expect(toggle).toHaveProp("value", true));

    fireEvent(toggle, "valueChange", false);

    await waitFor(() =>
      expect(server.letterSettingsOf(ana.userId)).toEqual({
        enabled: false,
        timeZone: "Asia/Tokyo",
      }),
    );
    expect(await letterSwitch()).toHaveProp("value", false);
  });

  it("says so when turning letters off fails, and stays on", async () => {
    await server
      .lettersApi(ana.userId)
      .setSettings({ enabled: true, timeZone: "Asia/Tokyo" });
    await renderScreen(Account);
    const toggle = await letterSwitch();
    await waitFor(() => expect(toggle).toHaveProp("value", true));
    server.failNext("setLetterSettings");

    fireEvent(toggle, "valueChange", false);

    expect(
      await screen.findByText("Couldn't change the monthly letter. Try again."),
    ).toBeOnTheScreen();
    expect(await letterSwitch()).toHaveProp("value", true);
  });

  it("waits to show the switch until the setting is known", async () => {
    server.failNext("getLetterSettings");

    await renderScreen(Account);

    expect(await letterSwitch()).toBeDisabled();
  });

  it("isn't offered when signed out", async () => {
    await renderScreen(Account, { signedIn: false });

    await screen.findByText("Keep your moments safe and on all your devices.");
    expect(screen.queryByRole("switch", { name: "Monthly letter" })).toBeNull();
  });
});

describe("Monthly letter explanation", () => {
  it("says what is sent, to whom, and what isn't", async () => {
    await renderScreen(MonthlyLetter);

    expect(
      await screen.findByText(
        "Once a month, Savor writes you a short letter from that month's moments.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "To write it, the words, kinds and dates of that month's moments are sent to an AI model: Claude, through Amazon Bedrock in the EU. Photos and account details are not.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText("You can turn it off any time.")).toBeOnTheScreen();
  });

  it("turns letters on with the phone's time zone only on Turn on", async () => {
    const user = await renderScreen(MonthlyLetter);
    await waitFor(() =>
      expect(server.letterSettingsOf(ana.userId).enabled).toBe(false),
    );

    await user.press(await screen.findByRole("button", { name: "Turn on" }));

    expect(server.letterSettingsOf(ana.userId)).toEqual({
      enabled: true,
      timeZone: "Europe/Zurich",
    });
    expect(router.back).toHaveBeenCalled();
  });

  it("changes nothing on Not now", async () => {
    const user = await renderScreen(MonthlyLetter);

    await user.press(await screen.findByRole("button", { name: "Not now" }));

    expect(router.back).toHaveBeenCalled();
    expect(server.letterSettingsOf(ana.userId).enabled).toBe(false);
  });

  it("stays when letters can't be turned on, and says so", async () => {
    const user = await renderScreen(MonthlyLetter);
    server.failNext("setLetterSettings");

    await user.press(await screen.findByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText(
        "Couldn't turn it on. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("doesn't turn letters on without the phone's time zone", async () => {
    jest.mocked(deviceTimeZone).mockReturnValueOnce(null);
    const user = await renderScreen(MonthlyLetter);

    await user.press(await screen.findByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText("Couldn't read this phone's time zone."),
    ).toBeOnTheScreen();
    expect(server.letterSettingsOf(ana.userId).enabled).toBe(false);
  });
});
