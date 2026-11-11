import AsyncStorage from "@react-native-async-storage/async-storage";
import { ReactNode, useEffect, useState } from "react";
import { logAuthError } from "./errors";
import { clearLeftoverSignIn } from "./fresh-install";
import { SecureTokenStorage } from "./secure-storage";

// Clears sign-in left in the Keychain by an earlier install, before anything
// reads it. If that fails the app still opens, and the next launch retries.
export function FreshInstallGate({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    clearLeftoverSignIn(AsyncStorage, new SecureTokenStorage())
      .catch((error) => {
        if (__DEV__) logAuthError("clearLeftoverSignIn failed", error);
      })
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;
  return children;
}
