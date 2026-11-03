import type { CreateUploadOutput } from "@savor/shared";
import type { PhotoTransfer } from "@/sync/photo-transfer";
import type { FakeSyncServer } from "./fake-sync-server";

// One phone's photos folder, in memory, sending files to the fake server's
// bucket
export class FakePhotoTransfer implements PhotoTransfer {
  // File name to content
  readonly files = new Map<string, string>();
  // Upload copies not discarded yet, by uri
  readonly copies = new Map<string, string>();

  constructor(private readonly server: FakeSyncServer) {}

  // A photo kept on this phone
  add(fileName: string) {
    this.files.set(fileName, `pixels of ${fileName}`);
  }

  exists(fileName: string) {
    return this.files.has(fileName);
  }

  async uploadCopy(fileName: string) {
    const content = this.files.get(fileName);
    if (content === undefined) throw new Error(`No file ${fileName}`);
    const uri = `cache://upload-copy-of-${fileName}`;
    this.copies.set(uri, `2048px jpeg of ${content}`);
    return uri;
  }

  async upload(form: CreateUploadOutput, uri: string) {
    const content = this.copies.get(uri);
    if (content === undefined) throw new Error(`No copy at ${uri}`);
    await this.server.receiveUpload(form, content);
  }

  discard(uri: string) {
    this.copies.delete(uri);
  }

  async download(url: string, photoId: string) {
    const content = await this.server.serveDownload(url);
    const fileName = `${photoId}.jpg`;
    this.files.set(fileName, content);
    return fileName;
  }

  // The app's deleteFiles
  delete = (fileNames: string[]) => {
    fileNames.forEach((name) => this.files.delete(name));
  };
}
