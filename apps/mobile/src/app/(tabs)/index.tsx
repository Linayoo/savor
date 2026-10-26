import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { fonts } from "@/theme";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { photoUri, useMoments, type Moment } from "../../moments";

export default function Index() {
  const { moments, addMoment, updateMoment, deleteMoment } = useMoments();
  const [draft, setDraft] = useState("");
  const [draftPhotos, setDraftPhotos] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const addUris = (uris: string[]) =>
    setDraftPhotos((prev) => [...prev, ...uris]);

  const takePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled) addUris(result.assets.map((a) => a.uri));
  };

  const choosePhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) addUris(result.assets.map((a) => a.uri));
  };

  const openPhotoOptions = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take photo", "Choose from library"],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) takePhoto();
          if (i === 2) choosePhotos();
        },
      );
    } else {
      Alert.alert("Add photos", undefined, [
        { text: "Take photo", onPress: takePhoto },
        { text: "Choose from library", onPress: choosePhotos },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const startEdit = (moment: Moment) => {
    setEditingId(moment.id);
    setDraft(moment.text);
    setDraftPhotos([]);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const keep = () => {
    const text = draft.trim();

    if (editingId) {
      const moment = moments.find((m) => m.id === editingId);
      if (!text && !moment?.photos?.length) return; // don't leave an empty moment
      updateMoment(editingId, text);
      cancelEdit();
      return;
    }

    if (!text && draftPhotos.length === 0) return;
    try {
      addMoment(text, draftPhotos);
      setDraft("");
      setDraftPhotos([]);
    } catch (e) {
      Alert.alert("Couldn't save the photos", String(e));
    }
  };

  const confirmDelete = (moment: Moment) => {
    Alert.alert("Delete moment?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMoment(moment.id),
      },
    ]);
  };

  const openMomentMenu = (moment: Moment) => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Edit words", "Delete moment"],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 2,
        },
        (i) => {
          if (i === 1) startEdit(moment);
          if (i === 2) confirmDelete(moment);
        },
      );
    } else {
      Alert.alert("Moment", undefined, [
        { text: "Edit words", onPress: () => startEdit(moment) },
        {
          text: "Delete moment",
          style: "destructive",
          onPress: () => confirmDelete(moment),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Savor</Text>
      <Text style={styles.tagline}>Notice what makes you feel alive.</Text>

      <View style={styles.card}>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          placeholder="What moved you just now?"
          placeholderTextColor="#7A6F64"
          multiline
          style={styles.input}
        />

        {draftPhotos.length > 0 && (
          <ScrollView horizontal style={styles.thumbRow}>
            {draftPhotos.map((uri) => (
              <Pressable
                key={uri}
                onPress={() =>
                  setDraftPhotos((p) => p.filter((u) => u !== uri))
                }
              >
                <Image source={{ uri }} style={styles.thumb} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.actions}>
          {editingId ? (
            <Pressable onPress={cancelEdit} style={styles.textButton}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={openPhotoOptions}
              style={styles.iconButton}
              accessibilityLabel="Add photos"
            >
              <Ionicons name="camera-outline" size={22} color="#6B6158" />
            </Pressable>
          )}
          <Pressable onPress={keep} style={styles.button}>
            <Text style={styles.buttonText}>{editingId ? "Save" : "Keep"}</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={moments}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.moment}
            onLongPress={() => openMomentMenu(item)}
          >
            <Text style={styles.date}>
              {new Date(item.createdAt).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </Text>
            {item.text ? <Text style={styles.text}>{item.text}</Text> : null}
            {item.photos?.length ? (
              <View style={styles.photoRow}>
                {item.photos.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() =>
                      router.push({
                        pathname: "/moment/[id]",
                        params: { id: item.id, photo: p },
                      })
                    }
                  >
                    <Image source={{ uri: photoUri(p) }} style={styles.photo} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Pressable>
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
  title: { fontFamily: fonts.title, fontSize: 32, color: "#2B2622" },
  tagline: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
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
  input: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: "#2B2622",
    minHeight: 60,
  },
  thumbRow: { marginTop: 12 },
  thumb: { width: 64, height: 64, borderRadius: 8, marginRight: 6 },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E6DCCB",
    backgroundColor: "#F6F1E8",
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    backgroundColor: "#A5532F",
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  buttonText: { fontFamily: fonts.bodyMedium, color: "#FFFCF6", fontSize: 15 },
  moment: {
    paddingVertical: 16,
    borderBottomColor: "#E6DCCB",
    borderBottomWidth: 1,
  },
  date: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "#6B6158",
    marginBottom: 4,
  },
  text: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    color: "#2B2622",
  },
  textButton: { height: 44, justifyContent: "center", paddingHorizontal: 4 },
  textButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: "#6B6158",
  },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  photo: { width: 100, height: 100, borderRadius: 10 },
});
