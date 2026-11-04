import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAccount } from "@/account";
import { monthName } from "@/letters/month";
import { useLetters } from "@/letters/provider";
import { fonts } from "@/theme";

// The monthly letters, newest first (spec 007). No counts, and nothing said
// about a month without a letter.
export default function Letters() {
  const { account } = useAccount();
  const { letters, settings, refresh } = useLetters();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (account.status === "loading") return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Letters</Text>
      <Text style={styles.tagline}>Your months, gathered.</Text>
      {account.status === "signedOut" ? (
        <>
          <Text style={styles.quiet}>
            Letters are written from the moments you sync, so they need an
            account.
          </Text>
          <Hint label="Your account" />
        </>
      ) : (
        <FlatList
          data={letters}
          keyExtractor={(letter) => letter.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={monthName(item.month)}
              onPress={() =>
                router.push({
                  pathname: "/letter/[id]",
                  params: { id: item.id },
                })
              }
              style={styles.row}
            >
              <Text style={styles.month}>{monthName(item.month)}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <>
              <Text style={styles.quiet}>
                At the start of each month, a letter from your moments will
                arrive here.
              </Text>
              {settings?.enabled === false ? (
                <Hint label="Turn on Monthly letter in your account." />
              ) : null}
            </>
          }
        />
      )}
    </View>
  );
}

function Hint({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push("/account")}
    >
      <Text style={styles.hint}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F1E8",
    paddingTop: 72,
    paddingHorizontal: 16,
  },
  title: {
    fontFamily: fonts.title,
    fontSize: 32,
    color: "#2B2622",
    paddingHorizontal: 4,
  },
  tagline: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: "#6B6158",
    marginTop: 4,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  row: {
    paddingVertical: 18,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E6DCCB",
  },
  month: { fontFamily: fonts.serif, fontSize: 20, color: "#2B2622" },
  quiet: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: "#6B6158",
    paddingHorizontal: 4,
  },
  hint: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: "#A5532F",
    marginTop: 12,
    paddingHorizontal: 4,
  },
});
