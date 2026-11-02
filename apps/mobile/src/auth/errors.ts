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

const tooManyTries: FieldError = {
  field: "form",
  message: "Too many attempts. Wait a few minutes and try again.",
};

const wrongPassword: FieldError = {
  field: "password",
  message: "The email or password isn't right.",
};

const byName: Record<string, FieldError> = {
  UsernameExistsException: {
    field: "email",
    message: "There's already an account with this email. Sign in instead.",
  },
  InvalidPasswordException: {
    field: "password",
    message: `This password doesn't meet the rules. ${PASSWORD_RULES}`,
  },
  UserNotFoundException: wrongPassword,
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

// Cognito uses NotAuthorizedException for a wrong password, too many
// attempts and expired sessions alike; only the message tells them apart.
// Anything that isn't clearly a wrong password gets the fallback.
function notAuthorized(message: string): FieldError | null {
  // Also an unknown email: the user pool doesn't say which one is wrong
  if (/incorrect username or password/i.test(message)) return wrongPassword;
  if (/password attempts exceeded/i.test(message)) return tooManyTries;
  return null;
}

// What the person was doing, so a failure without its own message can still
// say what didn't happen and what to try
export type AuthAction =
  "signIn" | "signUp" | "confirmCode" | "sendCode" | "setPassword";

const fallbacks: Record<AuthAction, string> = {
  signIn: "Couldn't sign in. Check your connection and try again.",
  signUp: "Couldn't create your account. Check your connection and try again.",
  confirmCode:
    "Couldn't confirm the code. Check your connection and try again.",
  sendCode: "Couldn't send the code. Check your connection and try again.",
  setPassword:
    "Couldn't set your password. Check your connection and try again.",
};

export function authErrorMessage(
  error: unknown,
  action: AuthAction,
): FieldError {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAuthorizedException") {
    const known = notAuthorized((error as Error).message);
    if (known) return known;
  } else if (name in byName) {
    return byName[name];
  }
  if (/^(LimitExceeded|TooManyRequests|TooManyFailedAttempts)/.test(name)) {
    return tooManyTries;
  }
  if (__DEV__) logAuthError("unknown error", error);
  return { field: "form", message: fallbacks[action] };
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
