import { MAX_PHOTOS_PER_MOMENT, type Quota } from "@savor/shared";
import { TRPCError } from "@trpc/server";

// The limits from spec 009, generous for a real person. Days are UTC days of
// arrival at the server.
export const LIMITS = {
  photosPerMoment: MAX_PHOTOS_PER_MOMENT,
  momentsPerDay: 500,
  uploadsPerDay: 300,
  storageBytes: 5 * 1024 ** 3,
};

// The cause of a quota refusal, which the error formatter (trpc.ts) turns
// into `data.quota`
export class QuotaExceeded extends Error {
  constructor(readonly quota: Quota) {
    super(`Over the ${quota} quota`);
    this.name = "QuotaExceeded";
  }
}

export const quotaExceeded = (quota: Quota) =>
  new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Over the ${quota} quota`,
    cause: new QuotaExceeded(quota),
  });
