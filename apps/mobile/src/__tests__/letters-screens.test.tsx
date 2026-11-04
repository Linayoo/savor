import { render, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ComponentType } from "react";
import { AccountProvider } from "@/account";
import Letters from "@/app/(tabs)/letters";
import LetterScreen from "@/app/letter/[id]";
import { replaceLetters } from "@/db/letters-store";
import type { AppDb } from "@/db/types";
import { monthName } from "@/letters/month";
import { LettersProvider } from "@/letters/provider";
import { createTestDb } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => mockParams,
    // Runs once, as when the tab first comes into view
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock("@/auth/auth", () => ({}));

const ana = { email: "ana@example.com", password: "x", userId: "sub-ana" };

const october = {
  id: "0b6f8f4e-7d7a-4f7e-9d43-5a1e2c3b4d5f",
  month: "2026-10",
  body: "Dear you,\n\nRamen with Ana, and fog on the lake.\n\nSavor",
  createdAt: Date.UTC(2026, 10, 1, 7),
};
const september = {
  id: "1c7f9f5e-8e8b-4f8e-8e54-6b2f3d4c5e6a",
  month: "2026-09",
  body: "Dear you, September.\n\nSavor",
  createdAt: Date.UTC(2026, 9, 1, 7),
};

let db: AppDb;
let server: FakeSyncServer;

async function renderScreen(
  Screen: ComponentType,
  { signedIn = true, cached = [] as (typeof october)[] } = {},
) {
  db = createTestDb();
  replaceLetters(db, cached);
  await render(
    <AccountProvider
      db={db}
      auth={fakeAuth({
        users: [ana],
        signedIn: signedIn ? { userId: ana.userId, email: ana.email } : null,
      })}
    >
      <LettersProvider db={db} createApi={() => server.lettersApi(ana.userId)}>
        <Screen />
      </LettersProvider>
    </AccountProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  server = new FakeSyncServer();
  mockParams = {};
  jest.clearAllMocks();
});

describe("monthName", () => {
  it.each([
    ["2026-10", "October 2026"],
    ["2027-01", "January 2027"],
    ["2026-12", "December 2026"],
  ])("names %s %s", (month, name) => {
    expect(monthName(month)).toBe(name);
  });
});

describe("Letters tab", () => {
  it("lists the letters newest first by month, and opens one", async () => {
    server.addLetter(ana.userId, september);
    server.addLetter(ana.userId, october);
    const user = await renderScreen(Letters);

    expect(await screen.findByText("October 2026")).toBeOnTheScreen();
    const months = screen.getAllByRole("button", { name: /\d{4}$/ });
    expect(months.map((m) => m.props.accessibilityLabel)).toEqual([
      "October 2026",
      "September 2026",
    ]);

    await user.press(screen.getByText("October 2026"));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/letter/[id]",
      params: { id: october.id },
    });
  });

  it("shows the letters on the phone without a connection", async () => {
    server.failNext("listLetters");
    server.failNext("getLetterSettings");

    await renderScreen(Letters, { cached: [october] });

    expect(await screen.findByText("October 2026")).toBeOnTheScreen();
  });

  it("says one quiet line without letters, and where to turn them on when they're off", async () => {
    const user = await renderScreen(Letters);

    expect(
      await screen.findByText(
        "At the start of each month, a letter from your moments will arrive here.",
      ),
    ).toBeOnTheScreen();
    const hint = await screen.findByRole("button", {
      name: "Turn on Monthly letter in your account.",
    });

    await user.press(hint);
    expect(router.push).toHaveBeenCalledWith("/account");
  });

  it("doesn't point to the setting when letters are on", async () => {
    await server
      .lettersApi(ana.userId)
      .setSettings({ enabled: true, timeZone: "Europe/Zurich" });

    await renderScreen(Letters);

    expect(
      await screen.findByText(
        "At the start of each month, a letter from your moments will arrive here.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText("Turn on Monthly letter in your account."),
    ).toBeNull();
  });

  it("explains that letters need an account when signed out", async () => {
    const user = await renderScreen(Letters, { signedIn: false });

    expect(
      await screen.findByText(
        "Letters are written from the moments you sync, so they need an account.",
      ),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Your account" }));
    expect(router.push).toHaveBeenCalledWith("/account");
  });

  it("never counts letters or moments", async () => {
    server.addLetter(ana.userId, october);
    await renderScreen(Letters);
    await screen.findByText("October 2026");

    expect(screen.queryByText(/\b\d+ (letters?|moments?)\b/i)).toBeNull();
  });
});

describe("Letter screen", () => {
  it("shows the letter with its month, paragraph by paragraph", async () => {
    mockParams = { id: october.id };
    server.addLetter(ana.userId, october);

    await renderScreen(LetterScreen, { cached: [october] });

    expect(await screen.findByText("October 2026")).toBeOnTheScreen();
    expect(screen.getByText("Dear you,")).toBeOnTheScreen();
    expect(
      screen.getByText("Ramen with Ana, and fog on the lake."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Savor")).toBeOnTheScreen();
  });

  it("closes", async () => {
    mockParams = { id: october.id };
    server.addLetter(ana.userId, october);
    const user = await renderScreen(LetterScreen, { cached: [october] });

    await user.press(await screen.findByRole("button", { name: "Close" }));

    expect(router.back).toHaveBeenCalled();
  });

  it("says so when the letter isn't on the phone", async () => {
    mockParams = { id: "missing" };

    await renderScreen(LetterScreen);

    expect(
      await screen.findByText("This letter isn't on this phone."),
    ).toBeOnTheScreen();
  });
});
