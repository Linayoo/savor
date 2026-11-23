import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from "@testing-library/react-native";
import { router } from "expo-router";
import { AccountProvider, useAccount } from "@/account";
import Account from "@/app/account/index";
import DeleteAccount from "@/app/account/delete";
import Index from "@/app/(tabs)/index";
import { getMeta, setMeta } from "@/db/app-meta";
import { listMoments } from "@/db/moments-store";
import type { AppDb } from "@/db/types";
import { MomentsProvider } from "@/moments";
import { SyncError } from "@/sync/api";
import { SyncProvider } from "@/sync-provider";
import { createTestDb, seedMoments } from "@/test-utils/db";
import { fakeAuth } from "@/test-utils/fake-auth";
import { FakePhotoTransfer } from "@/test-utils/fake-photo-transfer";
import { FakeSyncServer } from "@/test-utils/fake-sync-server";

// Deleting the account from the Account screen (spec 010)

const mockScreenOptions: Record<string, unknown>[] = [];
const mockParentOptions: Record<string, unknown>[] = [];
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), dismissAll: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
  useNavigation: () => ({
    getParent: () => ({
      setOptions: (options: Record<string, unknown>) =>
        mockParentOptions.push(options),
    }),
  }),
}));
jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};
const failureLine =
  "Couldn't delete your account. Nothing was lost; please try again.";

