import { UPLOAD_CONDITIONS } from "../src/photos/s3-storage";
import {
  DOWNLOAD_EXPIRES_SECONDS,
  PHOTO_CONTENT_TYPE,
  UPLOAD_EXPIRES_SECONDS,
  type PhotoStorage,
  type PresignedUpload,
} from "../src/photos/storage";

type Policy = {
  conditions: NonNullable<typeof UPLOAD_CONDITIONS>;
  key: string;
  expiresAt: number;
};
type StoredObject = { size: number; contentType: string };

export class S3Refused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// S3 in memory, for API tests. Upload forms carry a policy, as S3's do, and
// upload() checks a file against it the way S3 would: the exact key, the
// conditions from s3-storage.ts and the expiry.
export class FakePhotoStorage implements PhotoStorage {
  now = () => Date.now();
  failDeletes = false;
  readonly objects = new Map<string, StoredObject>();
  readonly deletes: string[][] = [];
  private policies = new Map<string, Policy>();

  async createUpload(key: string): Promise<PresignedUpload> {
    const policy = String(this.policies.size + 1);
    this.policies.set(policy, {
      conditions: [...UPLOAD_CONDITIONS, { key }],
      key,
      expiresAt: this.now() + UPLOAD_EXPIRES_SECONDS * 1000,
    });
    return {
      url: "https://fake-s3.test/",
      fields: { key, "Content-Type": PHOTO_CONTENT_TYPE, Policy: policy },
    };
  }

  // What the phone's POST does. Throws S3Refused when S3 would refuse it.
  async upload(
    { fields }: PresignedUpload,
    file: { size: number; contentType?: string },
  ) {
    const policy = this.policies.get(fields.Policy);
    if (!policy) throw new S3Refused("AccessDenied");
    if (this.now() > policy.expiresAt) throw new S3Refused("AccessDenied");
    const form: Record<string, string> = {
      ...fields,
      "Content-Type": file.contentType ?? fields["Content-Type"],
    };

    for (const condition of policy.conditions) {
      if (Array.isArray(condition)) {
        const [op, a, b] = condition;
        if (op === "content-length-range") {
          if (file.size < Number(a)) throw new S3Refused("EntityTooSmall");
          if (file.size > Number(b)) throw new S3Refused("EntityTooLarge");
        } else if (op === "eq" && form[String(a).slice(1)] !== b) {
          throw new S3Refused("AccessDenied");
        } else if (
          op === "starts-with" &&
          !String(form[String(a).slice(1)] ?? "").startsWith(String(b))
        ) {
          throw new S3Refused("AccessDenied");
        }
      } else {
        for (const [name, value] of Object.entries(condition)) {
          if (form[name] !== value) throw new S3Refused("AccessDenied");
        }
      }
    }
    this.objects.set(policy.key, {
      size: file.size,
      contentType: form["Content-Type"],
    });
  }

  async size(key: string) {
    return this.objects.get(key)?.size ?? null;
  }

  async downloadUrl(key: string) {
    const expires = this.now() + DOWNLOAD_EXPIRES_SECONDS * 1000;
    return `https://fake-s3.test/${key}?expires=${expires}`;
  }

  // What the phone's GET does
  get(url: string): StoredObject {
    const { pathname, searchParams } = new URL(url);
    if (this.now() > Number(searchParams.get("expires"))) {
      throw new S3Refused("AccessDenied");
    }
    const object = this.objects.get(pathname.slice(1));
    if (!object) throw new S3Refused("NoSuchKey");
    return object;
  }

  async deleteAll(keys: string[]) {
    if (this.failDeletes) throw new Error("S3 is unavailable");
    this.deletes.push(keys);
    keys.forEach((key) => this.objects.delete(key));
  }
}
