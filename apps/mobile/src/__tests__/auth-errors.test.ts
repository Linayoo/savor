import { authErrorMessage, emailProblem, passwordProblem } from "@/auth/errors";

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

  it("never shows the raw service message", () => {
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
  });
});
