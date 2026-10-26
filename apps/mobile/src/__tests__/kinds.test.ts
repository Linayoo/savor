import {
  KIND_LIST,
  KINDS,
  kindIcon,
  momentLine,
  type MomentKind,
} from "../kinds";

// Thu 1 Oct 2026, 09:30 UTC (tests run in UTC)
const createdAt = Date.UTC(2026, 9, 1, 9, 30);

describe("kinds", () => {
  it("lists the kinds in the spec's order", () => {
    expect(KIND_LIST).toEqual([
      "meal",
      "film",
      "book",
      "nature",
      "friends",
      "body",
      "phrase",
    ]);
  });

  it("gives every kind a label and an icon", () => {
    expect(KINDS.meal).toEqual({ label: "Meal", icon: "restaurant-outline" });
    expect(KINDS.phrase).toEqual({
      label: "Phrase",
      icon: "chatbubble-ellipses-outline",
    });
  });
});

describe("kindIcon", () => {
  it("returns the kind's icon", () => {
    expect(kindIcon({ kind: "film" })).toBe("film-outline");
  });

  it("returns a sparkle when there is no kind", () => {
    expect(kindIcon({})).toBe("sparkles-outline");
  });

  it("returns a sparkle for a kind it doesn't know", () => {
    expect(kindIcon({ kind: "dance" as MomentKind })).toBe("sparkles-outline");
  });
});

describe("momentLine", () => {
  it("reads 'Kind · date' when the moment has a kind", () => {
    expect(momentLine({ kind: "meal", createdAt })).toBe("Meal · Thu 1 Oct");
  });

  it("reads just the date when the moment has no kind", () => {
    expect(momentLine({ createdAt })).toBe("Thu 1 Oct");
  });

  it("reads just the date for a kind it doesn't know", () => {
    expect(momentLine({ kind: "dance" as MomentKind, createdAt })).toBe(
      "Thu 1 Oct",
    );
  });
});
