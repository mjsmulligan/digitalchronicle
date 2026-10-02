import { Tabs, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, fonts, common } from "../../src/theme";

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
      color={focused ? colors.accentSoft : colors.textMuted}
    />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textBright,
        headerShadowVisible: false,
        headerTitleStyle: {
          fontFamily: fonts.serifSemiBold,
          fontWeight: "600",
          fontSize: 18,
          color: colors.textBright,
        },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.accentSoft,
        tabBarInactiveTintColor: colors.textMuted,
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
            <View style={{ flexDirection: "row", gap: 4, marginRight: 8 }}>
              <Link href="/import" asChild>
                <Pressable style={{ padding: 8 }}>
                  <Ionicons name="cloud-upload-outline" size={22} color={colors.accentSoft} />
                </Pressable>
              </Link>
              <Link href="/settings" asChild>
                <Pressable style={{ padding: 8 }}>
                  <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: "Trips",
          tabBarIcon: ({ focused }) =>
            tabIcon(focused, "airplane", "airplane-outline"),
          headerRight: () => (
            <Link href="/trip/new" asChild>
              <Pressable style={{ padding: 8, marginRight: 8 }}>
                <Ionicons name="add" size={26} color={colors.accentSoft} />
              </Pressable>
            </Link>
          ),
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
          headerRight: () => (
            <Link href="/import-people" asChild>
              <Pressable style={{ padding: 8, marginRight: 8 }}>
                <Ionicons name="person-add-outline" size={22} color={colors.accentSoft} />
              </Pressable>
            </Link>
          ),
        }}
      />
    </Tabs>
  );
}
