import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type * as authModule from "./auth/auth";
import type { AppDb } from "./db/types";
import { claimPhone, OwnershipError } from "./sync/ownership";

type Session = authModule.Session;

export type AuthService = Pick<
  typeof authModule,
  | "currentSession"
  | "signIn"
  | "signUp"
  | "confirmSignUp"
  | "resendSignUpCode"
  | "requestPasswordReset"
  | "confirmPasswordReset"
  | "signOut"
>;

// sessionEnded: tokens could no longer be refreshed, so syncing stopped and
// the Account screen says so (spec 005)
export type AccountState =
  | { status: "loading" }
  | { status: "signedOut"; sessionEnded: boolean }
  | { status: "signedIn"; session: Session };

type AccountContextValue = {
  account: AccountState;
  signIn: (
    email: string,
    password: string,
  ) => Promise<"signedIn" | "confirmSignUp">;
  signUp: (email: string, password: string) => Promise<void>;
  // The password signs the person in when the code step came from a sign-in
  confirmSignUp: (
    email: string,
    code: string,
    password: string,
  ) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (
    email: string,
    code: string,
    newPassword: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  endSession: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({
  db,
  auth,
  children,
}: {
  db: AppDb;
  // src/auth/auth.ts in the app, a fake in tests
  auth: AuthService;
  children: ReactNode;
}) {
  const [account, setAccount] = useState<AccountState>({ status: "loading" });

  // Every sign-in goes through here: the phone's moments belong to one
  // account, and another one is signed out again before anything syncs
  const accept = async (session: Session) => {
    if (claimPhone(db, session.userId) === "otherAccount") {
      // The ownership message stands even if this fails; the next sign-in
      // signs out whoever Amplify still holds first
      await auth.signOut().catch(() => undefined);
      setAccount({ status: "signedOut", sessionEnded: false });
      throw new OwnershipError();
    }
    setAccount({ status: "signedIn", session });
  };

  useEffect(() => {
    auth
      .currentSession()
      .then((session) =>
        session
          ? accept(session)
          : setAccount({ status: "signedOut", sessionEnded: false }),
      )
      .catch(() => setAccount({ status: "signedOut", sessionEnded: false }));
    // Runs once, when the app opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    const result = await auth.signIn(email, password);
    if (result.status === "confirmSignUp") return "confirmSignUp";
    await accept(result.session);
    return "signedIn";
  };

  const confirmSignUp = async (
    email: string,
    code: string,
    password: string,
  ) => {
    const session = await auth.confirmSignUp(email, code);
    if (session) {
      await accept(session);
      return;
    }
    const result = await auth.signIn(email, password);
    if (result.status !== "signedIn") throw new Error("Still not confirmed");
    await accept(result.session);
  };

  const signOut = async () => {
    await auth.signOut();
    setAccount({ status: "signedOut", sessionEnded: false });
  };

  const endSession = async () => {
    // The tokens are no good anymore; forget them even if Cognito can't be
    // reached to revoke them
    await auth.signOut().catch(() => undefined);
    setAccount({ status: "signedOut", sessionEnded: true });
  };

  return (
    <AccountContext.Provider
      value={{
        account,
        signIn,
        signUp: auth.signUp,
        confirmSignUp,
        resendSignUpCode: auth.resendSignUpCode,
        requestPasswordReset: auth.requestPasswordReset,
        confirmPasswordReset: auth.confirmPasswordReset,
        signOut,
        endSession,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside AccountProvider");
  return ctx;
}
