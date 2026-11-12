import {
  momentChangeSchema,
  photoChangeSchema,
  pullInputSchema,
  pushInputSchema,
  setLetterSettingsInputSchema,
  type Letter,
  type LetterSettings,
  type MomentChange,
  type PhotoChange,
  type PullOutput,
  type PushInput,
  type CreateUploadOutput,
  type Quota,
} from "@savor/shared";
import type { LettersApi } from "@/letters/api";
import { SyncError, type SyncApi, type SyncErrorKind } from "@/sync/api";

type Stored<T> = T & { userId: string; version: number };

type Method =
  | "push"
  | "pull"
  | "createUpload"
  | "confirmUpload"
  | "downloadUrls"
  | "upload"
  | "download"
  | "listLetters"
  | "getLetterSettings"
  | "setLetterSettings";

const DOWNLOAD_URL = "https://fake-s3.test/download/";

// As the API builds it, from the signed-in user
export const photoKey = (userId: string, photoId: string) =>
  `users/${userId}/photos/${photoId}.jpg`;

// An in-memory stand-in for the deployed API, with the server rules from
// spec 003 (apps/api/src/sync): per-user increasing versions, last write wins,
// deletes are final, another user's ids are a CONFLICT, and a push is all or
// nothing. Photos (spec 006) go to an in-memory bucket shared by every device,
// under keys the server builds.
export class FakeSyncServer {
  private moments = new Map<string, Stored<MomentChange>>();
  private photos = new Map<
    string,
    Stored<PhotoChange & { uploadedAt: number | null }>
  >();
  private versions = new Map<string, number>();
  private faults: { method: Method; kind: SyncErrorKind; quota?: Quota }[] = [];
  private hold: { started: () => void; released: Promise<void> } | null = null;
  // Letters (spec 007), written by the server's job, never by the phone
  private letters = new Map<string, Letter[]>();
  private letterSettings = new Map<string, LetterSettings>();
  private listHold: { started: () => void; released: Promise<void> } | null =
    null;

  // Every push the server received, accepted or not
  readonly pushes: { userId: string; input: PushInput }[] = [];
  readonly pulls: { userId: string; sinceVersion: number }[] = [];
  readonly photoCalls: { method: Method; photoIds: string[] }[] = [];
  // The photos bucket, by key
  readonly objects = new Map<string, string>();

  // A client signed in as userId
  api(userId: string): SyncApi {
    return {
      push: (input) => this.push(userId, input),
      pull: (input) => this.pull(userId, input),
      createUpload: (input) => this.createUpload(userId, input.photoId),
      confirmUpload: (input) => this.confirmUpload(userId, input.photoId),
      downloadUrls: (input) => this.downloadUrls(userId, input.photoIds),
    };
  }

  // A letters client signed in as userId
  lettersApi(userId: string): LettersApi {
    return {
      list: () => this.listLetters(userId),
      getSettings: () => this.getLetterSettings(userId),
      setSettings: (input) => this.setLetterSettings(userId, input),
    };
  }

  // As the letters job does
  addLetter(userId: string, letter: Letter) {
    this.letters.set(userId, [...(this.letters.get(userId) ?? []), letter]);
  }

  letterSettingsOf(userId: string): LetterSettings {
    return (
      this.letterSettings.get(userId) ?? { enabled: false, timeZone: null }
    );
  }

  // Keeps the next letters.list in flight until release()
  holdNextLettersList() {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((r) => (started = r));
    this.listHold = {
      started,
      released: new Promise<void>((r) => (release = r)),
    };
    return { started: startedPromise, release };
  }

  // The next call to method fails with kind, as a network error or the
  // server would. upload and download are the phone's requests to S3. An
  // overQuota fault names its quota (spec 009).
  failNext(method: Method, kind: SyncErrorKind = "unavailable", quota?: Quota) {
    this.faults.push({ method, kind, quota });
  }

  // S3's side of a presigned POST: stores the file at the form's key
  async receiveUpload(form: CreateUploadOutput, content: string) {
    await Promise.resolve();
    this.takeFault("upload");
    this.objects.set(form.fields.key, content);
  }

