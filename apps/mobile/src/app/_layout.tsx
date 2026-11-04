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
import { AccountProvider } from "../account";
import * as auth from "../auth/auth";
import { appConfig } from "../config";
import { db } from "../db/client";
import { DatabaseGate } from "../db/database-gate";
import { LettersProvider } from "../letters/provider";
import { MomentsProvider } from "../moments";
import { deletePhotoFiles, photoTransfer } from "../photos";
import { SyncProvider } from "../sync-provider";
import { createTrpcLettersApi, createTrpcSyncApi } from "../sync/trpc-api";

// Created once someone signs in, so the app works without config or network
const createApi = () =>
  createTrpcSyncApi({ url: appConfig().apiUrl, getToken: auth.getAccessToken });
const createLettersApi = () =>
  createTrpcLettersApi({
    url: appConfig().apiUrl,
    getToken: auth.getAccessToken,
  });

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
      <AccountProvider db={db} auth={auth}>
        <SyncProvider
          db={db}
          createApi={createApi}
          deleteFiles={deletePhotoFiles}
          transfer={photoTransfer}
        >
          <LettersProvider db={db} createApi={createLettersApi}>
            <MomentsProvider db={db}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="moment/[id]"
                  options={{
                    presentation: "fullScreenModal",
                    animation: "fade",
                  }}
                />
                <Stack.Screen
                  name="letter/[id]"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="account"
                  options={{ presentation: "modal" }}
                />
              </Stack>
            </MomentsProvider>
          </LettersProvider>
        </SyncProvider>
      </AccountProvider>
    </DatabaseGate>
  );
}
