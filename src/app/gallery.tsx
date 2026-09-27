import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { photoUri, useMoments } from "../moments";

const GAP = 4;
const PADDING = 16;

export default function Gallery() {
  const { moments } = useMoments();
  const { width } = useWindowDimensions();
  const size = (width - PADDING * 2 - GAP * 2) / 3;

  const photos = moments.flatMap((m) =>
    (m.photos ?? []).map((p) => ({ key: `${m.id}-${p}`, uri: photoUri(p) })),
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Gallery</Text>
      <Text style={styles.tagline}>What you kept.</Text>
      <FlatList
        data={photos}
        numColumns={3}
        keyExtractor={(p) => p.key}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP }}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.uri }}
            style={{ width: size, height: size, borderRadius: 6 }}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Photos you keep will gather here.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F1E8",
    paddingTop: 72,
    paddingHorizontal: PADDING,
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
    color: "#2B2622",
    paddingHorizontal: 4,
  },
  tagline: {
    fontSize: 16,
    fontStyle: "italic",
    color: "#6B6158",
    marginTop: 4,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  empty: {
    fontSize: 15,
    fontStyle: "italic",
    color: "#6B6158",
    paddingHorizontal: 4,
  },
});