  // S3's side of a presigned GET
  async serveDownload(url: string): Promise<string> {
    await Promise.resolve();
    this.takeFault("download");
    const content = this.objects.get(url.slice(DOWNLOAD_URL.length));
    if (content === undefined) throw new SyncError("unavailable", "403");
    return content;
  }

  // Keeps the next push in flight: the server has the request but answers
  // only after release()
  holdNextPush() {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((r) => (started = r));
    this.hold = { started, released: new Promise<void>((r) => (release = r)) };
    return { started: startedPromise, release };
  }

  // What the server holds for a user, without versions, for assertions
  momentsOf(userId: string): MomentChange[] {
    return [...this.moments.values()]
      .filter((m) => m.userId === userId)
      .map(({ userId: _, version: __, ...m }) => m);
  }

  photosOf(userId: string) {
    return [...this.photos.values()]
      .filter((p) => p.userId === userId)
      .map(({ userId: _, version: __, ...p }) => p);
  }

  // As a confirmed upload does: sets uploadedAt with a new version
  markUploaded(userId: string, photoId: string, uploadedAt: number) {
    const photo = this.photos.get(photoId);
    if (!photo || photo.userId !== userId) throw new Error("No such photo");
    const version = (this.versions.get(userId) ?? 0) + 1;
    this.versions.set(userId, version);
    this.photos.set(photoId, { ...photo, uploadedAt, version });
  }

  // Adds changes directly, as other devices' pushes would, without the
  // per-push limit
  seed(userId: string, input: PushInput) {
    this.apply(userId, {
      moments: input.moments.map((m) => momentChangeSchema.parse(m)),
      photos: input.photos.map((p) => photoChangeSchema.parse(p)),
    });
  }

  // The caller's live photo, as the API's ownership check finds it
  private ownPhoto(userId: string, photoId: string) {
    const photo = this.photos.get(photoId);
    if (!photo || photo.userId !== userId || photo.deletedAt !== null) {
      throw new SyncError("notFound");
    }
    return photo;
  }

  private async createUpload(
    userId: string,
    photoId: string,
  ): Promise<CreateUploadOutput> {
    this.photoCalls.push({ method: "createUpload", photoIds: [photoId] });
    await Promise.resolve();
    this.takeFault("createUpload");
    this.ownPhoto(userId, photoId);
    return {
      url: "https://fake-s3.test/",
      fields: { key: photoKey(userId, photoId), "Content-Type": "image/jpeg" },
    };
  }

  private async confirmUpload(userId: string, photoId: string) {
    this.photoCalls.push({ method: "confirmUpload", photoIds: [photoId] });
    await Promise.resolve();
    this.takeFault("confirmUpload");
    const photo = this.ownPhoto(userId, photoId);
    if (photo.uploadedAt !== null) return { uploadedAt: photo.uploadedAt };
    if (!this.objects.has(photoKey(userId, photoId))) {
      throw new SyncError("notFound");
    }
    const uploadedAt = Date.now();
    this.markUploaded(userId, photoId, uploadedAt);
    return { uploadedAt };
  }

  private async downloadUrls(userId: string, photoIds: string[]) {
    this.photoCalls.push({ method: "downloadUrls", photoIds });
    await Promise.resolve();
    this.takeFault("downloadUrls");
    const urls = photoIds.flatMap((photoId) => {
      const photo = this.photos.get(photoId);
      const usable =
        photo?.userId === userId &&
        photo.deletedAt === null &&
        photo.uploadedAt !== null;
      return usable
        ? [{ photoId, url: DOWNLOAD_URL + photoKey(userId, photoId) }]
        : [];
    });
    return { urls };
  }

  private async listLetters(userId: string) {
    await Promise.resolve();
    this.takeFault("listLetters");
    const hold = this.listHold;
    if (hold) {
      this.listHold = null;
      hold.started();
      await hold.released;
    }
    const letters = [...(this.letters.get(userId) ?? [])].sort((a, b) =>
      b.month.localeCompare(a.month),
    );
    return { letters: structuredClone(letters) };
  }

  private async getLetterSettings(userId: string) {
    await Promise.resolve();
    this.takeFault("getLetterSettings");
    return this.letterSettingsOf(userId);
  }

