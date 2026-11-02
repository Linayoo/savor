import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";
import mockSafeAreaContext from "react-native-safe-area-context/jest/mock";

jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);
jest.mock("react-native-safe-area-context", () => mockSafeAreaContext);

// NetInfo needs its native module; tests drive the connection themselves
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: () => () => undefined },
}));

// expo-crypto's randomUUID calls a native module that Jest can't load
jest.mock("expo-crypto", () => ({
  ...jest.requireActual("expo-crypto"),
  randomUUID: () => jest.requireActual("node:crypto").randomUUID(),
}));

// Icon fonts can't load under Jest. Render the icon name as a testID instead,
// so tests can check which icon is shown.
jest.mock("@expo/vector-icons/Ionicons", () => {
  const { createElement } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ name }: { name: string }) =>
      createElement(View, { testID: `icon-${name}` }),
  };
});
