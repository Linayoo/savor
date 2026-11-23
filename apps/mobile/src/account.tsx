import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AccountApi } from "./account-api";
import type * as authModule from "./auth/auth";
import { getMeta } from "./db/app-meta";
import { clearAccountData } from "./db/clear-account";
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
// the Account screen says so (spec 005). deleted: the account was deleted,
// here or on another device, and cleared from this phone; the timeline says
// so (spec 010).
export type AccountDeletedWhere = "here" | "elsewhere";
export type AccountState =
  | { status: "loading" }
  | {
      status: "signedOut";
      sessionEnded: boolean;
      deleted?: AccountDeletedWhere;
    }
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
  // For sync, on ACCOUNT_DELETED: clears the account from this phone
  accountDeleted: () => Promise<void>;
  // For sync: called before signing out, and returns how to undo it if the
  // sign-out fails
  onSignOut: (listener: () => () => void) => () => void;
  // For sync: called once the phone's moments were cleared, so the screens
  // reload them
  onCleared: (listener: () => void) => () => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({
  db,
  auth,
  accountApi,
  deleteFiles = () => undefined,
  children,
}: {
  db: AppDb;
  // src/auth/auth.ts in the app, a fake in tests
  auth: AuthService;
  // Account deletion (spec 010); without it, as in most screen tests, a
  // phone never learns its account was deleted
  accountApi?: AccountApi;
  deleteFiles?: (fileNames: string[]) => void;
  children: ReactNode;
}) {
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const signOutListeners = useRef(new Set<() => () => void>());
  const onSignOut = useCallback((listener: () => () => void) => {
    signOutListeners.current.add(listener);
    return () => {
      signOutListeners.current.delete(listener);
    };
  }, []);
  const clearedListeners = useRef(new Set<() => void>());
  const onCleared = useCallback((listener: () => void) => {
    clearedListeners.current.add(listener);
    return () => {
      clearedListeners.current.delete(listener);
    };
  }, []);

  // In spec 010's order: the account's photo files, its rows, then its
  // tokens. Safe to repeat, if the app stopped halfway.
  const clearDeletedAccount = async (where: AccountDeletedWhere) => {
    clearAccountData(db, deleteFiles);
    await auth.signOut().catch(() => undefined);
    setAccount({ status: "signedOut", sessionEnded: false, deleted: where });
    clearedListeners.current.forEach((listener) => listener());
  };

  // A deleted user's refresh fails like any revoked session, so a phone
  // asks the server about its owner. No owner: nothing here is anyone's.
  const ownerWasDeleted = async () => {
    const owner = getMeta(db, "ownerUserId");
    if (!owner || !accountApi) return false;
    return accountApi.wasDeleted(owner).catch(() => false);
  };

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
    const signedOut = async () => {
      setAccount({ status: "signedOut", sessionEnded: false });
      // A phone that was offline when its account was deleted elsewhere
      if (await ownerWasDeleted()) await clearDeletedAccount("elsewhere");
    };
    auth
      .currentSession()
      .then((session) => (session ? accept(session) : signedOut()))
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
    // Syncing stops first, so a sync cut off by the sign-out isn't taken for
    // an ended session
    const undo = [...signOutListeners.current].map((listener) => listener());
    try {
      await auth.signOut();
    } catch (error) {
      undo.forEach((resume) => resume());
      throw error;
    }
    setAccount({ status: "signedOut", sessionEnded: false });
  };

  const endSession = async () => {
    if (await ownerWasDeleted()) {
      await clearDeletedAccount("elsewhere");
      return;
    }
    // The tokens are no good anymore; forget them even if Cognito can't be
    // reached to revoke them
    await auth.signOut().catch(() => undefined);
    setAccount({ status: "signedOut", sessionEnded: true });
  };

  const accountDeleted = () => clearDeletedAccount("elsewhere");

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
        accountDeleted,
        onSignOut,
        onCleared,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

// What the timeline says after an account was deleted; null outside the
// provider, as in screen tests
export function useAccountDeleted(): AccountDeletedWhere | null {
  const account = useContext(AccountContext)?.account;
  return account?.status === "signedOut" ? (account.deleted ?? null) : null;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside AccountProvider");
  return ctx;
}
