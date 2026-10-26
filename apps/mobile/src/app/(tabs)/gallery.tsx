import { router } from "expo-router";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { fonts } from "@/theme";
import { photoUri, useMoments } from "../../moments";

const GAP = 4;
const PADDING = 16;

export default function Gallery() {
  const { moments } = useMoments();
  const { width } = useWindowDimensions();
  const size = (width - PADDING * 2 - GAP * 2) / 3;

  const photos = moments.flatMap((m) =>
    (m.photos ?? []).map((p) => ({
      key: `${m.id}-${p}`,
      momentId: m.id,
      photo: p,
      uri: photoUri(p),
    })),
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
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/moment/[id]",
                params: { id: item.momentId, photo: item.photo },
              })
            }
          >
            <Image
              source={{ uri: item.uri }}
              style={{ width: size, height: size, borderRadius: 6 }}
            />
          </Pressable>
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
  empty: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: "#6B6158",
    paddingHorizontal: 4,
  },
});
