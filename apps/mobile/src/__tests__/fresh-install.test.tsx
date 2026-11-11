import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { clearLeftoverSignIn } from "@/auth/fresh-install";
import { FreshInstallGate } from "@/auth/fresh-install-gate";
import { SecureTokenStorage } from "@/auth/secure-storage";

// expo-secure-store in memory. Like the Keychain on iOS, it outlives the
// app's own storage when the app is deleted.
const mockKeychain = new Map<string, string>();
let mockFailDeletes = false;
jest.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => {
    mockKeychain.set(key, value);
  },
  getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    if (mockFailDeletes) throw new Error("Keychain delete failed");
    mockKeychain.delete(key);
  },
}));

const MARKER = "savor.installed";
const prefix = "CognitoIdentityServiceProvider.client";
const idToken = `${prefix}.sub-ana.idToken`;
const refreshToken = `${prefix}.sub-ana.refreshToken`;

// Tokens an earlier install left in the Keychain, one long enough to be split
async function leaveTokensFromEarlierInstall() {
  const tokens = new SecureTokenStorage();
  await tokens.setItem(idToken, "id-token");
  await tokens.setItem(refreshToken, "r".repeat(1800));
  await tokens.setItem(`${prefix}.LastAuthUser`, "sub-ana");
}

beforeEach(async () => {
  mockKeychain.clear();
  mockFailDeletes = false;
  await AsyncStorage.clear();
});

describe("clearLeftoverSignIn", () => {
  it("clears tokens from an earlier install on first launch", async () => {
    await leaveTokensFromEarlierInstall();

    await clearLeftoverSignIn(AsyncStorage, new SecureTokenStorage());

    expect(mockKeychain.size).toBe(0);
    expect(await AsyncStorage.getItem(MARKER)).not.toBeNull();
  });

  it("keeps the sign-in on later launches", async () => {
    await AsyncStorage.setItem(MARKER, "1");
    await leaveTokensFromEarlierInstall();

    await clearLeftoverSignIn(AsyncStorage, new SecureTokenStorage());

    const tokens = new SecureTokenStorage();
    expect(await tokens.getItem(idToken)).toBe("id-token");
    expect(await tokens.getItem(refreshToken)).toBe("r".repeat(1800));
  });

  it("tries again next launch when clearing fails", async () => {
    await leaveTokensFromEarlierInstall();
    mockFailDeletes = true;

    await expect(
      clearLeftoverSignIn(AsyncStorage, new SecureTokenStorage()),
    ).rejects.toThrow("Keychain delete failed");
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();

    mockFailDeletes = false;
    await clearLeftoverSignIn(AsyncStorage, new SecureTokenStorage());
    expect(mockKeychain.size).toBe(0);
  });
});

describe("FreshInstallGate", () => {
  it("shows the app only after leftover tokens are cleared", async () => {
    await leaveTokensFromEarlierInstall();
    const keychainWhenShown: number[] = [];
    function App() {
      keychainWhenShown.push(mockKeychain.size);
      return <Text>Moments</Text>;
    }

    await render(
      <FreshInstallGate>
        <App />
      </FreshInstallGate>,
    );

    expect(await screen.findByText("Moments")).toBeOnTheScreen();
    expect(keychainWhenShown).toEqual([0]);
  });

  it("still opens the app when clearing fails", async () => {
    await leaveTokensFromEarlierInstall();
    mockFailDeletes = true;

    await render(
      <FreshInstallGate>
        <Text>Moments</Text>
      </FreshInstallGate>,
    );

    expect(await screen.findByText("Moments")).toBeOnTheScreen();
  });
});
