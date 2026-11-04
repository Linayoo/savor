import { deviceTimeZone } from "@/letters/time-zone";

describe("deviceTimeZone", () => {
  afterEach(() => jest.restoreAllMocks());

  const reporting = (timeZone: string | undefined) =>
    jest
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({
        timeZone,
      } as Intl.ResolvedDateTimeFormatOptions);

  it("is the phone's IANA zone", () => {
    reporting("Europe/Zurich");
    expect(deviceTimeZone()).toBe("Europe/Zurich");
  });

  it.each([undefined, "", "Not/AZone"])("is null for %j", (zone) => {
    reporting(zone);
    expect(deviceTimeZone()).toBeNull();
  });
});
