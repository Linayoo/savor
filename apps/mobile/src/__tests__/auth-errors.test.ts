import { authErrorMessage, emailProblem, passwordProblem } from "@/auth/errors";
import { OwnershipError } from "@/sync/ownership";

const awsError = (name: string, message = "raw service message") =>
  Object.assign(new Error(message), { name });

describe("passwordProblem", () => {
  it.each([
    ["Short1Aa", "at least 12 characters"],
    ["alllowercase123", "an upper case letter"],
    ["ALLUPPERCASE123", "a lower case letter"],
    ["NoNumbersHereAtAll", "a number"],
  ])("explains what %s is missing", (password, missing) => {
    expect(passwordProblem(password)).toContain(missing);
  });

  it("accepts a password that meets the user pool's rules", () => {
    expect(passwordProblem("Ramen with Ana 2026")).toBeNull();
  });
});

describe("emailProblem", () => {
  it.each(["", "ana", "ana@", "@example.com", "ana @example.com"])(
    "rejects %j",
    (email) => {
      expect(emailProblem(email)).not.toBeNull();
    },
  );

  it("accepts an email address", () => {
    expect(emailProblem(" ana@example.com ")).toBeNull();
  });
});

describe("authErrorMessage", () => {
  it.each([
    ["UsernameExistsException", "email"],
    ["InvalidPasswordException", "password"],
    ["UserNotFoundException", "password"],
    ["CodeMismatchException", "code"],
    ["ExpiredCodeException", "code"],
    ["LimitExceededException", "form"],
    ["TooManyRequestsException", "form"],
    ["NetworkError", "form"],
    ["SomethingNewException", "form"],
  ])("puts %s next to the %s field", (name, field) => {
    expect(authErrorMessage(awsError(name), "signIn").field).toBe(field);
  });

  it("explains that the phone belongs to another account", () => {
    expect(authErrorMessage(new OwnershipError(), "signIn")).toEqual({
      field: "form",
      message:
        "This phone holds moments from another account. Sign in with that account to keep syncing.",
    });
  });

  it("never shows the raw service message", () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    for (const name of [
      "UsernameExistsException",
      "NotAuthorizedException",
      "SomethingNewException",
    ]) {
      expect(authErrorMessage(awsError(name), "signIn").message).not.toContain(
        "raw service message",
      );
    }
    expect(authErrorMessage("not even an error", "signIn").message).toBe(
      "Couldn't sign in. Check your connection and try again.",
    );
    jest.restoreAllMocks();
  });
});

// Cognito uses one name for several cases; only the message tells them apart
describe("NotAuthorizedException", () => {
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("is a wrong email or password only when Cognito says so", () => {
    expect(
      authErrorMessage(
        awsError("NotAuthorizedException", "Incorrect username or password."),
        "signIn",
      ),
    ).toEqual({
      field: "password",
      message: "The email or password isn't right.",
    });
  });

  it("asks to wait after too many password attempts", () => {
    expect(
      authErrorMessage(
        awsError("NotAuthorizedException", "Password attempts exceeded"),
        "signIn",
      ),
    ).toEqual({
      field: "form",
      message: "Too many attempts. Wait a few minutes and try again.",
    });
  });

  it.each([
    "Invalid session for the user, session is expired.",
    "Refresh Token has expired",
    "User cannot be confirmed. Current status is CONFIRMED",
    "raw service message",
  ])("isn't blamed on the password for %j", (message) => {
    expect(
      authErrorMessage(awsError("NotAuthorizedException", message), "signIn"),
    ).toEqual({
      field: "form",
      message: "Couldn't sign in. Check your connection and try again.",
    });
  });
});

describe("errors without their own message", () => {
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["signIn", "Couldn't sign in. Check your connection and try again."],
    [
      "signUp",
      "Couldn't create your account. Check your connection and try again.",
    ],
    [
      "confirmCode",
      "Couldn't confirm the code. Check your connection and try again.",
    ],
    [
      "sendCode",
      "Couldn't send the code. Check your connection and try again.",
    ],
    [
      "setPassword",
      "Couldn't set your password. Check your connection and try again.",
    ],
  ] as const)("say what failed in %s and what to do", (action, message) => {
    expect(authErrorMessage(awsError("SomethingNewException"), action)).toEqual(
      { field: "form", message },
    );
  });
});

describe("unknown errors in development", () => {
  it("prints the name and message, and Amplify's underlying error, to Metro", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = Object.assign(awsError("SomethingNewException", "details"), {
      underlyingError: awsError("InnerException", "inner details"),
    });

    authErrorMessage(error, "signIn");

    expect(log.mock.calls.map((call) => call.join(" "))).toEqual([
      "[auth] unknown error: SomethingNewException: details",
      "[auth]   underlying: InnerException: inner details",
    ]);
    log.mockRestore();
  });

  // auth.ts has already printed every failed action
  it("prints nothing more for errors that have a message", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    authErrorMessage(awsError("CodeMismatchException"), "signIn");

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
