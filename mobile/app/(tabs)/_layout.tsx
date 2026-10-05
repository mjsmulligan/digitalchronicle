import { Tabs, Link, useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useTheme } from "../../src/components/ThemeProvider";
import { FloatingNavBar } from "../../src/components/FloatingNavBar";
import { useJournal } from "@chronicle/journal/db";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Shared top-bar right side: Import icon (staging dot) + Sources icon
 * (pending place suggestions dot) + Settings icon.
 * Rendered on every tab via screenOptions.headerRight.
 */
/**
 * Shared top-bar right side: Sources icon (dot when anything is pending —
 * staged import batches OR pending place suggestions) + Settings icon.
 * Rendered on every tab via screenOptions.headerRight.
 */
function HeaderRight({
  pendingCount,
}: {
  pendingCount: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 4, marginRight: 8 }}>
      {/* Sources — covers file imports + photo library suggestions */}
      <Link href="/sources" asChild>
        <Pressable style={{ padding: 8 }}>
          <View>
            <Ionicons name="layers-outline" size={22} color={colors.accentSoft} />
            {pendingCount > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: 1,
                  right: 1,
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: colors.error,
                }}
              />
            )}
          </View>
        </Pressable>
      </Link>
      {/* Settings */}
      <Link href="/settings" asChild>
        <Pressable style={{ padding: 8 }}>
          <Ionicons name="settings-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </Link>
    </View>
  );
}

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors, fonts } = useTheme();
  const journal = useJournal();
  // Single dot covers file-import batches AND pending place suggestions
  const pendingCount =
    journal.staging.length +
    (journal.placeEntries ?? []).filter((e) => e.status === "pending").length;

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
          // Shared top-bar right side on every tab (spec 6.2)
          headerRight: () => <HeaderRight pendingCount={pendingCount} />,
        }}
      >
      <Tabs.Screen
        name="index"
        options={{
          title: "Journal",
          tabBarLabel: "Chronicle",
          tabBarIcon: ({ focused }) => tabIcon(focused, "book", "book-outline"),
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
        name="people"
        options={{
          title: "People",
          tabBarIcon: ({ focused }) =>
            tabIcon(focused, "people", "people-outline"),
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
