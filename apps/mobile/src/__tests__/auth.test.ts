import * as amplifyAuth from "aws-amplify/auth";
import {
  confirmSignUp,
  currentSession,
  getAccessToken,
  signIn,
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
}));

const auth = jest.mocked(amplifyAuth);
const awsError = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  jest.resetAllMocks();
  auth.getCurrentUser.mockResolvedValue({
    userId: "sub-a",
    username: "sub-a",
    signInDetails: { loginId: "ana@example.com" },
  });
});

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
