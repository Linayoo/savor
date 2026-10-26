import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { MomentsProvider, useMoments, type Moment } from "../moments";

const STORAGE_KEY = "savor.moments";

const stored: Moment = {
  id: "1",
  text: "Rain on the window",
  photos: ["1-a.jpg"],
  createdAt: Date.UTC(2026, 9, 1, 9, 30),
};

async function renderMoments(initial?: Moment[]) {
  if (initial) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  jest.mocked(AsyncStorage.setItem).mockClear();
  const hook = await renderHook(() => useMoments(), {
    wrapper: MomentsProvider,
  });
  // The provider writes back once it has loaded
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
  return hook;
}

async function savedMoments(): Promise<Moment[]> {
  const calls = jest.mocked(AsyncStorage.setItem).mock.calls;
  await waitFor(() => expect(calls.at(-1)?.[0]).toBe(STORAGE_KEY));
  return JSON.parse(calls.at(-1)![1]);
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("addMoment", () => {
  it("keeps the kind when one is chosen", async () => {
    const { result } = await renderMoments();
    await act(() => result.current.addMoment("Ramen", [], "meal"));

    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    expect(result.current.moments[0]).toMatchObject({
      text: "Ramen",
      kind: "meal",
    });
    expect((await savedMoments())[0].kind).toBe("meal");
  });

  it("keeps a moment without a kind", async () => {
    const { result } = await renderMoments();
    await act(() => result.current.addMoment("A quiet morning", []));

    await waitFor(() => expect(result.current.moments).toHaveLength(1));
    expect(result.current.moments[0]).not.toHaveProperty("kind");
  });
});

describe("updateMoment", () => {
  it("sets a kind and leaves the photos alone", async () => {
    const { result } = await renderMoments([stored]);
    await act(() =>
      result.current.updateMoment("1", "Rain on the window", "book"),
    );

    await waitFor(() => expect(result.current.moments[0].kind).toBe("book"));
    expect(result.current.moments[0]).toEqual({ ...stored, kind: "book" });
  });

  it("changes the text and the kind together", async () => {
    const { result } = await renderMoments([{ ...stored, kind: "meal" }]);
    await act(() => result.current.updateMoment("1", "Soup", "friends"));

    await waitFor(() => expect(result.current.moments[0].text).toBe("Soup"));
    expect(result.current.moments[0].kind).toBe("friends");
  });

  it("clears the kind when none is passed", async () => {
    const { result } = await renderMoments([{ ...stored, kind: "meal" }]);
    await act(() => result.current.updateMoment("1", "Rain on the window"));

    await waitFor(() =>
      expect(result.current.moments[0]).not.toHaveProperty("kind"),
    );
    expect((await savedMoments())[0]).not.toHaveProperty("kind");
  });
});

describe("loading", () => {
  it("keeps moments stored before kinds existed unchanged", async () => {
    const { result } = await renderMoments([stored]);

    expect(result.current.moments).toEqual([stored]);
  });
});
