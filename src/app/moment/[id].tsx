import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { photoUri, useMoments } from "../../moments";

export default function MomentPhotos() {
  const { id, photo } = useLocalSearchParams<{ id: string; photo?: string }>();
  const { moments } = useMoments();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const moment = moments.find((m) => m.id === id);
  const photos = moment?.photos ?? [];
  const startIndex = Math.max(0, photos.indexOf(photo ?? ""));

  const [index, setIndex] = useState(startIndex);
  const [areaHeight, setAreaHeight] = useState(0);

  if (!moment) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.close}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color="#F3EBDD" />
        </Pressable>
        <View style={styles.dots}>
          {photos.length > 1 &&
            photos.map((p, i) => (
              <View
                key={p}
                style={[styles.dot, i === index && styles.dotActive]}
              />
            ))}
        </View>
        <View style={styles.close} />
      </View>

      <View
        style={{ flex: 1 }}
        onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}
      >
        {areaHeight > 0 && (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({
              length: width,
              offset: width * i,
              index: i,
            })}
            onMomentumScrollEnd={(e) =>
              setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item }) => (
              <Image
                source={{ uri: photoUri(item) }}
                style={{ width, height: areaHeight }}
                resizeMode="contain"
              />
            )}
          />
        )}
      </View>

      <View style={[styles.caption, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.date}>
          {new Date(moment.createdAt).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
        </Text>
        {moment.text ? <Text style={styles.text}>{moment.text}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#1E1A17" },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  dots: { flexDirection: "row", gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#6B6158" },
  dotActive: { backgroundColor: "#F3EBDD" },
  caption: { paddingHorizontal: 24, paddingTop: 16, gap: 6 },
  date: { fontSize: 13, color: "#B5A999" },
  text: { fontSize: 18, lineHeight: 26, color: "#F3EBDD" },
});
