import * as amplify from "aws-amplify/auth";
import { SyncError } from "../sync/api";
import { configureAuth } from "./amplify";
import { logAuthError } from "./errors";

// The account actions the screens need, on top of Amplify Auth v6. Errors
// are Amplify's; the screens turn them into words with authErrorMessage.

export type Session = { userId: string; email: string };

// SRP is the only password flow the app client allows (spec 004)
const authFlowType = "USER_SRP_AUTH";

const normalize = (email: string) => email.trim().toLowerCase();

// Who is signed in, from what's stored on the phone; works offline
export async function currentSession(): Promise<Session | null> {
  configureAuth();
  try {
    const user = await amplify.getCurrentUser();
    return {
      userId: user.userId,
      email: user.signInDetails?.loginId ?? user.username,
    };
  } catch (error) {
    // Nobody signed in is the normal case, not an error
    if (__DEV__ && (error as Error)?.name !== "UserUnAuthenticatedException") {
      logAuthError("currentSession failed", error);
    }
    return null;
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<
  { status: "signedIn"; session: Session } | { status: "confirmSignUp" }
> {
  return run("signIn", async () => {
    configureAuth();
    await signOutLeftoverUser();
    const { nextStep } = await amplify.signIn({
      username: normalize(email),
      password,
      options: { authFlowType },
    });
    if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
      return { status: "confirmSignUp" };
    }
    return { status: "signedIn", session: await signedInSession() };
  });
}

// Sends the 6-digit code by email
export async function signUp(email: string, password: string) {
  return run("signUp", async () => {
    configureAuth();
    await signOutLeftoverUser();
    await amplify.signUp({
      username: normalize(email),
      password,
      options: {
        userAttributes: { email: normalize(email) },
        autoSignIn: { authFlowType },
      },
    });
  });
}

// Confirms the account. Right after signUp, Amplify signs the person in and
// this returns the session; otherwise (the code step came from a sign-in) it
// returns null and the caller signs in with the password.
export async function confirmSignUp(
  email: string,
  code: string,
): Promise<Session | null> {
  return run("confirmSignUp", async () => {
    configureAuth();
    const { nextStep } = await amplify.confirmSignUp({
      username: normalize(email),
      confirmationCode: code.trim(),
    });
    if (nextStep.signUpStep !== "COMPLETE_AUTO_SIGN_IN") return null;
    await amplify.autoSignIn();
    return signedInSession();
  });
}

export async function resendSignUpCode(email: string) {
  return run("resendSignUpCode", async () => {
    configureAuth();
    await amplify.resendSignUpCode({ username: normalize(email) });
  });
}

export async function requestPasswordReset(email: string) {
  return run("requestPasswordReset", async () => {
    configureAuth();
    await amplify.resetPassword({ username: normalize(email) });
  });
}

export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
) {
  return run("confirmPasswordReset", async () => {
    configureAuth();
    await amplify.confirmResetPassword({
      username: normalize(email),
      confirmationCode: code.trim(),
      newPassword,
    });
  });
}

// Signs out on this phone only; the moments stay
export async function signOut() {
  return run("signOut", async () => {
    configureAuth();
    await amplify.signOut();
  });
}

// For the API: the current access token, which Amplify refreshes when it
// has expired. A refresh that's refused ends the session.
export async function getAccessToken(): Promise<string> {
  configureAuth();
  let session: Awaited<ReturnType<typeof amplify.fetchAuthSession>>;
  try {
    session = await amplify.fetchAuthSession();
  } catch (error) {
    if (__DEV__) logAuthError("token refresh failed", error);
    const name = error instanceof Error ? error.name : "";
    throw new SyncError(
      name === "NotAuthorizedException" ? "unauthorized" : "unavailable",
    );
  }
  const token = session.tokens?.accessToken.toString();
  if (!token) throw new SyncError("unauthorized");
  return token;
}

async function signedInSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error("Signed in, but no user is stored");
  return session;
}

// Every account action goes through here, one at a time: a sign-in that
// started while a sign-out was still finishing would be refused by Amplify,
// or lose its tokens to it. In development, a failure is printed to the
// Metro terminal before the screen turns it into words.
let queue: Promise<unknown> = Promise.resolve();

function run<T>(action: string, task: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    try {
      return await task();
    } catch (error) {
      if (__DEV__) logAuthError(`${action} failed`, error);
      throw error;
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

// A user Amplify still holds, such as an account the phone refused whose
// sign-out failed, would make the next sign-in fail
async function signOutLeftoverUser() {
  const signedIn = await amplify.getCurrentUser().then(
    () => true,
    () => false,
  );
  if (signedIn) await amplify.signOut();
}
