jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Icon fonts can't load under Jest. Render the icon name as a testID instead,
// so tests can check which icon is shown.
jest.mock("@expo/vector-icons/Ionicons", () => {
  const { createElement } = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: ({ name }: { name: string }) =>
      createElement(View, { testID: `icon-${name}` }),
  };
});
