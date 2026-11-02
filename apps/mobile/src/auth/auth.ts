import * as amplify from "aws-amplify/auth";
import { SyncError } from "../sync/api";
import { configureAuth } from "./amplify";

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
  } catch {
    return null;
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<
  { status: "signedIn"; session: Session } | { status: "confirmSignUp" }
> {
  configureAuth();
  const { nextStep } = await amplify.signIn({
    username: normalize(email),
    password,
    options: { authFlowType },
  });
  if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
    return { status: "confirmSignUp" };
  }
  return { status: "signedIn", session: await signedInSession() };
}

// Sends the 6-digit code by email
export async function signUp(email: string, password: string) {
  configureAuth();
  await amplify.signUp({
    username: normalize(email),
    password,
    options: {
      userAttributes: { email: normalize(email) },
      autoSignIn: { authFlowType },
    },
  });
}

// Confirms the account and signs the person in
export async function confirmSignUp(
  email: string,
  code: string,
): Promise<Session> {
  configureAuth();
  const { nextStep } = await amplify.confirmSignUp({
    username: normalize(email),
    confirmationCode: code.trim(),
  });
  if (nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
    await amplify.autoSignIn();
  }
  return signedInSession();
}

export async function resendSignUpCode(email: string) {
  configureAuth();
  await amplify.resendSignUpCode({ username: normalize(email) });
}

export async function requestPasswordReset(email: string) {
  configureAuth();
  await amplify.resetPassword({ username: normalize(email) });
}

export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
) {
  configureAuth();
  await amplify.confirmResetPassword({
    username: normalize(email),
    confirmationCode: code.trim(),
    newPassword,
  });
}

// Signs out on this phone only; the moments stay
export async function signOut() {
  configureAuth();
  await amplify.signOut();
}

// For the API: the current access token, which Amplify refreshes when it
// has expired. A refresh that's refused ends the session.
export async function getAccessToken(): Promise<string> {
  configureAuth();
  let session: Awaited<ReturnType<typeof amplify.fetchAuthSession>>;
  try {
    session = await amplify.fetchAuthSession();
  } catch (error) {
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
