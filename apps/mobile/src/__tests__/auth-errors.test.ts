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
    ["NotAuthorizedException", "password"],
    ["CodeMismatchException", "code"],
    ["ExpiredCodeException", "code"],
    ["LimitExceededException", "form"],
    ["TooManyRequestsException", "form"],
    ["NetworkError", "form"],
    ["SomethingNewException", "form"],
  ])("puts %s next to the %s field", (name, field) => {
    expect(authErrorMessage(awsError(name)).field).toBe(field);
  });

  it("explains that the phone belongs to another account", () => {
    expect(authErrorMessage(new OwnershipError())).toEqual({
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
      expect(authErrorMessage(awsError(name)).message).not.toContain(
        "raw service message",
      );
    }
    expect(authErrorMessage("not even an error").message).toBe(
      "Something went wrong. Please try again.",
    );
    jest.restoreAllMocks();
  });
});

describe("unknown errors in development", () => {
  it("prints the name and message, and Amplify's underlying error, to Metro", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const error = Object.assign(awsError("SomethingNewException", "details"), {
      underlyingError: awsError("InnerException", "inner details"),
    });

    authErrorMessage(error);

    expect(log.mock.calls.map((call) => call.join(" "))).toEqual([
      "[auth] unknown error: SomethingNewException: details",
      "[auth]   underlying: InnerException: inner details",
    ]);
    log.mockRestore();
  });

  // auth.ts has already printed every failed action
  it("prints nothing more for errors that have a message", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});

    authErrorMessage(awsError("CodeMismatchException"));

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
