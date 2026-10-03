import { Tabs, Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, fonts, common } from "../../src/theme";
import { FloatingNavBar } from "../../src/components/FloatingNavBar";
import { useEffect, useState } from "react";

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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("index");

  return (
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
          tabBarStyle: { display: "none" }, // Hide default tab bar
          tabBarActiveTintColor: colors.accentSoft,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
        sceneContainerStyle={{ paddingBottom: 100 }}
        onIndexChange={(index) => {
          const tabs = ["index", "trips", "culture", "people"];
          setActiveTab(tabs[index]);
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

      {/* Floating navbar overlay at screen level */}
      <FloatingNavBar
        items={[
          {
            icon: "book-outline" as IoniconName,
            activeIcon: "book" as IoniconName,
            active: activeTab === "index",
            label: "Chronicle",
            onPress: () => router.navigate("index"),
          },
          {
            icon: "airplane-outline" as IoniconName,
            activeIcon: "airplane" as IoniconName,
            active: activeTab === "trips",
            label: "Trips",
            onPress: () => router.navigate("trips"),
          },
          {
            icon: "film-outline" as IoniconName,
            activeIcon: "film" as IoniconName,
            active: activeTab === "culture",
            label: "Culture",
            onPress: () => router.navigate("culture"),
          },
          {
            icon: "people-outline" as IoniconName,
            activeIcon: "people" as IoniconName,
            active: activeTab === "people",
            label: "People",
            onPress: () => router.navigate("people"),
          },
        ]}
      />
    </View>
  );
}
