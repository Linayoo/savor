import { router, Stack } from "expo-router";
import { Pressable, Text } from "react-native";
import { fonts } from "@/theme";

export default function AccountLayout() {
  return (
    <Stack
      screenOptions={{
        title: "",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: "#F6F1E8" },
        headerTintColor: "#A5532F",
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.back()} accessibilityRole="button">
              <Text
                style={{
                  fontFamily: fonts.bodyMedium,
                  fontSize: 16,
                  color: "#A5532F",
                }}
              >
                Done
              </Text>
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
