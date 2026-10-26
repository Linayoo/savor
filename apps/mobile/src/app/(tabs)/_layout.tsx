import Ionicons from "@expo/vector-icons/Ionicons";
import { fonts } from "@/theme";
import { Tabs } from "expo-router";

const activeTint = "#A5532F";
const inactiveTint = "#6B6158";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        tabBarStyle: { backgroundColor: "#FFFCF6", borderTopColor: "#E6DCCB" },
        tabBarLabelStyle: { fontFamily: fonts.body },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Moments",
          tabBarIcon: ({ focused, size }) => (
            <Ionicons
              name="sparkles-outline"
              color={focused ? activeTint : inactiveTint}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ focused, size }) => (
            <Ionicons
              name="images-outline"
              color={focused ? activeTint : inactiveTint}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
