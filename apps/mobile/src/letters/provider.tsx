import type { Letter, LetterSettings } from "@savor/shared";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAccount } from "../account";
import { clearLetters, listLetters, replaceLetters } from "../db/letters-store";
import type { AppDb } from "../db/types";
import { useSync } from "../sync-provider";
import type { LettersApi } from "./api";

type LettersContextValue = {
  // The phone's copy, newest month first
  letters: Letter[];
  // null while signed out or not known yet
  settings: LetterSettings | null;
  // Never rejects: without a connection the copy stays
  refresh: () => Promise<void>;
  // Rejects with a SyncError when the server didn't save it
  saveSettings: (enabled: boolean, timeZone: string) => Promise<void>;
};

const LettersContext = createContext<LettersContextValue>({
  letters: [],
  settings: null,
  refresh: async () => undefined,
  saveSettings: async () => {
    throw new Error("Not signed in");
  },
});

// Keeps the phone's copy of the letters (spec 007): fetched once signed in,
// after each sync and when the Letters tab opens, and removed on sign-out
export function LettersProvider({
  db,
  createApi,
  children,
}: {
  db: AppDb;
  // Called once per sign-in
  createApi: () => LettersApi;
  children: ReactNode;
}) {
  const { account } = useAccount();
  const { status } = useSync();
  const userId = account.status === "signedIn" ? account.session.userId : null;
  const lastSyncedAt = status?.lastSyncedAt ?? null;
  const [letters, setLetters] = useState(() => listLetters(db));
  const [settings, setSettings] = useState<LetterSettings | null>(null);
  // On sign-in or sign-out, start again from the phone's copy, which a
  // sign-out empties
  const [shownFor, setShownFor] = useState(userId);
  if (shownFor !== userId) {
    setShownFor(userId);
    setLetters(userId ? listLetters(db) : []);
    setSettings(null);
  }
  // This sign-in's client; a fetch that finishes after it changed is dropped
  const api = useRef<LettersApi | null>(null);
  const createApiRef = useRef(createApi);

  const refresh = useCallback(async () => {
    const current = api.current;
    if (!current) return;
    const [fetched, fetchedSettings] = await Promise.allSettled([
      current.list(),
      current.getSettings(),
    ]);
    if (api.current !== current) return;
    if (fetched.status === "fulfilled") {
      replaceLetters(db, fetched.value.letters);
      setLetters(listLetters(db));
    }
    if (fetchedSettings.status === "fulfilled") {
      setSettings(fetchedSettings.value);
    }
  }, [db]);

  useEffect(() => {
    if (!userId) return;
    api.current = createApiRef.current();
    return () => {
      api.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (userId) void refresh();
  }, [userId, lastSyncedAt, refresh]);

  // Signed out, by choice or because the session ended
  useEffect(() => {
    if (account.status === "signedOut") clearLetters(db);
  }, [account.status, db]);

  const saveSettings = useCallback(
    async (enabled: boolean, timeZone: string) => {
      const current = api.current;
      if (!current) throw new Error("Not signed in");
      const saved = await current.setSettings({ enabled, timeZone });
      if (api.current === current) setSettings(saved);
    },
    [],
  );

  return (
    <LettersContext.Provider
      value={{ letters, settings, refresh, saveSettings }}
    >
      {children}
    </LettersContext.Provider>
  );
}

export function useLetters() {
  return useContext(LettersContext);
}
