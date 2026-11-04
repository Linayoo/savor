import { describe, expect, it } from "vitest";
import {
  letterMonthSchema,
  letterSettingsSchema,
  setLetterSettingsInputSchema,
  timeZoneSchema,
} from "./index";

describe("timeZoneSchema", () => {
  it.each(["Europe/Zurich", "Pacific/Honolulu", "Asia/Kolkata", "UTC"])(
    "accepts the IANA zone %s",
    (zone) => {
      expect(timeZoneSchema.parse(zone)).toBe(zone);
    },
  );

  it.each([
    "",
    "Mars/Olympus",
    "GMT+25",
    "Europe/Zurich; drop table",
    "x".repeat(65),
  ])("refuses %j", (zone) => {
    expect(timeZoneSchema.safeParse(zone).success).toBe(false);
  });
});

describe("letterMonthSchema", () => {
  it.each(["2026-10", "2027-01", "2026-12"])("accepts %s", (month) => {
    expect(letterMonthSchema.parse(month)).toBe(month);
  });

  it.each(["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01"])(
    "refuses %s",
    (month) => {
      expect(letterMonthSchema.safeParse(month).success).toBe(false);
    },
  );
});

describe("setLetterSettingsInputSchema", () => {
  it("needs the time zone with the switch", () => {
    expect(
      setLetterSettingsInputSchema.safeParse({ enabled: true }).success,
    ).toBe(false);
    expect(
      setLetterSettingsInputSchema.parse({
        enabled: true,
        timeZone: "Europe/Zurich",
      }),
    ).toEqual({ enabled: true, timeZone: "Europe/Zurich" });
  });
});

describe("letterSettingsSchema", () => {
  it("has no time zone before letters were ever turned on", () => {
    expect(
      letterSettingsSchema.parse({ enabled: false, timeZone: null }),
    ).toEqual({ enabled: false, timeZone: null });
  });
});
