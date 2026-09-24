import { Text, View } from "react-native";

export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#F6F1E8" }}>
      <Text style={{ fontSize: 32, fontWeight: "600", color: "#2B2622" }}>Savor</Text>
      <Text style={{ fontSize: 16, fontStyle: "italic", color: "#6B6158", marginTop: 4 }}>
        Notice what makes you feel alive.
      </Text>
    </View>
  );
}