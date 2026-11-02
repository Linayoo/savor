import {
  render,
  screen,
  userEvent,
  within,
} from "@testing-library/react-native";
import { router } from "expo-router";
import type { ComponentType } from "react";
import { AccountProvider, type AuthService } from "@/account";
import Account from "@/app/account/index";
import CreateAccount from "@/app/account/create";
import ForgotPassword from "@/app/account/forgot";
import SignIn from "@/app/account/sign-in";
import { getMeta, setMeta } from "@/db/app-meta";
import type { AppDb } from "@/db/types";
import { createTestDb } from "@/test-utils/db";
import { CODE, fakeAuth } from "@/test-utils/fake-auth";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    dismissAll: jest.fn(),
    back: jest.fn(),
  },
  useLocalSearchParams: () => mockParams,
}));

// Keeps the real auth module, with Amplify, out of these tests
jest.mock("@/auth/auth", () => ({}));

const ana = {
  email: "ana@example.com",
  password: "Ramen with Ana 2026",
  userId: "sub-ana",
};
const ben = {
  email: "ben@example.com",
  password: "Film night 2026 Ben",
  userId: "sub-ben",
};

let db: AppDb;

async function renderScreen(Screen: ComponentType, auth: AuthService) {
  db = createTestDb();
  await render(
    <AccountProvider db={db} auth={auth}>
      <Screen />
    </AccountProvider>,
  );
  return userEvent.setup();
}

const field = (name: string) => within(screen.getByTestId(`field-${name}`));

beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
});

describe("Account screen", () => {
  it("offers an account when signed out, without standing in the way", async () => {
    await renderScreen(Account, fakeAuth());

    expect(
      await screen.findByText(
        "Keep your moments safe and on all your devices.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeOnTheScreen();
  });

  it("still shows the account after the app was closed and opened again", async () => {
    await renderScreen(
      Account,
      fakeAuth({
        users: [ana],
        signedIn: { userId: ana.userId, email: ana.email },
      }),
    );

    expect(await screen.findByText("ana@example.com")).toBeOnTheScreen();
  });

  it("signs out and keeps the phone's owner, so the same account can resume", async () => {
    const auth = fakeAuth({
      users: [ana],
      signedIn: { userId: ana.userId, email: ana.email },
    });
    const user = await renderScreen(Account, auth);

    await user.press(await screen.findByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("button", { name: "Create account" }),
    ).toBeOnTheScreen();
    expect(auth.signOut).toHaveBeenCalled();
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });
});

describe("Create account", () => {
  it("shows the password rules before typing", async () => {
    await renderScreen(CreateAccount, fakeAuth());

    expect(
      field("password").getByText(
        "At least 12 characters, with an upper case letter, a lower case letter and a number.",
      ),
    ).toBeOnTheScreen();
  });

  it("explains a password that breaks the rules next to it, and sends nothing", async () => {
    const auth = fakeAuth();
    const user = await renderScreen(CreateAccount, auth);

    await user.type(screen.getByLabelText("Email"), "ana@example.com");
    await user.type(screen.getByLabelText("Password"), "short1A");
    await user.press(screen.getByRole("button", { name: "Create account" }));

    expect(
      field("password").getByText(
        "Your password needs at least 12 characters.",
      ),
    ).toBeOnTheScreen();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("says next to the email when it's already used", async () => {
    const user = await renderScreen(CreateAccount, fakeAuth({ users: [ana] }));

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), ana.password);
    await user.press(screen.getByRole("button", { name: "Create account" }));

    expect(
      await field("email").findByText(
        "There's already an account with this email. Sign in instead.",
      ),
    ).toBeOnTheScreen();
  });

  it("asks for the emailed code, says so next to it when it's wrong, then signs in", async () => {
    const user = await renderScreen(CreateAccount, fakeAuth());

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), ana.password);
    await user.press(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText("We sent a 6-digit code to ana@example.com."),
    ).toBeOnTheScreen();

    await user.type(screen.getByLabelText("Code"), "000000");
    await user.press(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await field("code").findByText(
        "That code isn't right. Check the email and try again.",
      ),
    ).toBeOnTheScreen();
    expect(getMeta(db, "ownerUserId")).toBeNull();
    expect(router.dismissAll).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), CODE);
    await user.press(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByRole("button", { name: "Confirm" });
    expect(router.dismissAll).toHaveBeenCalled();
    expect(getMeta(db, "ownerUserId")).toBe(`sub-${ana.email}`);
  });
});

