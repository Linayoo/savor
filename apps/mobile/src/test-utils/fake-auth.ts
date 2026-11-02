import type { AuthService } from "@/account";
import type { Session } from "@/auth/auth";

const awsError = (name: string) => Object.assign(new Error(name), { name });

// Cognito in memory, behind the same functions as src/auth/auth.ts. Every
// code is CODE; errors carry Cognito's names.
export const CODE = "123456";

type User = { email: string; password: string; userId: string };

// unconfirmed: accounts created earlier whose code was never entered
export function fakeAuth({
  users = [] as User[],
  unconfirmed = [] as User[],
  signedIn = null as Session | null,
} = {}) {
  const accounts = new Map<string, User & { confirmed: boolean }>([
    ...users.map((u) => [u.email, { ...u, confirmed: true }] as const),
    ...unconfirmed.map((u) => [u.email, { ...u, confirmed: false }] as const),
  ]);
  let current = signedIn;
  let justSignedUp: string | null = null;

  const service: AuthService = {
    currentSession: jest.fn(async () => current),
    signIn: jest.fn(async (email: string, password: string) => {
      const account = accounts.get(email.trim().toLowerCase());
      if (!account || account.password !== password) {
        throw awsError("NotAuthorizedException");
      }
      if (!account.confirmed) return { status: "confirmSignUp" as const };
      current = { userId: account.userId, email: account.email };
      return { status: "signedIn" as const, session: current };
    }),
    signUp: jest.fn(async (email: string, password: string) => {
      if (accounts.has(email)) throw awsError("UsernameExistsException");
      accounts.set(email, {
        email,
        password,
        userId: `sub-${email}`,
        confirmed: false,
      });
      justSignedUp = email;
    }),
    confirmSignUp: jest.fn(async (email: string, code: string) => {
      const account = accounts.get(email);
      if (!account) throw awsError("UserNotFoundException");
      if (code.trim() !== CODE) throw awsError("CodeMismatchException");
      account.confirmed = true;
      if (justSignedUp !== email) return null;
      current = { userId: account.userId, email };
      return current;
    }),
    resendSignUpCode: jest.fn(async () => undefined),
    requestPasswordReset: jest.fn(async () => undefined),
    confirmPasswordReset: jest.fn(
      async (email: string, code: string, newPassword: string) => {
        if (code.trim() !== CODE) throw awsError("CodeMismatchException");
        const account = accounts.get(email);
        if (account) account.password = newPassword;
      },
    ),
    signOut: jest.fn(async () => {
      current = null;
    }),
  };
  return service;
}
