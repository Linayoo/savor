import * as amplifyAuth from "aws-amplify/auth";
import {
  confirmSignUp,
  currentSession,
  getAccessToken,
  signIn,
  signOut,
  signUp,
} from "@/auth/auth";
import { SyncError } from "@/sync/api";

jest.mock("@/auth/amplify", () => ({ configureAuth: jest.fn() }));
jest.mock("aws-amplify/auth", () => ({
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  autoSignIn: jest.fn(),
  getCurrentUser: jest.fn(),
  fetchAuthSession: jest.fn(),
  signOut: jest.fn(),
}));

const auth = jest.mocked(amplifyAuth);
const awsError = (name: string) => Object.assign(new Error(name), { name });

let log: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  // Nobody is signed in when an action starts; Ana is once it signed in
  auth.getCurrentUser
    .mockRejectedValueOnce(awsError("UserUnAuthenticatedException"))
    .mockResolvedValue(anaUser);
  auth.signIn.mockResolvedValue({
    isSignedIn: true,
    nextStep: { signInStep: "DONE" },
  });
});

const anaUser = {
  userId: "sub-a",
  username: "sub-a",
  signInDetails: { loginId: "ana@example.com" },
};

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("signIn", () => {
  it("signs in with SRP and returns who is signed in", async () => {
    auth.signIn.mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: "DONE" },
    });

    expect(await signIn(" Ana@Example.com ", "Ramen with Ana 2026")).toEqual({
      status: "signedIn",
      session: { userId: "sub-a", email: "ana@example.com" },
    });
    expect(auth.signIn).toHaveBeenCalledWith({
      username: "ana@example.com",
      password: "Ramen with Ana 2026",
      options: { authFlowType: "USER_SRP_AUTH" },
    });
  });

  it("asks for the email code when the account isn't confirmed yet", async () => {
    auth.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: "CONFIRM_SIGN_UP" },
    });

    expect(await signIn("ana@example.com", "Ramen with Ana 2026")).toEqual({
      status: "confirmSignUp",
    });
  });
});

// Amplify refuses to sign in while a user is still signed in, and a sign-out
// still finishing would clear the new session's tokens
describe("one account action at a time", () => {
  it("waits for a sign-out that's still finishing before signing in", async () => {
    const out = deferred();
    auth.signOut.mockReturnValue(out.promise);

    const signingOut = signOut();
    const signingIn = signIn("ana@example.com", "Ramen with Ana 2026");
    await flush();
    expect(auth.signIn).not.toHaveBeenCalled();

    out.resolve();
    await signingOut;
    await signingIn;
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("goes on after an action failed", async () => {
    auth.signOut.mockRejectedValue(awsError("SomethingNewException"));

    await expect(signOut()).rejects.toThrow();
    await signIn("ana@example.com", "Ramen with Ana 2026");

    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["signIn", () => signIn("ana@example.com", "Ramen with Ana 2026")],
    ["signUp", () => signUp("ana@example.com", "Ramen with Ana 2026")],
  ])(
    "%s first signs out a user Amplify still holds, like an account the phone refused",
    async (_, action) => {
      auth.getCurrentUser.mockReset().mockResolvedValue(anaUser);

      await action();

      expect(auth.signOut).toHaveBeenCalledTimes(1);
      const started =
        auth.signIn.mock.invocationCallOrder[0] ??
        auth.signUp.mock.invocationCallOrder[0];
      expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(started);
    },
  );
});

describe("development logging", () => {
  it("prints every failed action with the error's name and message", async () => {
    auth.signIn.mockRejectedValue(
      Object.assign(new Error("Password attempts exceeded"), {
        name: "NotAuthorizedException",
      }),
    );

    await expect(signIn("ana@example.com", "x")).rejects.toThrow();

    expect(log).toHaveBeenCalledWith(
      "[auth] signIn failed: NotAuthorizedException: Password attempts exceeded",
    );
  });

  it("stays quiet when nobody is signed in, the normal case", async () => {
    auth.getCurrentUser.mockRejectedValue(
      awsError("UserUnAuthenticatedException"),
    );

    await currentSession();

    expect(log).not.toHaveBeenCalled();
  });
});

describe("signUp and confirmSignUp", () => {
  it("signs the person in once the code is confirmed", async () => {
    auth.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: {
        signUpStep: "CONFIRM_SIGN_UP",
        codeDeliveryDetails: {},
      },
    });
    auth.confirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: "COMPLETE_AUTO_SIGN_IN" },
    });
    auth.autoSignIn.mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: "DONE" },
    });

    await signUp("ana@example.com", "Ramen with Ana 2026");
    const session = await confirmSignUp("ana@example.com", " 123456 ");

    expect(auth.signUp).toHaveBeenCalledWith({
      username: "ana@example.com",
      password: "Ramen with Ana 2026",
      options: {
        userAttributes: { email: "ana@example.com" },
        autoSignIn: { authFlowType: "USER_SRP_AUTH" },
      },
    });
    expect(auth.confirmSignUp).toHaveBeenCalledWith({
      username: "ana@example.com",
      confirmationCode: "123456",
    });
    expect(session).toEqual({ userId: "sub-a", email: "ana@example.com" });
  });

  it("leaves signing in to the caller when the code step came from a sign-in", async () => {
    auth.confirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: "DONE" },
    });

    expect(await confirmSignUp("ana@example.com", "123456")).toBeNull();
    expect(auth.autoSignIn).not.toHaveBeenCalled();
  });
});

describe("currentSession", () => {
  it("is null when nobody is signed in", async () => {
    auth.getCurrentUser.mockRejectedValue(
      awsError("UserUnAuthenticatedException"),
    );

    expect(await currentSession()).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("returns the access token, refreshed by Amplify when it expired", async () => {
    auth.fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => "access-token", payload: {} } },
    } as never);

    expect(await getAccessToken()).toBe("access-token");
  });

  it("means the session ended when there are no tokens, e.g. after a failed refresh", async () => {
    auth.fetchAuthSession.mockResolvedValue({} as never);

    await expect(getAccessToken()).rejects.toEqual(
      new SyncError("unauthorized"),
    );
  });

  it("means the session ended when the refresh token was refused", async () => {
    auth.fetchAuthSession.mockRejectedValue(awsError("NotAuthorizedException"));

    await expect(getAccessToken()).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("is worth retrying when the refresh couldn't reach Cognito", async () => {
    auth.fetchAuthSession.mockRejectedValue(awsError("NetworkError"));

    await expect(getAccessToken()).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

afterAll(() => log.mockRestore());
