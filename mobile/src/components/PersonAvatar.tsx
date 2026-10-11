/**
 * PersonAvatar — circular avatar that shows a contact photo if one is stored,
 * falling back to initials on a themed background.
 *
 * Usage:
 *   <PersonAvatar person={p} size={40} colors={colors} fonts={fonts} />
 */
import { Image, StyleSheet, Text, View } from "react-native";
import type { Person } from "@chronicle/journal/types";
import type { ThemeColors, ThemeFonts } from "./ThemeProvider";
import { radius as radiusScale } from "./ThemeProvider";

interface Props {
  person: Pick<Person, "name" | "photo" | "isSelf">;
  size: number;
  colors: ThemeColors;
  fonts: ThemeFonts;
}

export function PersonAvatar({ person, size, colors, fonts }: Props) {
  const initials = person.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const fontSize = Math.round(size * 0.38);

  if (person.photo) {
    return (
      <Image
        source={{ uri: person.photo }}
        style={{
          width: size,
          height: size,
          borderRadius: radiusScale.full,
        }}
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radiusScale.full,
          backgroundColor: person.isSelf ? colors.surfaceAccent : colors.border,
        },
      ]}
    >
      <Text
        style={{
          color: colors.textDim,
          fontSize,
          fontWeight: "700",
          fontFamily: fonts.sansMedium ?? fonts.sans,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
});
