import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import * as store from "./db/moments-store";
import type { AppDb } from "./db/types";
import type { MomentKind } from "./kinds";
import { deletePhotoFiles, savePhoto } from "./photos";
import { useSync } from "./sync-provider";

export type { Moment } from "./db/moments-store";
export { photoUri } from "./photos";

type MomentsContextValue = {
  moments: store.Moment[];
  addMoment: (text: string, tempPhotos: string[], kind?: MomentKind) => void;
  updateMoment: (id: string, text: string, kind?: MomentKind) => void;
  deleteMoment: (id: string) => void;
};

const MomentsContext = createContext<MomentsContextValue | null>(null);

export function MomentsProvider({
  db,
  children,
}: {
  db: AppDb;
  children: ReactNode;
}) {
  const [moments, setMoments] = useState(() => store.listMoments(db));
  const reload = () => setMoments(store.listMoments(db));
  const { onChange, notifyLocalChange } = useSync();

  // Moments that arrived from other devices
  useEffect(
    () => onChange(() => setMoments(store.listMoments(db))),
    [onChange, db],
  );

  const addMoment = (text: string, tempPhotos: string[], kind?: MomentKind) => {
    const photos = tempPhotos.map(savePhoto);
    store.insertMoment(db, { text, photos, kind });
    reload();
    notifyLocalChange();
  };

  const updateMoment = (id: string, text: string, kind?: MomentKind) => {
    store.updateMoment(db, id, { text, kind });
    reload();
    notifyLocalChange();
  };

  const deleteMoment = (id: string) => {
    deletePhotoFiles(store.deleteMoment(db, id));
    reload();
    notifyLocalChange();
  };

  return (
    <MomentsContext.Provider
      value={{ moments, addMoment, updateMoment, deleteMoment }}
    >
      {children}
    </MomentsContext.Provider>
  );
}

export function useMoments() {
  const ctx = useContext(MomentsContext);
  if (!ctx) throw new Error("useMoments must be used inside MomentsProvider");
  return ctx;
}
