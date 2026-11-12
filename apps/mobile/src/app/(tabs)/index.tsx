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
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from "react-native";
import { MAX_PHOTOS_PER_MOMENT } from "@savor/shared";
import { KindChips } from "@/components/kind-chips";
import { kindIcon, momentLine, type MomentKind } from "@/kinds";
import { photoUri, useMoments, type Moment } from "../../moments";
import { useSync } from "../../sync-provider";

// A photo waiting in the card. Library photos carry the picker's asset id,
// so picking one again doesn't add it twice; camera photos have none.
type DraftPhoto = { uri: string; assetId: string | null };

export default function Index() {
  const { moments, addMoment, updateMoment, deleteMoment } = useMoments();
  const [draft, setDraft] = useState("");
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([]);
  const [draftKind, setDraftKind] = useState<MomentKind | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const timelineRef = useRef<FlatList<Moment>>(null);
  const sync = useSync();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await sync.syncNow();
    setRefreshing(false);
  };

  const addPhotos = (assets: ImagePicker.ImagePickerAsset[]) =>
    setDraftPhotos((prev) => {
      const inDraft = new Set(prev.map((p) => p.assetId).filter(Boolean));
      const added = assets
        .filter((a) => !a.assetId || !inDraft.has(a.assetId))
        .map((a) => ({ uri: a.uri, assetId: a.assetId ?? null }));
      // The server keeps at most this many per moment (spec 009)
      return [...prev, ...added].slice(0, MAX_PHOTOS_PER_MOMENT);
    });

  const roomLeft = MAX_PHOTOS_PER_MOMENT - draftPhotos.length;

  const takePhoto = async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result.canceled) addPhotos(result.assets);
  };

  const choosePhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: roomLeft,
      quality: 0.8,
    });
    if (!result.canceled) addPhotos(result.assets);
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
    setDraftKind(moment.kind);
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
    setDraftKind(undefined);
  };

  const keep = () => {
    const text = draft.trim();

    if (editingId) {
      const moment = moments.find((m) => m.id === editingId);
      if (!text && !moment?.photos?.length) return; // don't leave an empty moment
      updateMoment(editingId, text, draftKind);
      cancelEdit();
      Keyboard.dismiss();
      return;
    }

    if (!text && draftPhotos.length === 0) return;
    try {
      addMoment(
        text,
        draftPhotos.map((p) => p.uri),
        draftKind,
      );
      setDraft("");
      setDraftPhotos([]);
      setDraftKind(undefined);
      // The new moment is first; show it without the keyboard over it
      Keyboard.dismiss();
      timelineRef.current?.scrollToOffset({ offset: 0, animated: true });
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
          options: ["Cancel", "Edit moment", "Delete moment"],
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
        { text: "Edit moment", onPress: () => startEdit(moment) },
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
      <View style={styles.header}>
        <Text style={styles.title}>Savor</Text>
        <Pressable
          onPress={() => router.push("/account")}
          style={styles.accountButton}
          accessibilityRole="button"
          accessibilityLabel="Account"
        >
          <Ionicons name="person-circle-outline" size={26} color="#6B6158" />
        </Pressable>
      </View>
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
            {draftPhotos.map(({ uri }) => (
              <Pressable
                key={uri}
                accessibilityLabel="Remove photo"
                onPress={() =>
                  setDraftPhotos((p) => p.filter((d) => d.uri !== uri))
                }
              >
                <Image source={{ uri }} style={styles.thumb} />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {roomLeft === 0 && (
          <Text style={styles.note}>
            A moment holds up to {MAX_PHOTOS_PER_MOMENT} photos.
          </Text>
        )}

        <KindChips selected={draftKind} onChange={setDraftKind} />

        <View style={styles.actions}>
          {editingId ? (
            <Pressable onPress={cancelEdit} style={styles.textButton}>
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={openPhotoOptions}
              disabled={roomLeft === 0}
              style={[styles.iconButton, roomLeft === 0 && styles.disabled]}
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
        ref={timelineRef}
        data={moments}
        keyExtractor={(m) => m.id}
        testID="timeline"
        refreshControl={
          sync.status ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor="#A5532F"
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.moment}
            onLongPress={() => openMomentMenu(item)}
          >
            <View style={styles.kindIcon}>
              <Ionicons name={kindIcon(item)} size={20} color="#8A5A3C" />
            </View>
            <View style={styles.momentBody}>
              <Text style={styles.date}>{momentLine(item)}</Text>
              {item.text ? <Text style={styles.text}>{item.text}</Text> : null}
              {item.photos?.length ? (
                <View style={styles.photoRow}>
                  {item.photos.map((p) =>
                    // Still on its way from another device
                    p.fileName === null ? (
                      <View
                        key={p.id}
                        style={[styles.photo, styles.photoOnItsWay]}
                        accessibilityLabel="Photo on its way"
                      />
                    ) : (
                      <Pressable
                        key={p.id}
                        accessibilityLabel="Open photo"
                        onPress={() =>
                          router.push({
                            pathname: "/moment/[id]",
                            params: { id: item.id, photo: p.id },
                          })
                        }
                      >
                        <Image
                          source={{ uri: photoUri(p.fileName) }}
                          style={styles.photo}
                        />
                      </Pressable>
                    ),
                  )}
                </View>
              ) : null}
            </View>
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontFamily: fonts.title, fontSize: 32, color: "#2B2622" },
  accountButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -10,
  },
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
  note: {
    fontFamily: fonts.serifItalic,
    fontSize: 14,
    color: "#6B6158",
    marginTop: 8,
  },
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
  disabled: { opacity: 0.4 },
  buttonText: { fontFamily: fonts.bodyMedium, color: "#FFFCF6", fontSize: 15 },
  moment: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 16,
    borderBottomColor: "#E6DCCB",
    borderBottomWidth: 1,
  },
  kindIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EFE3D2",
    alignItems: "center",
    justifyContent: "center",
  },
  momentBody: { flex: 1 },
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
  photo: { width: 88, height: 88, borderRadius: 10 },
  photoOnItsWay: { backgroundColor: "#EFE3D2" },
});
