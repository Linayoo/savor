# 001: Moment kinds

Status: done

## Problem

All moments look the same in the timeline, so a meal, a film and a walk are hard to tell apart when looking back. A small, optional kind with an icon gives each moment a visual anchor without adding effort to keeping one.

## Behavior

1. The card at the top of the Moments screen shows a row of kind chips, one icon per kind, below the text and draft photos.
2. Tapping a chip selects it. Tapping the selected chip again unselects it. Only one kind can be selected.
3. Choosing a kind is optional. Keep works the same with or without one.
4. After Keep, the selected kind is cleared along with the text and photos.
5. In the timeline, each moment shows a round icon on its left: the kind's icon, or a sparkle when the moment has no kind.
6. The line above the moment's text reads "Meal · Thu 1 Oct" when it has a kind, and just the date when it doesn't.
7. The long-press menu option "Edit words" is renamed "Edit moment". Editing loads the moment's text and kind into the card, and Save updates both. Cancel restores an empty card with no kind selected.
8. The full-screen photo viewer shows the same "Kind · date" line in its caption.
9. Moments kept before this feature have no kind and keep working unchanged.

## Kinds

| Key | Label | Ionicons icon |
|---|---|---|
| meal | Meal | restaurant-outline |
| film | Film | film-outline |
| book | Book | book-outline |
| nature | Nature | leaf-outline |
| friends | Friends | people-outline |
| body | Body | body-outline |
| phrase | Phrase | chatbubble-ellipses-outline |
| (none) | – | sparkles-outline |

## Data model

`Moment` gets an optional field:

```ts
kind?: MomentKind; // "meal" | "film" | "book" | "nature" | "friends" | "body" | "phrase"
```

No storage migration: stored moments without `kind` stay valid.

Kinds are defined in one file, `apps/mobile/src/kinds.ts`, which exports the kinds map, the `MomentKind` type, the ordered kind list, a helper returning a moment's icon, and a helper returning the "Kind · date" line. Icon names are type-checked against Ionicons.

The moments context changes:

- `addMoment(text, tempPhotos, kind?)`
- `updateMoment(id, text, kind?)` (passing no kind clears it)

## API

None. Moments are still stored only on the phone.

## UI notes

- Chips: 36×36 circles, 1px border `#E6DCCB`, icon `#6B6158`. Selected: background `#EFE3D2`, border and icon `#A5532F`.
- Timeline icon: 40×40 circle, background `#EFE3D2`, icon `#8A5A3C`, left of the moment body with a 14px gap.
- Timeline photos shrink from 100 to 88 so three still fit beside the icon.
- Chips have an accessibility label (the kind's label) and selected state.

## Acceptance criteria

- [x] Given no kind is selected, when I tap the Film chip, then it is shown as selected.
- [x] Given Film is selected, when I tap Film again, then no kind is selected.
- [x] Given Film is selected, when I tap Meal, then only Meal is selected.
- [x] Given I keep a moment with Meal selected, then the timeline shows the meal icon and "Meal · <date>", and the card is cleared with no kind selected.
- [x] Given I keep a moment with no kind, then the timeline shows the sparkle icon and only the date.
- [x] Given a moment stored before this feature (no `kind`), when the app loads, then it shows the sparkle icon and only the date.
- [x] Given I edit a moment and pick Book, when I tap Save, then the moment shows the book icon and "Book · <date>", with its text and photos unchanged.
- [x] Given I edit a moment that has a kind and unselect it, when I tap Save, then the moment has no kind.
- [x] Given a moment with a kind, when I open one of its photos, then the viewer caption shows "Kind · <date>".
- [x] Unit tests cover the kinds helpers and the context's add and update behavior with and without a kind.
- [x] A component test covers chip select, unselect and switch.
- [x] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, with jest-expo replacing the "no tests yet" placeholder.

## Out of scope

- Filtering or grouping moments by kind
- Custom or user-defined kinds
- AI-suggested kinds (planned for the enrichment agent, M4)
- Validating stored moments with Zod and moving the schema to packages/shared (M2)
- Gallery word tiles for moments without photos

## Open questions

None.