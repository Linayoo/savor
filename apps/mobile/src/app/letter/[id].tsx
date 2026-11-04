import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { monthName } from "@/letters/month";
import { useLetters } from "@/letters/provider";
import { fonts } from "@/theme";

// One letter, on a warm page in the serif type, like a letter (spec 007)
export default function LetterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { letters } = useLetters();
  const insets = useSafeAreaInsets();
  const letter = letters.find((l) => l.id === id);
  const paragraphs = (letter?.body ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        style={styles.close}
      >
        <Text style={styles.closeLabel}>Close</Text>
      </Pressable>
      {letter ? (
        <ScrollView
          contentContainerStyle={[
            styles.page,
            { paddingBottom: insets.bottom + 48 },
          ]}
        >
          <Text style={styles.month}>{monthName(letter.month)}</Text>
          {paragraphs.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.missing}>
          This letter isn&apos;t on this phone.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFCF6" },
  close: { alignSelf: "flex-end", paddingHorizontal: 20, paddingVertical: 8 },
  closeLabel: { fontFamily: fonts.bodyMedium, fontSize: 16, color: "#A5532F" },
  page: { paddingHorizontal: 28, paddingTop: 16 },
  month: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: "#6B6158",
    marginBottom: 24,
  },
  paragraph: {
    fontFamily: fonts.serif,
    fontSize: 18,
    lineHeight: 29,
    color: "#2B2622",
    marginBottom: 18,
  },
  missing: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: "#6B6158",
    paddingHorizontal: 28,
    paddingTop: 16,
  },
});
