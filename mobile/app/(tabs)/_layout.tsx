import { Tabs, Link, useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useTheme } from "../../src/components/ThemeProvider";
import { FloatingNavBar } from "../../src/components/FloatingNavBar";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors, fonts } = useTheme();

  // Derive active tab from current path so FloatingNavBar stays in sync
  // without needing the non-existent onIndexChange prop on Tabs.
  const activeTab = pathname.startsWith("/trips") ? "trips"
    : pathname.startsWith("/culture") ? "culture"
    : pathname.startsWith("/people") ? "people"
    : "index";

  function tabIcon(
    focused: boolean,
    activeIcon: IoniconName,
    inactiveIcon: IoniconName,
  ) {
    return (
      <Ionicons
        name={focused ? activeIcon : inactiveIcon}
        size={24}
        color={focused ? colors.accentSoft : colors.textMuted}
      />
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: "column" }}>
      {/* Tabs fills available space; FloatingNavBar docks below it */}
      <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          headerTitleStyle: {
            fontFamily: fonts.serifSemiBold,
            fontWeight: "600",
            fontSize: 18,
            color: colors.textBright,
          },
          tabBarStyle: { display: "none" },
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
      </View>

      {/* Docked tab bar */}
      <FloatingNavBar
        items={[
          {
            icon: "book-outline" as IoniconName,
            activeIcon: "book" as IoniconName,
            active: activeTab === "index",
            label: "Chronicle",
            onPress: () => router.navigate("/"),
          },
          {
            icon: "airplane-outline" as IoniconName,
            activeIcon: "airplane" as IoniconName,
            active: activeTab === "trips",
            label: "Trips",
            onPress: () => router.navigate("/(tabs)/trips"),
          },
          {
            icon: "film-outline" as IoniconName,
            activeIcon: "film" as IoniconName,
            active: activeTab === "culture",
            label: "Culture",
            onPress: () => router.navigate("/(tabs)/culture"),
          },
          {
            icon: "people-outline" as IoniconName,
            activeIcon: "people" as IoniconName,
            active: activeTab === "people",
            label: "People",
            onPress: () => router.navigate("/(tabs)/people"),
          },
        ]}
      />
    </View>
  );
}
