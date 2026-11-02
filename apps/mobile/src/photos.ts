import { Directory, File, Paths } from "expo-file-system";

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
