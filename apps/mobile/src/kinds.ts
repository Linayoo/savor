import type Ionicons from "@expo/vector-icons/Ionicons";
import { MOMENT_KINDS, momentKindSchema, type MomentKind } from "@savor/shared";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof Ionicons>["name"];

export type { MomentKind };

// Keys come from @savor/shared; a new kind there needs a label and icon here
export const KINDS = {
  meal: { label: "Meal", icon: "restaurant-outline" },
  film: { label: "Film", icon: "film-outline" },
  book: { label: "Book", icon: "book-outline" },
  nature: { label: "Nature", icon: "leaf-outline" },
  friends: { label: "Friends", icon: "people-outline" },
  body: { label: "Body", icon: "body-outline" },
  phrase: { label: "Phrase", icon: "chatbubble-ellipses-outline" },
} as const satisfies Record<MomentKind, { label: string; icon: IconName }>;

export const KIND_LIST: readonly MomentKind[] = MOMENT_KINDS;

const NO_KIND_ICON: IconName = "sparkles-outline";

type HasKind = { kind?: MomentKind };

export function isMomentKind(value: unknown): value is MomentKind {
  return momentKindSchema.safeParse(value).success;
}

// Stored moments may carry a kind this version doesn't know; treat it as none
function kindOf({ kind }: HasKind) {
  return isMomentKind(kind) ? KINDS[kind] : undefined;
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