  private async setLetterSettings(userId: string, raw: unknown) {
    await Promise.resolve();
    this.takeFault("setLetterSettings");
    const parsed = setLetterSettingsInputSchema.safeParse(raw);
    if (!parsed.success) throw new SyncError("rejected", parsed.error.message);
    this.letterSettings.set(userId, parsed.data);
    return parsed.data;
  }

  private takeFault(method: Method) {
    const i = this.faults.findIndex((f) => f.method === method);
    if (i === -1) return;
    const [fault] = this.faults.splice(i, 1);
    throw new SyncError(fault.kind, fault.kind, fault.quota);
  }

  private async push(userId: string, raw: PushInput) {
    // Like a real request, the server sees a copy of what was sent
    const sent = structuredClone(raw);
    this.pushes.push({ userId, input: sent });
    await Promise.resolve();
    this.takeFault("push");

    const hold = this.hold;
    if (hold) {
      this.hold = null;
      hold.started();
      await hold.released;
    }

    const parsed = pushInputSchema.safeParse(sent);
    if (!parsed.success) throw new SyncError("rejected", parsed.error.message);
    return { version: this.apply(userId, parsed.data) };
  }

  private apply(userId: string, input: PushInput): number {
    const momentIds = [
      ...input.moments.map((m) => m.id),
      ...input.photos.map((p) => p.momentId),
    ];
    const otherUsers =
      momentIds.some((id) => {
        const row = this.moments.get(id);
        return row && row.userId !== userId;
      }) ||
      input.photos.some((p) => {
        const row = this.photos.get(p.id);
        return row && row.userId !== userId;
      });
    if (otherUsers) throw new SyncError("conflict");

    let version = this.versions.get(userId) ?? 0;
    for (const change of input.moments) {
      version += 1;
      upsert(this.moments, change, userId, version);
    }
    for (const change of input.photos) {
      version += 1;
      // Pushes never change uploadedAt
      const uploadedAt = this.photos.get(change.id)?.uploadedAt ?? null;
      upsert(this.photos, { ...change, uploadedAt }, userId, version);
    }
    this.versions.set(userId, version);

    // As the API does after the push commits
    const deletedMoments = new Set(
      input.moments.filter((m) => m.deletedAt !== null).map((m) => m.id),
    );
    for (const photo of this.photos.values()) {
      if (
        photo.userId === userId &&
        (deletedMoments.has(photo.momentId) ||
          input.photos.some((p) => p.id === photo.id && p.deletedAt !== null))
      ) {
        this.objects.delete(photoKey(userId, photo.id));
      }
    }
    return version;
  }

  private async pull(
    userId: string,
    raw: { sinceVersion: number; limit: number },
  ): Promise<PullOutput> {
    const { sinceVersion, limit } = pullInputSchema.parse(raw);
    this.pulls.push({ userId, sinceVersion });
    await Promise.resolve();
    this.takeFault("pull");

    const newer = <T>(rows: Map<string, Stored<T>>) =>
      [...rows.values()].filter(
        (r) => r.userId === userId && r.version > sinceVersion,
      );
    const merged = [
      ...newer(this.moments).map((row) => ({ type: "moment" as const, row })),
      ...newer(this.photos).map((row) => ({ type: "photo" as const, row })),
    ].sort((a, b) => a.row.version - b.row.version);
    const page = merged.slice(0, limit);

    const output: PullOutput = {
      moments: [],
      photos: [],
      version: page.at(-1)?.row.version ?? sinceVersion,
      hasMore: merged.length > limit,
    };
    for (const item of page) {
      if (item.type === "moment") {
        const { userId: _, ...change } = item.row;
        output.moments.push(structuredClone(change));
      } else {
        const { userId: _, ...change } = item.row;
        output.photos.push(structuredClone(change));
      }
    }
    return output;
  }
}

// Last write wins, but a deleted row only takes another delete. The version
// moves on either way, as on the server.
function upsert<T extends { id: string; deletedAt: number | null }>(
  rows: Map<string, Stored<T>>,
  change: T,
  userId: string,
  version: number,
) {
  const existing = rows.get(change.id);
  if (existing && existing.deletedAt !== null && change.deletedAt === null) {
    return;
  }
  rows.set(change.id, { ...structuredClone(change), userId, version });
}
