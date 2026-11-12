// Per-user quotas the API enforces (spec 009). The app shares the photo limit
// for its picker; the others are only the API's.
export const MAX_PHOTOS_PER_MOMENT = 10;

// Named in a refusal, as the `quota` of a TOO_MANY_REQUESTS error
export const QUOTAS = [
  "photosPerMoment",
  "momentsPerDay",
  "uploadsPerDay",
  "storage",
] as const;
export type Quota = (typeof QUOTAS)[number];