describe("Sign in", () => {
  it("says what failed and what to do when the error has no message of its own", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const auth = fakeAuth({ users: [ana] });
    auth.signIn = jest.fn(async () => {
      throw Object.assign(new Error("raw"), { name: "SomethingNewException" });
    });
    const user = await renderScreen(SignIn, auth);

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), ana.password);
    await user.press(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "Couldn't sign in. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    jest.restoreAllMocks();
  });

  it("says next to the password when the email or password is wrong", async () => {
    const user = await renderScreen(SignIn, fakeAuth({ users: [ana] }));

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), "Not the password 1");
    await user.press(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await field("password").findByText("The email or password isn't right."),
    ).toBeOnTheScreen();
  });

  it("makes a phone without an owner the account's", async () => {
    const user = await renderScreen(SignIn, fakeAuth({ users: [ana] }));

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), ana.password);
    await user.press(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("button", { name: "Sign in" });
    expect(router.dismissAll).toHaveBeenCalled();
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });

  it("refuses an account the phone doesn't belong to, and signs it out again", async () => {
    const auth = fakeAuth({ users: [ana, ben] });
    const user = await renderScreen(SignIn, auth);
    setMeta(db, "ownerUserId", ana.userId);

    await user.type(screen.getByLabelText("Email"), ben.email);
    await user.type(screen.getByLabelText("Password"), ben.password);
    await user.press(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        "This phone holds moments from another account. Sign in with that account to keep syncing.",
      ),
    ).toBeOnTheScreen();
    expect(auth.signOut).toHaveBeenCalled();
    expect(await auth.currentSession()).toBeNull();
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
    expect(router.dismissAll).not.toHaveBeenCalled();
  });

  it("asks for the code of an account that was never confirmed, then signs in", async () => {
    const auth = fakeAuth({ unconfirmed: [ana] });
    const user = await renderScreen(SignIn, auth);

    await user.type(screen.getByLabelText("Email"), ana.email);
    await user.type(screen.getByLabelText("Password"), ana.password);
    await user.press(screen.getByRole("button", { name: "Sign in" }));
    await user.type(await screen.findByLabelText("Code"), CODE);
    await user.press(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByRole("button", { name: "Confirm" });
    expect(auth.resendSignUpCode).toHaveBeenCalledWith(ana.email);
    expect(router.dismissAll).toHaveBeenCalled();
    expect(getMeta(db, "ownerUserId")).toBe(ana.userId);
  });
});

describe("Forgot password", () => {
  it("sets a new password with the emailed code, and the new password signs in", async () => {
    const auth = fakeAuth({ users: [ana] });
    mockParams = { email: ana.email };
    const user = await renderScreen(ForgotPassword, auth);
    const newPassword = "Walk by the river 9";

    await user.press(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Code"), "000000");
    await user.type(screen.getByLabelText("New password"), newPassword);
    await user.press(screen.getByRole("button", { name: "Set password" }));
    expect(
      await field("code").findByText(
        "That code isn't right. Check the email and try again.",
      ),
    ).toBeOnTheScreen();

    await user.clear(screen.getByLabelText("Code"));
    await user.type(screen.getByLabelText("Code"), CODE);
    await user.press(screen.getByRole("button", { name: "Set password" }));

    await screen.findByRole("button", { name: "Set password" });
    expect(router.replace).toHaveBeenCalledWith({
      pathname: "/account/sign-in",
      params: { email: ana.email, notice: "passwordChanged" },
    });
    await expect(auth.signIn(ana.email, newPassword)).resolves.toMatchObject({
      status: "signedIn",
    });
  });
});
