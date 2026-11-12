import NetInfo from "@react-native-community/netinfo";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAccount } from "./account";
import { getMeta } from "./db/app-meta";
import type { AppDb } from "./db/types";
import type { SyncApi } from "./sync/api";
import { SyncEngine, type SyncStatus } from "./sync/engine";
import type { PhotoTransfer } from "./sync/photo-transfer";

type Unsubscribe = () => void;

export type SyncContextValue = {
  // null while signed out: nothing syncs
  status: SyncStatus | null;
  online: boolean;
  // Photos the server had no space for, waiting on this phone (spec 009)
  photosWaitingForSpace: boolean;
  // For pull-to-refresh; never rejects
  syncNow: () => Promise<void>;
  notifyLocalChange: () => void;
  // Called when a sync brought changes from another device
  onChange: (listener: () => void) => Unsubscribe;
};

const noListeners = () => () => undefined;
const signedOut: SyncContextValue = {
  status: null,
  online: true,
  photosWaitingForSpace: false,
  syncNow: async () => undefined,
  notifyLocalChange: () => undefined,
  onChange: noListeners,
};

// Signed out, or outside the provider (as in most screen tests), sync does
// nothing and the app works as before
const SyncContext = createContext<SyncContextValue>(signedOut);

const connectionFromNetInfo = (onChange: (online: boolean) => void) =>
  NetInfo.addEventListener((state) =>
    onChange(
      state.isConnected !== false && state.isInternetReachable !== false,
    ),
  );

const foregroundFromAppState = (onActive: () => void) => {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") onActive();
  });
  return () => subscription.remove();
};

// Runs the sync engine while an account is signed in, with the triggers from
// spec 005: app open, back to the foreground, a few seconds after a local
// change, pull-to-refresh, and the connection coming back
export function SyncProvider({
  db,
  createApi,
  deleteFiles,
  transfer,
  subscribeToConnection = connectionFromNetInfo,
  subscribeToForeground = foregroundFromAppState,
  children,
}: {
  db: AppDb;
  // Called once per sign-in
  createApi: () => SyncApi;
  deleteFiles: (fileNames: string[]) => void;
  transfer: PhotoTransfer;
  subscribeToConnection?: (onChange: (online: boolean) => void) => Unsubscribe;
  subscribeToForeground?: (onActive: () => void) => Unsubscribe;
  children: ReactNode;
}) {
  const { account, endSession, onSignOut } = useAccount();
  const userId = account.status === "signedIn" ? account.session.userId : null;
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [online, setOnline] = useState(true);
  const changeListeners = useRef(new Set<() => void>());
  const onChange = useCallback((listener: () => void) => {
    changeListeners.current.add(listener);
    return () => {
      changeListeners.current.delete(listener);
    };
  }, []);

  // Dependencies are fixed for the app's lifetime; the engine follows the
  // signed-in account only
  const deps = useRef({ createApi, deleteFiles, transfer });
  const endSessionRef = useRef(endSession);
  useEffect(() => {
    endSessionRef.current = endSession;
  });

  useEffect(() => {
    if (!userId) return;
    const next = new SyncEngine({
      db,
      api: deps.current.createApi(),
      now: Date.now,
      deleteFiles: deps.current.deleteFiles,
      transfer: deps.current.transfer,
    });
    const offStatus = next.subscribe((nextStatus) => {
      setStatus(nextStatus);
      // Tokens that can't be refreshed end the session; the moments stay
      if (
        nextStatus.phase === "stopped" &&
        nextStatus.problem === "unauthorized"
      ) {
        next.stop();
        void endSessionRef.current();
      }
    });
    const offSignOut = onSignOut(() => {
      next.stop();
      return () => {
        next.resume();
        void next.sync();
      };
    });
    const offChange = next.onChange(() =>
      changeListeners.current.forEach((listener) => listener()),
    );
    setEngine(next);
    setStatus(next.status);
    void next.sync();

    return () => {
      next.stop();
      offStatus();
      offSignOut();
      offChange();
      setEngine(null);
      setStatus(null);
    };
  }, [db, userId, onSignOut]);

  useEffect(() => {
    if (!engine) return;
    let wasOnline = true;
    const offConnection = subscribeToConnection((isOnline) => {
      setOnline(isOnline);
      if (isOnline && !wasOnline) void engine.sync();
      wasOnline = isOnline;
    });
    const offForeground = subscribeToForeground(() => void engine.sync());
    return () => {
      offConnection();
      offForeground();
    };
  }, [engine, subscribeToConnection, subscribeToForeground]);

  const value = useMemo<SyncContextValue>(
    () =>
      engine && status
        ? {
            status,
            online,
            // Each sync's uploads update it before the status changes
            photosWaitingForSpace: getMeta(db, "photosWaitingForSpace"),
            syncNow: () => engine.sync(),
            notifyLocalChange: () => engine.notifyLocalChange(),
            onChange,
          }
        : { ...signedOut, onChange },
    [db, engine, status, online, onChange],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  return useContext(SyncContext);
}
