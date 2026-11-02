import { OTHER_ACCOUNT_MESSAGE } from "../sync/ownership";

// Plain words for the account screens (spec 005): each problem belongs to a
// field, or to the form as a whole, and never shows a raw service message.

export type AuthField = "email" | "password" | "code" | "form";
export type FieldError = { field: AuthField; message: string };

// The user pool's password policy (infra/app/auth.tf)
export const PASSWORD_RULES =
  "At least 12 characters, with an upper case letter, a lower case letter and a number.";

export function passwordProblem(password: string): string | null {
  const missing = [
    password.length < 12 && "at least 12 characters",
    !/[A-Z]/.test(password) && "an upper case letter",
    !/[a-z]/.test(password) && "a lower case letter",
    !/[0-9]/.test(password) && "a number",
  ].filter((m): m is string => Boolean(m));
  if (missing.length === 0) return null;
  return `Your password needs ${missing.join(", ")}.`;
}

export function emailProblem(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? null
    : "This doesn't look like an email address.";
}

const byName: Record<string, FieldError> = {
  UsernameExistsException: {
    field: "email",
    message: "There's already an account with this email. Sign in instead.",
  },
  InvalidPasswordException: {
    field: "password",
    message: `This password doesn't meet the rules. ${PASSWORD_RULES}`,
  },
  // Also an unknown email: the user pool doesn't say which one is wrong
  NotAuthorizedException: {
    field: "password",
    message: "The email or password isn't right.",
  },
  UserNotFoundException: {
    field: "password",
    message: "The email or password isn't right.",
  },
  CodeMismatchException: {
    field: "code",
    message: "That code isn't right. Check the email and try again.",
  },
  ExpiredCodeException: {
    field: "code",
    message: "This code has expired. Ask for a new one.",
  },
  CodeDeliveryFailureException: {
    field: "form",
    message: "We couldn't send the email. Try again in a moment.",
  },
  OwnershipError: { field: "form", message: OTHER_ACCOUNT_MESSAGE },
  NetworkError: {
    field: "form",
    message: "There's no connection. Check that you're online and try again.",
  },
};

const tooManyTries: FieldError = {
  field: "form",
  message: "Too many tries. Wait a few minutes and try again.",
};

export function authErrorMessage(error: unknown): FieldError {
  const name = error instanceof Error ? error.name : "";
  if (name in byName) return byName[name];
  if (/^(LimitExceeded|TooManyRequests|TooManyFailedAttempts)/.test(name)) {
    return tooManyTries;
  }
  if (__DEV__) logAuthError("unknown error", error);
  return { field: "form", message: "Something went wrong. Please try again." };
}

// Development only: prints an auth error's name and message to the Metro
// terminal. Amplify wraps service errors, so the underlying one is printed
// too. Cases that share a name (NotAuthorizedException) differ by message.
export function logAuthError(context: string, error: unknown) {
  if (!(error instanceof Error)) {
    console.log(`[auth] ${context} (not an Error):`, error);
    return;
  }
  const underlying = (error as { underlyingError?: unknown }).underlyingError;
  console.log(`[auth] ${context}: ${error.name}: ${error.message}`);
  if (underlying instanceof Error) {
    console.log(
      `[auth]   underlying: ${underlying.name}: ${underlying.message}`,
    );
  }
}
