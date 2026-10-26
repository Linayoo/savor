import type Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof Ionicons>["name"];

export const KINDS = {
  meal: { label: "Meal", icon: "restaurant-outline" },
  film: { label: "Film", icon: "film-outline" },
  book: { label: "Book", icon: "book-outline" },
  nature: { label: "Nature", icon: "leaf-outline" },
  friends: { label: "Friends", icon: "people-outline" },
  body: { label: "Body", icon: "body-outline" },
  phrase: { label: "Phrase", icon: "chatbubble-ellipses-outline" },
} as const satisfies Record<string, { label: string; icon: IconName }>;

export type MomentKind = keyof typeof KINDS;

export const KIND_LIST = Object.keys(KINDS) as MomentKind[];

const NO_KIND_ICON: IconName = "sparkles-outline";

type HasKind = { kind?: MomentKind };

// Stored moments may carry a kind this version doesn't know; treat it as none
function kindOf({ kind }: HasKind) {
  return kind && Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
}

export function kindIcon(moment: HasKind): IconName {
  return kindOf(moment)?.icon ?? NO_KIND_ICON;
}

export function momentLine(moment: HasKind & { createdAt: number }): string {
  const date = new Date(moment.createdAt).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const kind = kindOf(moment);
  return kind ? `${kind.label} · ${date}` : date;
}
