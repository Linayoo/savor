import { act, render, screen, waitFor } from "@testing-library/react-native";
import { randomUUID } from "node:crypto";
import { AccountProvider, useAccount } from "@/account";
import Index from "@/app/(tabs)/index";
import { getMeta, setMeta } from "@/db/app-meta";
import type { AppDb } from "@/db/types";
import { MomentsProvider, useMoments } from "@/moments";
import { SyncError, type SyncApi } from "@/sync/api";
import { SyncProvider, useSync } from "@/sync-provider";
import { createTestDb, seedMoments } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};

// The app's providers around a probe that exposes them to the test
function setup({
  signedIn = true,
  owner = null as string | null,
  api,
}: { signedIn?: boolean; owner?: string | null; api?: SyncApi } = {}) {
  const db: AppDb = createTestDb();
  seedMoments(db, [{ text: "Kept before signing in", createdAt: 1 }]);
  if (owner) setMeta(db, "ownerUserId", owner);
  const server = new FakeSyncServer();
  const auth = fakeAuth({
    users: [ana],
    signedIn: signedIn ? { userId: ana.userId, email: ana.email } : null,
  });
  const deleteFiles = jest.fn();
  const triggers = {
    connection: (_online: boolean) => undefined as void,
    foreground: () => undefined as void,
  };
  const subscribeToConnection = (onChange: (online: boolean) => void) => {
    triggers.connection = onChange;
    return () => undefined;
  };
  const subscribeToForeground = (onActive: () => void) => {
    triggers.foreground = onActive;
    return () => undefined;
  };

  const app: {
    moments?: ReturnType<typeof useMoments>;
    sync?: ReturnType<typeof useSync>;
    account?: ReturnType<typeof useAccount>;
  } = {};
  function Probe() {
    app.moments = useMoments();
    app.sync = useSync();
    app.account = useAccount();
    return null;
  }

  const ui = (children: React.ReactNode) => (
    <AccountProvider db={db} auth={auth}>
      <SyncProvider
        db={db}
        createApi={() => api ?? server.api(ana.userId)}
        deleteFiles={deleteFiles}
        subscribeToConnection={subscribeToConnection}
        subscribeToForeground={subscribeToForeground}
      >
        <MomentsProvider db={db}>
          <Probe />
          {children}
        </MomentsProvider>
      </SyncProvider>
    </AccountProvider>
  );

  return { db, server, auth, triggers, app, ui };
}

