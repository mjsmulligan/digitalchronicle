/**
 * Shared chrome for the source cards on the Sources screen: the card wrapper,
 * the action button and the section label.
 * (Moved out of mobile/app/sources.tsx, no behaviour change.)
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, radius, type ThemeColors, type ThemeFonts } from "../ThemeProvider";

export function SourceCard({
  icon,
  title,
  statusText,
  statusColor,
  active,
  progressPct,
  action,
  children,
  colors,
  fonts,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  statusText: string;
  statusColor?: string;
  active: boolean;
  progressPct: number; // 0–1, only shown when active
  action: React.ReactNode;
  children?: React.ReactNode;
  colors: ThemeColors;
  fonts: ThemeFonts;
}) {
  const progressAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (active) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(progressAnim, { toValue: 0.7, duration: 1400, useNativeDriver: false }),
          Animated.timing(progressAnim, { toValue: 0.15, duration: 1000, useNativeDriver: false }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      Animated.timing(progressAnim, {
        toValue: progressPct,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [active]);

  return (
    <View
      style={[
        sc.card,
        { backgroundColor: colors.surface, borderColor: colors.borderFaint },
      ]}
    >
      <View style={sc.header}>
        <View style={[sc.iconWrap, { backgroundColor: colors.surfaceAccent }]}>
          <Ionicons name={icon} size={20} color={colors.accent} />
        </View>
        <View style={sc.info}>
          <Text style={[sc.title, { color: colors.textPrimary, fontFamily: fonts.serifSemiBold }]}>
            {title}
          </Text>
          <Text style={[sc.status, { color: statusColor ?? colors.textMuted }]}>
            {statusText}
          </Text>
        </View>
        {action}
      </View>

      {active && (
        <View style={sc.progressCard}>
          <View style={[sc.progressTrack, { backgroundColor: colors.borderFaint }]}>
            <Animated.View
              style={[
                sc.progressFill,
                {
                  backgroundColor: colors.accent,
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>
        </View>
      )}

      {children}
    </View>
  );
}

export const sc = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  info: { flex: 1 },
  title: { fontSize: 15, marginBottom: 2 },
  status: { fontSize: 12, lineHeight: 17 },
  progressCard: { marginTop: spacing.sm },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
});

export function SectionLabel({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <Text
      style={{
        fontSize: 11,
        color: colors.textMuted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingHorizontal: spacing.lg,
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
      }}
    >
      {label}
    </Text>
  );
}

export function SrcButton({
  label,
  onPress,
  disabled,
  colors,
  fonts,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: ThemeColors;
  fonts: ThemeFonts;
  variant?: "primary" | "ghost";
}) {
  return (
    <Pressable
      style={[
        sb.btn,
        variant === "primary"
          ? { backgroundColor: colors.accentBold }
          : { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
        disabled && { opacity: 0.45 },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          sb.label,
          { fontFamily: fonts.sansMedium ?? fonts.sans },
          variant === "ghost" ? { color: colors.textSecondary } : { color: colors.white },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sb = StyleSheet.create({
  btn: {
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 13, fontWeight: "600" },
});
