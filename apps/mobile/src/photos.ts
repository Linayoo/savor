import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { SyncError } from "./sync/api";
import type { PhotoTransfer } from "./sync/photo-transfer";

// Photos are copied into the app's documents folder and stored by file name

const photosDir = new Directory(Paths.document, "photos");

export function savePhoto(tempUri: string): string {
  if (!photosDir.exists) photosDir.create({ idempotent: true });
  const source = new File(tempUri);
  const name = `${Date.now()}-${source.name}`;
  source.copySync(new File(photosDir, name));
  return name;
}

export function photoUri(photo: string): string {
  return photo.startsWith("file://") ? photo : new File(photosDir, photo).uri;
}

// For deleted moments, whether deleted here or on another device
export function deletePhotoFiles(fileNames: string[]) {
  fileNames.forEach((p) => {
    if (p.startsWith("file://")) return; // old temporary photos, not ours to delete
    const file = new File(photosDir, p);
    if (file.exists) file.delete();
  });
}

// Upload copies (spec 006): decoded to fit 2048 px, then encoded as a new
// JPEG. The encoder writes the pixels only, so EXIF and GPS are left behind.
const MAX_EDGE = 2048;

export const photoTransfer: PhotoTransfer = {
  exists: (fileName) => new File(photoUri(fileName)).exists,

  uploadCopy: async (fileName) => {
    const image = await ImageManipulator.manipulate(photoUri(fileName), {
      maxWidth: MAX_EDGE,
      maxHeight: MAX_EDGE,
    }).renderAsync();
    const { uri } = await image.saveAsync({
      compress: 0.8,
      format: SaveFormat.JPEG,
    });
    return uri;
  },

  // S3 takes the form's fields first and the file last
  upload: async ({ url, fields }, uri) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields))
      form.append(name, value);
    // React Native's FormData sends a file given as a uri
    form.append("file", {
      uri,
      name: "photo.jpg",
      type: "image/jpeg",
    } as unknown as Blob);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", body: form });
    } catch {
      throw new SyncError("unavailable");
    }
    // An expired form is refused too; the next sync asks for a new one
    if (!response.ok) {
      throw new SyncError("unavailable", `S3 answered ${response.status}`);
    }
  },

  discard: (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};
