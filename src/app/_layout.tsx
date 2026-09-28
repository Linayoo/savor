import { Stack } from "expo-router";
import { MomentsProvider } from "../moments";

export default function RootLayout() {
  return (
    <MomentsProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="moment/[id]"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
      </Stack>
    </MomentsProvider>
  );
}
