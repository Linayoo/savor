import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { MomentKind } from "./kinds";

export type Moment = {
  id: string;
  text: string;
  photos?: string[];
  kind?: MomentKind;
  createdAt: number;
};

const STORAGE_KEY = "savor.moments";
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
  moments: Moment[];
  addMoment: (text: string, tempPhotos: string[], kind?: MomentKind) => void;
  updateMoment: (id: string, text: string, kind?: MomentKind) => void;
  deleteMoment: (id: string) => void;
};

const MomentsContext = createContext<MomentsContextValue | null>(null);

export function MomentsProvider({ children }: { children: ReactNode }) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((json) => {
      if (json) setMoments(JSON.parse(json));
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(moments));
  }, [moments, loaded]);

  const addMoment = (text: string, tempPhotos: string[], kind?: MomentKind) => {
    const photos = tempPhotos.map(savePhoto);
    const now = Date.now();
    setMoments((prev) => [
      { id: String(now), text, photos, createdAt: now, ...(kind && { kind }) },
      ...prev,
    ]);
  };

  const updateMoment = (id: string, text: string, kind?: MomentKind) => {
    setMoments((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const updated: Moment = { ...m, text, kind };
        if (!kind) delete updated.kind;
        return updated;
      }),
    );
  };

  const deleteMoment = (id: string) => {
    const target = moments.find((m) => m.id === id);
    target?.photos?.forEach((p) => {
      if (p.startsWith("file://")) return; // old temporary photos, not ours to delete
      const file = new File(photosDir, p);
      if (file.exists) file.delete();
    });
    setMoments((prev) => prev.filter((m) => m.id !== id));
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
