import { act, render, waitFor } from "@testing-library/react-native";
import { AccountProvider, useAccount } from "@/account";
import { listLetters, replaceLetters } from "@/db/letters-store";
import type { AppDb } from "@/db/types";
import { LettersProvider, useLetters } from "@/letters/provider";
import { SyncProvider, useSync } from "@/sync-provider";
import { createTestDb } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};

const october = {
  id: "0b6f8f4e-7d7a-4f7e-9d43-5a1e2c3b4d5f",
  month: "2026-10",
  body: "Dear you, October",
  createdAt: Date.UTC(2026, 10, 1, 7),
};
const november = {
  id: "1c7f9f5e-8e8b-4f8e-8e54-6b2f3d4c5e6a",
  month: "2026-11",
  body: "Dear you, November",
  createdAt: Date.UTC(2026, 11, 1, 7),
};

function setup({ signedIn = true } = {}) {
  const db: AppDb = createTestDb();
  const server = new FakeSyncServer();
  const auth = fakeAuth({
    users: [ana],
    signedIn: signedIn ? { userId: ana.userId, email: ana.email } : null,
  });
  const app: {
    letters?: ReturnType<typeof useLetters>;
    sync?: ReturnType<typeof useSync>;
    account?: ReturnType<typeof useAccount>;
  } = {};
  function Probe() {
    app.letters = useLetters();
    app.sync = useSync();
    app.account = useAccount();
    return null;
  }
  const ui = (
    <AccountProvider db={db} auth={auth}>
      <SyncProvider
        db={db}
        createApi={() => server.api(ana.userId)}
        deleteFiles={jest.fn()}
        transfer={new FakePhotoTransfer(server)}
        subscribeToConnection={() => () => undefined}
        subscribeToForeground={() => () => undefined}
      >
        <LettersProvider
          db={db}
          createApi={() => server.lettersApi(ana.userId)}
        >
          <Probe />
        </LettersProvider>
      </SyncProvider>
    </AccountProvider>
  );
  return { db, server, app, ui };
}

describe("LettersProvider", () => {
  it("fetches the letters and settings once signed in, and keeps a copy on the phone", async () => {
    const { db, server, app, ui } = setup();
    server.addLetter(ana.userId, october);

    await render(ui);

    await waitFor(() => expect(app.letters!.letters).toEqual([october]));
    expect(listLetters(db)).toEqual([october]);
    expect(app.letters!.settings).toEqual({ enabled: false, timeZone: null });
  });

  it("fetches again after each sync", async () => {
    const { server, app, ui } = setup();
    server.addLetter(ana.userId, october);
    await render(ui);
    await waitFor(() => expect(app.letters!.letters).toHaveLength(1));

    server.addLetter(ana.userId, november);
    await act(() => app.sync!.syncNow());

    await waitFor(() =>
      expect(app.letters!.letters).toEqual([november, october]),
    );
  });

  it("keeps the letters on the phone when the server can't be reached", async () => {
    const { db, server, app, ui } = setup();
    replaceLetters(db, [october]);
    // Every fetch: when signed in, after the first sync and the one below
    for (let i = 0; i < 3; i++) {
      server.failNext("listLetters");
      server.failNext("getLetterSettings");
    }

    await render(ui);
    await waitFor(() => expect(app.sync!.status?.phase).toBe("idle"));
    await act(() => app.letters!.refresh());

    expect(app.letters!.letters).toEqual([october]);
    expect(listLetters(db)).toEqual([october]);
  });

  it("removes the letters from the phone on sign-out", async () => {
    const { db, server, app, ui } = setup();
    server.addLetter(ana.userId, october);
    await render(ui);
    await waitFor(() => expect(listLetters(db)).toHaveLength(1));

    await act(() => app.account!.signOut());

    expect(listLetters(db)).toEqual([]);
    expect(app.letters!.letters).toEqual([]);
    expect(app.letters!.settings).toBeNull();
  });

  it("doesn't bring letters back from a fetch that was in flight at sign-out", async () => {
    const { db, server, app, ui } = setup();
    server.addLetter(ana.userId, october);
    const held = server.holdNextLettersList();
    await render(ui);
    await held.started;

    await act(() => app.account!.signOut());
    held.release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(listLetters(db)).toEqual([]);
    expect(app.letters!.letters).toEqual([]);
  });

  it("fetches nothing while signed out", async () => {
    const { server, app, ui } = setup({ signedIn: false });
    const list = jest.spyOn(server, "lettersApi");

    await render(ui);
    await act(() => app.letters!.refresh());

    expect(list).not.toHaveBeenCalled();
    expect(app.letters!.settings).toBeNull();
  });

  it("saves the setting with the time zone", async () => {
    const { server, app, ui } = setup();
    await render(ui);
    await waitFor(() => expect(app.letters!.settings).not.toBeNull());

    await act(() => app.letters!.saveSettings(true, "Europe/Zurich"));

    expect(server.letterSettingsOf(ana.userId)).toEqual({
      enabled: true,
      timeZone: "Europe/Zurich",
    });
    expect(app.letters!.settings).toEqual({
      enabled: true,
      timeZone: "Europe/Zurich",
    });
  });

  it("says so when the setting can't be saved, and keeps the old one", async () => {
    const { server, app, ui } = setup();
    await render(ui);
    await waitFor(() => expect(app.letters!.settings).not.toBeNull());
    server.failNext("setLetterSettings");

    await expect(
      act(() => app.letters!.saveSettings(true, "Europe/Zurich")),
    ).rejects.toEqual(expect.objectContaining({ kind: "unavailable" }));

    expect(app.letters!.settings).toEqual({ enabled: false, timeZone: null });
  });
});
