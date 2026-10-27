import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold,
  useFonts,
} from "@expo-google-fonts/fraunces";
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
} from "@expo-google-fonts/work-sans";
import { Stack } from "expo-router";
import { db } from "../db/client";
import { DatabaseGate } from "../db/database-gate";
import { MomentsProvider } from "../moments";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    WorkSans_400Regular,
    WorkSans_500Medium,
  });

  if (!fontsLoaded) return null;

  return (
    <DatabaseGate>
      <MomentsProvider db={db}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="moment/[id]"
            options={{ presentation: "fullScreenModal", animation: "fade" }}
          />
        </Stack>
      </MomentsProvider>
    </DatabaseGate>
  );
}
