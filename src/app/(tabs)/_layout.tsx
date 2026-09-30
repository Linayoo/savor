import Ionicons from "@expo/vector-icons/Ionicons";
import { fonts } from "@/theme";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#A5532F",
        tabBarInactiveTintColor: "#6B6158",
        tabBarStyle: { backgroundColor: "#FFFCF6", borderTopColor: "#E6DCCB" },
        tabBarLabelStyle: { fontFamily: fonts.body },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Moments",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="sparkles-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="images-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
