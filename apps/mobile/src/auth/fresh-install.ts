import type AsyncStorageStatic from "@react-native-async-storage/async-storage";
import type { KeyValueStorageInterface } from "aws-amplify/utils";

const MARKER = "savor.installed";

type Storage = Pick<typeof AsyncStorageStatic, "getItem" | "setItem">;

// On iOS the Keychain outlives the app, so a new install can find the tokens
// of an earlier one and start signed in (spec 008). App storage goes with the
// app, so a missing marker there means a first launch: clear the tokens, then
// write the marker. If clearing fails, the marker isn't written and the next
// launch tries again.
export async function clearLeftoverSignIn(
  storage: Storage,
  tokens: Pick<KeyValueStorageInterface, "clear">,
) {
  if (await storage.getItem(MARKER)) return;
  await tokens.clear();
  await storage.setItem(MARKER, "1");
}
