import { render, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ComponentType } from "react";
import { Alert, type AlertButton } from "react-native";
import { AccountProvider } from "@/account";
import CreateAccount from "@/app/account/create";
import SignIn from "@/app/account/sign-in";
import { getMeta, setMeta } from "@/db/app-meta";
import { listLetters, replaceLetters } from "@/db/letters-store";
import { listMoments } from "@/db/moments-store";
import type { AppDb } from "@/db/types";
import { createTestDb, seedMoments } from "@/test-utils/db";
import { CODE, fakeAuth } from "@/test-utils/fake-auth";

// The way out of the ownership refusal (spec 010, behavior 9): remove the
// other account's moments from this phone, and only from this phone

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), dismissAll: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};
const ownershipMessage =
  "This phone holds moments from another account. Sign in with that account to keep syncing.";
const removedNotice =
  "The moments were removed from this phone. You can sign in now.";

let db: AppDb;
let deleteFiles: jest.Mock;

async function renderScreen(Screen: ComponentType) {
  db = createTestDb();
  seedMoments(db, [
    { text: "Kept by someone else", photos: ["1-a.jpg"], createdAt: 1 },
  ]);
  replaceLetters(db, [
    { id: "l-1", month: "2026-10", body: "Dear you", createdAt: 2 },
  ]);
  setMeta(db, "ownerUserId", "sub-gone");
  deleteFiles = jest.fn();
  const auth = fakeAuth({ users: [ana] });
  await render(
    <AccountProvider db={db} auth={auth} deleteFiles={deleteFiles}>
      <Screen />
    </AccountProvider>,
  );
  return { user: userEvent.setup(), auth };
}

async function signInAsAna(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), ana.email);
  await user.type(screen.getByLabelText("Password"), ana.password);
  await user.press(screen.getByRole("button", { name: "Sign in" }));
}

// Answers the confirmation with the button labelled choice
function answerConfirmation(choice: "Remove" | "Cancel") {
  return jest
    .spyOn(Alert, "alert")
    .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      buttons?.find((b) => b.text === choice)?.onPress?.();
    });
}

beforeEach(() => jest.clearAllMocks());

describe("Remove them from this phone", () => {
  it("is offered with the ownership refusal", async () => {
    const { user } = await renderScreen(SignIn);

    await signInAsAna(user);

    expect(await screen.findByText(ownershipMessage)).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Remove them from this phone" }),
    ).toBeOnTheScreen();
  });

  it("isn't offered for other sign-in errors", async () => {
    const { user } = await renderScreen(SignIn);

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), "Not the password 1");
    await user.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Remove them from this phone" }),
    ).not.toBeOnTheScreen();
  });

  it("warns that moments never synced will be lost", async () => {
    const alert = answerConfirmation("Cancel");
    const { user } = await renderScreen(SignIn);
    await signInAsAna(user);

    await user.press(
      await screen.findByRole("button", {
        name: "Remove them from this phone",
      }),
    );

    expect(alert).toHaveBeenCalledWith(
      "Remove them from this phone?",
      expect.stringContaining("Moments that were never synced will be lost."),
      expect.any(Array),
    );
  });

  it("keeps everything when cancelled", async () => {
    answerConfirmation("Cancel");
    const { user } = await renderScreen(SignIn);
    await signInAsAna(user);

    await user.press(
      await screen.findByRole("button", {
        name: "Remove them from this phone",
      }),
    );

    expect(listMoments(db)).toHaveLength(1);
    expect(getMeta(db, "ownerUserId")).toBe("sub-gone");
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  it("clears this phone only, then lets me sign in and claim it", async () => {
    answerConfirmation("Remove");
    const { user, auth } = await renderScreen(SignIn);
    await signInAsAna(user);

    await user.press(
      await screen.findByRole("button", {
        name: "Remove them from this phone",
      }),
    );

    expect(await screen.findByText(removedNotice)).toBeOnTheScreen();
    expect(screen.queryByText(ownershipMessage)).not.toBeOnTheScreen();
    expect(listMoments(db)).toEqual([]);
    expect(listLetters(db)).toEqual([]);
    expect(getMeta(db, "ownerUserId")).toBeNull();
    expect(deleteFiles).toHaveBeenCalledWith(["1-a.jpg"]);
    // Only this phone: no account call, and nobody stays signed in
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    await user.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("button", { name: "Sign in" });
    expect(router.dismissAll).toHaveBeenCalled();
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });

  it("is offered after creating an account too", async () => {
    const { user } = await renderScreen(CreateAccount);

    await user.type(screen.getByLabelText("Email"), "ben@example.com");
    await user.type(screen.getByLabelText("Password"), "Film night 2026 Ben");
    await user.press(screen.getByRole("button", { name: "Create account" }));
    await user.type(await screen.findByLabelText("Code"), CODE);
    await user.press(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(ownershipMessage)).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Remove them from this phone" }),
    ).toBeOnTheScreen();
  });
});
