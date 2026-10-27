import { Directory, File, Paths } from "expo-file-system";
import { createContext, ReactNode, useContext, useState } from "react";
import * as store from "./db/moments-store";
import type { AppDb } from "./db/types";
import type { MomentKind } from "./kinds";

export type { Moment } from "./db/moments-store";

const photosDir = new Directory(Paths.document, "photos");

function savePhoto(tempUri: string): string {
  if (!photosDir.exists) photosDir.create({ idempotent: true });
  const source = new File(tempUri);
  const name = `${Date.now()}-${source.name}`;
  source.copySync(new File(photosDir, name));
  return name;
}

export function photoUri(photo: string): string {
  return photo.startsWith("file://") ? photo : new File(photosDir, photo).uri;
}

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

  const addMoment = (text: string, tempPhotos: string[], kind?: MomentKind) => {
    const photos = tempPhotos.map(savePhoto);
    store.insertMoment(db, { text, photos, kind });
    reload();
  };

  const updateMoment = (id: string, text: string, kind?: MomentKind) => {
    store.updateMoment(db, id, { text, kind });
    reload();
  };

  const deleteMoment = (id: string) => {
    const fileNames = store.deleteMoment(db, id);
    fileNames.forEach((p) => {
      if (p.startsWith("file://")) return; // old temporary photos, not ours to delete
      const file = new File(photosDir, p);
      if (file.exists) file.delete();
    });
    reload();
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
