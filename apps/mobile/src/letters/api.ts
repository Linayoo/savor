import type {
  LetterSettings,
  ListLettersOutput,
  SetLetterSettingsInput,
} from "@savor/shared";

// What the letters need from the server (spec 007). The app implements it
// with tRPC; tests with the fake server. Failures are SyncErrors.
export interface LettersApi {
  list(): Promise<ListLettersOutput>;
  getSettings(): Promise<LetterSettings>;
  setSettings(input: SetLetterSettingsInput): Promise<LetterSettings>;
}
