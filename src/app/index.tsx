import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Moment = { id: string; text: string; createdAt: number };

const STORAGE_KEY = "savor.moments";

export default function Index() {
  const [draft, setDraft] = useState("");
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Read the notebook when the app opens
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((json) => {
      if (json) setMoments(JSON.parse(json));
      setLoaded(true);
    });
  }, []);

  // Write to the notebook whenever moments change
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(moments));
  }, [moments, loaded]);

  const keep = () => {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    setMoments([{ id: String(now), text, createdAt: now }, ...moments]);
    setDraft("");
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Savor</Text>
      <Text style={styles.tagline}>Notice what makes you feel alive.</Text>

      <View style={styles.card}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="What moved you just now?"
          placeholderTextColor="#7A6F64"
          multiline
          style={styles.input}
        />
        <Pressable onPress={keep} style={styles.button}>
          <Text style={styles.buttonText}>Keep</Text>
        </Pressable>
      </View>

      <FlatList
        data={moments}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={styles.moment}>
            <Text style={styles.date}>
              {new Date(item.createdAt).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </Text>
            <Text style={styles.text}>{item.text}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F1E8",
    paddingTop: 72,
    paddingHorizontal: 20,
  },
  title: { fontSize: 32, fontWeight: "600", color: "#2B2622" },
  tagline: {
    fontSize: 16,
    fontStyle: "italic",
    color: "#6B6158",
    marginTop: 4,
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#FFFCF6",
    borderColor: "#E6DCCB",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  input: { fontSize: 18, color: "#2B2622", minHeight: 60 },
  button: {
    alignSelf: "flex-end",
    backgroundColor: "#A5532F",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 22,
    marginTop: 8,
  },
  buttonText: { color: "#FFFCF6", fontSize: 15, fontWeight: "500" },
  moment: {
    paddingVertical: 16,
    borderBottomColor: "#E6DCCB",
    borderBottomWidth: 1,
  },
  date: { fontSize: 13, color: "#6B6158", marginBottom: 4 },
  text: { fontSize: 16, lineHeight: 24, color: "#2B2622" },
});
