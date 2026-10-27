import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { ReactNode, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { fonts } from "@/theme";
import migrations from "../../drizzle/migrations";
import { db } from "./client";
import { importFromAsyncStorage } from "./import-async-storage";

// Brings the database up to date, then moves moments over from AsyncStorage
// once, before anything reads moments
export function DatabaseGate({ children }: { children: ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    if (!success) return;
    importFromAsyncStorage(db, AsyncStorage)
      .catch(() =>
        Alert.alert(
          "Couldn't move your moments",
          "They're safe, and Savor will try again next time it opens.",
        ),
      )
      .finally(() => setImported(true));
  }, [success]);

  if (error) {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>Savor couldn&apos;t open your moments.</Text>
      </View>
    );
  }
  if (!success || !imported) return null;
  return children;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F1E8",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  text: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: "#6B6158",
    textAlign: "center",
  },
});
