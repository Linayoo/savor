import { act, render, screen, waitFor } from "@testing-library/react-native";
import { randomUUID } from "node:crypto";
import { AccountProvider, useAccount } from "@/account";
import type { AccountApi } from "@/account-api";
import Index from "@/app/(tabs)/index";
import { getMeta, setMeta } from "@/db/app-meta";
import { listLetters, replaceLetters } from "@/db/letters-store";
import { listMoments } from "@/db/moments-store";
import type { AppDb } from "@/db/types";
import { MomentsProvider } from "@/moments";
import { SyncError, type SyncApi } from "@/sync/api";
import { SyncProvider } from "@/sync-provider";
import { createTestDb, seedMoments } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

// A phone signed in to an account that was deleted on another device
// (spec 010)

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};
const deletedLine = "This account was deleted.";

function setup({
  signedIn = true,
  owner = ana.userId as string | null,
  api,
  accountApi,
}: {
  signedIn?: boolean;
  owner?: string | null;
  api?: SyncApi;
  accountApi?: AccountApi;
} = {}) {
  const db: AppDb = createTestDb();
  seedMoments(db, [
    { text: "Ramen with Ana", photos: ["1-a.jpg"], createdAt: 1 },
  ]);
  replaceLetters(db, [
    { id: randomUUID(), month: "2026-10", body: "Dear you", createdAt: 2 },
  ]);
  if (owner) setMeta(db, "ownerUserId", owner);
  const server = new FakeSyncServer();
  const auth = fakeAuth({
    users: [ana],
    signedIn: signedIn ? { userId: ana.userId, email: ana.email } : null,
  });
  const deleteFiles = jest.fn();
  const account: { current?: ReturnType<typeof useAccount> } = {};
  function Probe() {
    account.current = useAccount();
    return null;
  }

  const ui = (children: React.ReactNode) => (
    <AccountProvider
      db={db}
      auth={auth}
      accountApi={accountApi ?? server.accountApi(ana.userId)}
      deleteFiles={deleteFiles}
    >
      <SyncProvider
        db={db}
        createApi={() => api ?? server.api(ana.userId)}
        deleteFiles={deleteFiles}
        transfer={new FakePhotoTransfer(server)}
        subscribeToConnection={() => () => undefined}
        subscribeToForeground={() => () => undefined}
      >
        <MomentsProvider db={db}>
          <Probe />
          {children}
        </MomentsProvider>
      </SyncProvider>
    </AccountProvider>
  );
  return { db, server, auth, deleteFiles, account, ui };
}

const expectCleared = (db: AppDb, deleteFiles: jest.Mock) => {
  expect(listMoments(db)).toEqual([]);
  expect(listLetters(db)).toEqual([]);
  expect(getMeta(db, "ownerUserId")).toBeNull();
  expect(deleteFiles).toHaveBeenCalledWith(["1-a.jpg"]);
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("ACCOUNT_DELETED from a sync", () => {
  it("clears the account from this phone, signs out, and says so on the timeline", async () => {
    const { db, server, auth, deleteFiles, account, ui } = setup();
    server.deleteAccount(ana.userId);

    await render(ui(<Index />));

    expect(await screen.findByText(deletedLine)).toBeOnTheScreen();
    expect(screen.queryByText("Ramen with Ana")).not.toBeOnTheScreen();
    expectCleared(db, deleteFiles);
    expect(auth.signOut).toHaveBeenCalled();
    expect(account.current?.account).toMatchObject({
      status: "signedOut",
      sessionEnded: false,
      deleted: "elsewhere",
    });
  });
});

describe("a session that ended", () => {
  const ended: SyncApi = {
    ...new FakeSyncServer().api(ana.userId),
    push: () => Promise.reject(new SyncError("unauthorized")),
    pull: () => Promise.reject(new SyncError("unauthorized")),
  };

  it("asks whether the account was deleted, and clears it when it was", async () => {
    const { db, server, deleteFiles, account, ui } = setup({ api: ended });
    server.deleteAccount(ana.userId);

    await render(ui(<Index />));

    expect(await screen.findByText(deletedLine)).toBeOnTheScreen();
    expectCleared(db, deleteFiles);
    expect(account.current?.account).toMatchObject({ deleted: "elsewhere" });
  });

  it("keeps the moments when the account wasn't deleted", async () => {
    const { db, account, ui } = setup({ api: ended });

    await render(ui(null));

    await waitFor(() =>
      expect(account.current?.account).toEqual({
        status: "signedOut",
        sessionEnded: true,
      }),
    );
    expect(listMoments(db)).toHaveLength(1);
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });

  it("keeps the moments when the question can't be answered, as offline", async () => {
    const offline: AccountApi = {
      deleteAccount: () => Promise.reject(new SyncError("unavailable")),
      wasDeleted: () => Promise.reject(new SyncError("unavailable")),
    };
    const { db, account, ui } = setup({ api: ended, accountApi: offline });

    await render(ui(null));

    await waitFor(() =>
      expect(account.current?.account).toMatchObject({ sessionEnded: true }),
    );
    expect(listMoments(db)).toHaveLength(1);
  });
});

describe("opening the app signed out", () => {
  it("clears a phone whose owner was deleted", async () => {
    const { db, server, deleteFiles, ui } = setup({ signedIn: false });
    server.deleteAccount(ana.userId);

    await render(ui(<Index />));

    expect(await screen.findByText(deletedLine)).toBeOnTheScreen();
    expectCleared(db, deleteFiles);
  });

  it("never asks about, or clears, a phone with no owner", async () => {
    const wasDeleted = jest.fn(async () => true);
    const { db, account, ui } = setup({
      signedIn: false,
      owner: null,
      accountApi: { deleteAccount: jest.fn(), wasDeleted },
    });

    await render(ui(null));
    await waitFor(() =>
      expect(account.current?.account.status).toBe("signedOut"),
    );
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(wasDeleted).not.toHaveBeenCalled();
    expect(listMoments(db)).toHaveLength(1);
  });
});