const fromOtherDevice = (text: string) => ({
  id: randomUUID(),
  text,
  kind: null,
  createdAt: 2,
  updatedAt: 2,
  deletedAt: null,
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("SyncProvider", () => {
  it("pushes the phone's moments when the app opens signed in for the first time", async () => {
    const { db, server, ui } = setup();

    await render(ui(null));

    await waitFor(() =>
      expect(server.momentsOf(ana.userId).map((m) => m.text)).toEqual([
        "Kept before signing in",
      ]),
    );
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });

  it("does nothing while signed out, and keeping moments works as before", async () => {
    const { server, app, ui } = setup({ signedIn: false });
    await render(ui(null));
    await waitFor(() => expect(app.account?.account.status).toBe("signedOut"));

    await act(async () => app.moments!.addMoment("Offline and signed out", []));
    await act(() => jest.advanceTimersByTimeAsync(60_000));

    expect(app.moments!.moments.map((m) => m.text)).toContain(
      "Offline and signed out",
    );
    expect(app.sync!.status).toBeNull();
    expect(server.pushes).toEqual([]);
    expect(server.pulls).toEqual([]);
  });

  it("refuses another account's sign-in before anything is pushed or pulled", async () => {
    const { server, app, ui } = setup({ owner: "sub-ben" });

    await render(ui(null));
    await waitFor(() => expect(app.account?.account.status).toBe("signedOut"));
    await act(() => jest.advanceTimersByTimeAsync(60_000));

    expect(server.pushes).toEqual([]);
    expect(server.pulls).toEqual([]);
  });

  it("syncs a few seconds after a local change", async () => {
    const { server, app, ui } = setup();
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("idle"));

    await act(async () => app.moments!.addMoment("Ramen with Ana", [], "meal"));
    await act(() => jest.advanceTimersByTimeAsync(3_000));

    expect(server.momentsOf(ana.userId).map((m) => m.text)).toContain(
      "Ramen with Ana",
    );
  });

  it("syncs when the app comes back, and shows moments from another device", async () => {
    const { server, triggers, app, ui } = setup();
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("idle"));
    server.seed(ana.userId, {
      moments: [fromOtherDevice("From the other phone")],
      photos: [],
    });

    await act(async () => triggers.foreground());

    await waitFor(() =>
      expect(app.moments!.moments.map((m) => m.text)).toContain(
        "From the other phone",
      ),
    );
  });

  it("pushes moments kept offline once the connection is back, without any action", async () => {
    const { server, triggers, app, ui } = setup();
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("idle"));

    await act(async () => triggers.connection(false));
    server.failNext("push");
    await act(async () => app.moments!.addMoment("Kept offline", []));
    await act(() => jest.advanceTimersByTimeAsync(3_000));
    expect(app.sync!.online).toBe(false);
    expect(server.momentsOf(ana.userId).map((m) => m.text)).not.toContain(
      "Kept offline",
    );

    await act(async () => triggers.connection(true));

    await waitFor(() =>
      expect(server.momentsOf(ana.userId).map((m) => m.text)).toContain(
        "Kept offline",
      ),
    );
  });

  it("ends the session when the token can't be refreshed, and keeps the moments", async () => {
    const ended: SyncApi = {
      push: () => Promise.reject(new SyncError("unauthorized")),
      pull: () => Promise.reject(new SyncError("unauthorized")),
    };
    const { auth, app, ui } = setup({ api: ended });

    await render(ui(null));

    await waitFor(() =>
      expect(app.account?.account).toEqual({
        status: "signedOut",
        sessionEnded: true,
      }),
    );
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(app.moments!.moments.map((m) => m.text)).toEqual([
      "Kept before signing in",
    ]);
  });

  it("stops syncing after sign-out, and keeps the moments and the owner", async () => {
    const { db, server, app, ui } = setup();
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("idle"));
    const pushes = server.pushes.length;

    await act(() => app.account!.signOut());
    await act(async () => app.moments!.addMoment("After signing out", []));
    await act(() => jest.advanceTimersByTimeAsync(60_000));

    expect(server.pushes).toHaveLength(pushes);
    expect(app.moments!.moments.map((m) => m.text)).toContain(
      "After signing out",
    );
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });

  it("doesn't say the session ended when a sync fails because of the sign-out", async () => {
    let rejectPush = (_: unknown) => {};
    const pushing: SyncApi = {
      push: () => new Promise((_, reject) => (rejectPush = reject)),
      pull: () =>
        Promise.resolve({
          moments: [],
          photos: [],
          version: 0,
          hasMore: false,
        }),
    };
    const { auth, app, ui } = setup({ api: pushing });
    // Every sign-out call waits for the same moment
    let finishSignOut = () => {};
    const signedOut = new Promise<void>((resolve) => (finishSignOut = resolve));
    auth.signOut = jest.fn(() => signedOut);
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("syncing"));

    let signingOut = Promise.resolve();
    await act(async () => {
      signingOut = app.account!.signOut();
    });
    // Amplify cleared the tokens; the sync in flight now fails
    await act(async () => rejectPush(new SyncError("unauthorized")));
    await act(async () => {
      finishSignOut();
      await signingOut;
    });

    expect(app.account?.account).toEqual({
      status: "signedOut",
      sessionEnded: false,
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps syncing when signing out fails", async () => {
    const { server, auth, app, triggers, ui } = setup();
    auth.signOut = jest.fn(async () => {
      throw new Error("couldn't sign out");
    });
    await render(ui(null));
    await waitFor(() => expect(app.sync?.status?.phase).toBe("idle"));

    await act(() => expect(app.account!.signOut()).rejects.toThrow());
    await act(async () =>
      app.moments!.addMoment("After the failed sign-out", []),
    );
    await act(async () => triggers.foreground());

    await waitFor(() =>
      expect(server.momentsOf(ana.userId).map((m) => m.text)).toContain(
        "After the failed sign-out",
      ),
    );
  });

  it("offers pull-to-refresh on the timeline only while signed in", async () => {
    const signedIn = setup();
    await render(signedIn.ui(<Index />));
    await waitFor(() => expect(signedIn.app.sync?.status).not.toBeNull());
    expect(screen.getByTestId("timeline").props.refreshControl).toBeTruthy();

    screen.unmount();
    const signedOut = setup({ signedIn: false });
    await render(signedOut.ui(<Index />));
    await waitFor(() =>
      expect(signedOut.app.account?.account.status).toBe("signedOut"),
    );
    expect(screen.getByTestId("timeline").props.refreshControl).toBeFalsy();
  });
});