function setup({
  holdDelete = false,
}: {
  // The server keeps the deletion in flight until hold.finish()
  holdDelete?: boolean;
} = {}) {
  const db: AppDb = createTestDb();
  seedMoments(db, [
    { text: "Ramen with Ana", photos: ["1-a.jpg"], createdAt: 1 },
  ]);
  setMeta(db, "ownerUserId", ana.userId);
  const server = new FakeSyncServer();
  const auth = fakeAuth({
    users: [ana],
    signedIn: { userId: ana.userId, email: ana.email },
  });
  const deleteFiles = jest.fn();
  const hold = { finish: () => {} };
  const accountApi = server.accountApi(ana.userId);
  if (holdDelete) {
    accountApi.deleteAccount = () =>
      new Promise<void>((resolve) => (hold.finish = resolve));
  }
  const account: { current?: ReturnType<typeof useAccount> } = {};
  function Probe() {
    account.current = useAccount();
    return null;
  }
  const ui = (children: React.ReactNode) => (
    <AccountProvider
      db={db}
      auth={auth}
      accountApi={accountApi}
      deleteFiles={deleteFiles}
    >
      <SyncProvider
        db={db}
        createApi={() => server.api(ana.userId)}
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
  return { db, server, auth, deleteFiles, account, hold, ui };
}

const typeWord = () => screen.getByLabelText('Type "delete" to confirm');
const deleteButton = () =>
  screen.getByRole("button", { name: "Delete account" });

beforeEach(() => {
  jest.clearAllMocks();
  mockScreenOptions.length = 0;
  mockParentOptions.length = 0;
});

describe("Account screen", () => {
  it("offers to delete the account while signed in", async () => {
    const { ui } = setup();
    const user = userEvent.setup();
    await render(ui(<Account />));

    await user.press(
      await screen.findByRole("button", { name: "Delete account" }),
    );

    expect(router.push).toHaveBeenCalledWith("/account/delete");
  });

  it("doesn't offer it while signed out", async () => {
    const { ui, account } = setup();
    await render(ui(<Account />));
    await act(() => account.current!.signOut());

    expect(
      screen.queryByRole("button", { name: "Delete account" }),
    ).not.toBeOnTheScreen();
  });
});

describe("Delete account screen", () => {
  it("says what will be deleted, for good", async () => {
    const { ui } = setup();
    await render(ui(<DeleteAccount />));

    expect(
      await screen.findByText(
        /your sign-in, all your moments and photos, your letters and settings, on every device/,
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/can't be recovered/)).toBeOnTheScreen();
  });

  it("keeps the button disabled until the word is typed", async () => {
    const { ui } = setup();
    const user = userEvent.setup();
    await render(ui(<DeleteAccount />));

    expect(deleteButton()).toBeDisabled();
    await user.type(typeWord(), "delet");
    expect(deleteButton()).toBeDisabled();
    await user.type(typeWord(), "e");
    expect(deleteButton()).toBeEnabled();
  });

  it("takes the word in any case, with spaces around it", async () => {
    const { ui } = setup();
    const user = userEvent.setup();
    await render(ui(<DeleteAccount />));

    await user.type(typeWord(), " Delete ");

    expect(deleteButton()).toBeEnabled();
  });

  it("deletes the account, clears this phone and returns to the timeline with one line", async () => {
    const { db, server, auth, deleteFiles, account, ui } = setup();
    const user = userEvent.setup();
    // The timeline stays underneath the Account screens
    await render(
      ui(
        <>
          <Index />
          <DeleteAccount />
        </>,
      ),
    );
    await waitFor(() => expect(server.pulls.length).toBeGreaterThan(0));
    expect(screen.getByText("Ramen with Ana")).toBeOnTheScreen();

    await user.type(typeWord(), "delete");
    await user.press(deleteButton());

    await waitFor(() => expect(router.dismissAll).toHaveBeenCalled());
    expect(auth.refreshSession).toHaveBeenCalled();
    expect(await server.accountApi(ana.userId).wasDeleted(ana.userId)).toBe(
      true,
    );
    expect(listMoments(db)).toEqual([]);
    expect(getMeta(db, "ownerUserId")).toBeNull();
    expect(deleteFiles).toHaveBeenCalledWith(["1-a.jpg"]);
    expect(auth.signOut).toHaveBeenCalled();
    expect(account.current?.account).toMatchObject({ deleted: "here" });
    expect(
      await screen.findByText("Your account and moments were deleted."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Ramen with Ana")).not.toBeOnTheScreen();
  });

  it("stops syncing before it starts, and can't be left while it runs", async () => {
    const { server, hold, ui } = setup({ holdDelete: true });
    const user = userEvent.setup();
    await render(ui(<DeleteAccount />));
    await waitFor(() => expect(server.pulls.length).toBeGreaterThan(0));
    const pushes = server.pushes.length;
    const pulls = server.pulls.length;

    await user.type(typeWord(), "delete");
    await user.press(deleteButton());

    expect(await screen.findByText("Deleting your account…")).toBeOnTheScreen();
    expect(mockScreenOptions.at(-1)).toMatchObject({
      gestureEnabled: false,
      headerBackVisible: false,
    });
    expect(mockParentOptions.at(-1)).toEqual({ gestureEnabled: false });
    expect(server.pushes.length).toBe(pushes);
    expect(server.pulls.length).toBe(pulls);
    await act(async () => hold.finish());
  });

  it("says so when it fails, keeps everything, and syncs again", async () => {
    const { db, server, ui } = setup();
    const user = userEvent.setup();
    server.failNext("deleteAccount");
    await render(ui(<DeleteAccount />));
    await waitFor(() => expect(server.pulls.length).toBeGreaterThan(0));
    const pulls = server.pulls.length;

    await user.type(typeWord(), "delete");
    await user.press(deleteButton());

    expect(await screen.findByText(failureLine)).toBeOnTheScreen();
    expect(listMoments(db)).toHaveLength(1);
    expect(deleteButton()).toBeEnabled();
    expect(mockParentOptions.at(-1)).toEqual({ gestureEnabled: true });
    await waitFor(() => expect(server.pulls.length).toBeGreaterThan(pulls));

    await user.press(deleteButton());

    await waitFor(() => expect(router.dismissAll).toHaveBeenCalled());
    expect(listMoments(db)).toEqual([]);
  });

  it("keeps syncing stopped after an attempt that marked the account, and a retry finishes", async () => {
    const { db, server, auth, ui } = setup();
    const user = userEvent.setup();
    await render(ui(<DeleteAccount />));
    await waitFor(() => expect(server.pulls.length).toBeGreaterThan(0));
    const pulls = server.pulls.length;
    server.failNextDeleteAfterMarking = true;

    await user.type(typeWord(), "delete");
    await user.press(deleteButton());

    expect(await screen.findByText(failureLine)).toBeOnTheScreen();
    // No sync to be refused, and nothing cleared as if deleted elsewhere
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(server.pulls.length).toBe(pulls);
    expect(listMoments(db)).toHaveLength(1);

    // The retry's refresh is refused: the first attempt revoked the session
    auth.refreshSession = jest.fn(async () => {
      throw new SyncError("unauthorized");
    });
    await user.press(deleteButton());

    await waitFor(() => expect(router.dismissAll).toHaveBeenCalled());
    expect(listMoments(db)).toEqual([]);
  });

  it("fails as usual when the session can't be refreshed and nothing was marked", async () => {
    const { db, auth, ui } = setup();
    const user = userEvent.setup();
    auth.refreshSession = jest.fn(async () => {
      throw new SyncError("unauthorized");
    });
    await render(ui(<DeleteAccount />));

    await user.type(typeWord(), "delete");
    await user.press(deleteButton());

    expect(await screen.findByText(failureLine)).toBeOnTheScreen();
    expect(listMoments(db)).toHaveLength(1);
  });
});
