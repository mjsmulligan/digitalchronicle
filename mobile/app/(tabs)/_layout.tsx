import { Tabs, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

const THEME = {
  bg: "#0f172a",
  card: "#1e293b",
  border: "#334155",
  active: "#818cf8",   // indigo-400
  inactive: "#475569", // slate-600
  text: "#f8fafc",
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(
  focused: boolean,
  activeIcon: IoniconName,
  inactiveIcon: IoniconName
) {
  return (
    <Ionicons
      name={focused ? activeIcon : inactiveIcon}
      size={24}
      color={focused ? THEME.active : THEME.inactive}
    />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: THEME.card },
        headerTintColor: THEME.text,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: THEME.card,
          borderTopColor: THEME.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: THEME.active,
        tabBarInactiveTintColor: THEME.inactive,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chronicle",
          tabBarLabel: "Chronicle",
          tabBarIcon: ({ focused }) => tabIcon(focused, "book", "book-outline"),
          headerRight: () => (
            <Link href="/import" asChild>
              <Pressable style={{ marginRight: 16 }}>
                <Ionicons name="cloud-upload-outline" size={22} color={THEME.active} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: "Trips",
          tabBarIcon: ({ focused }) =>
            tabIcon(focused, "airplane", "airplane-outline"),
        }}
      />
      <Tabs.Screen
        name="culture"
        options={{
          title: "Culture",
          tabBarIcon: ({ focused }) => tabIcon(focused, "film", "film-outline"),
        }}
      />
      <Tabs.Screen
        name="moments"
        options={{
          title: "Moments",
          tabBarIcon: ({ focused }) =>
            tabIcon(focused, "star", "star-outline"),
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: "People",
          tabBarIcon: ({ focused }) =>
            tabIcon(focused, "people", "people-outline"),
        }}
      />
    </Tabs>
  );
}
