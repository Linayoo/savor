import { render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";
import { KindChips } from "@/components/kind-chips";
import type { MomentKind } from "@/kinds";

function Chips() {
  const [kind, setKind] = useState<MomentKind | undefined>();
  return <KindChips selected={kind} onChange={setKind} />;
}

const chip = (name: string) => screen.getByRole("button", { name });

describe("KindChips", () => {
  it("shows one chip per kind, none selected", async () => {
    await render(<Chips />);

    for (const name of [
      "Meal",
      "Film",
      "Book",
      "Nature",
      "Friends",
      "Body",
      "Phrase",
    ]) {
      expect(chip(name)).not.toBeSelected();
    }
  });

  it("selects a chip when tapped", async () => {
    const user = userEvent.setup();
    await render(<Chips />);

    await user.press(chip("Film"));

    expect(chip("Film")).toBeSelected();
  });

  it("unselects the selected chip when tapped again", async () => {
    const user = userEvent.setup();
    await render(<Chips />);

    await user.press(chip("Film"));
    await user.press(chip("Film"));

    expect(chip("Film")).not.toBeSelected();
  });

  it("switches to another kind, keeping only one selected", async () => {
    const user = userEvent.setup();
    await render(<Chips />);

    await user.press(chip("Film"));
    await user.press(chip("Meal"));

    expect(chip("Meal")).toBeSelected();
    expect(chip("Film")).not.toBeSelected();
  });
});
