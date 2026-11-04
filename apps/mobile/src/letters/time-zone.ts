import { timeZoneSchema } from "@savor/shared";

// The phone's IANA time zone, saved with the setting so letters follow the
// person's months. null when the phone doesn't report a valid one.
export function deviceTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZoneSchema.safeParse(zone).success ? zone : null;
}
