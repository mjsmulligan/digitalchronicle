/**
 * PosterCard — shows a TMDB movie/TV poster on the entry detail screen.
 *
 * Behaviour:
 *  - Calls resolveArtwork on mount for the supplied artwork key.
 *  - While loading: reserves the 2:3 space with a subtle shimmer placeholder
 *    so layout doesn't jump when the image arrives.
 *  - No match (or toggle off): renders nothing — the entry detail shows no
 *    poster section at all.
 *  - Match found: renders the poster with paper-print treatment (slight
 *    counter-clockwise rotation, drop shadow to suggest corner mounts).
 *
 * Accessible: labelled "Poster for {title}" so screen readers announce it.
 *
 * Caching: uses React Native's native Image, which caches to the OS image
 * cache on both iOS and Android. For persistent disk caching across cold
 * starts install expo-image and swap the import:
 *   npx expo install expo-image
 *   import { Image } from "expo-image";
 *   add cachePolicy="disk" to the Image props
 */
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type ViewStyle,
} from "react-native";
import { resolveArtwork } from "@chronicle/journal/artworkEnrichment";
import { getArtworkProvider } from "@chronicle/journal/artworkProvider";
import { useTheme } from "./ThemeProvider";
import type { ArtworkMatch } from "@chronicle/journal/artwork";

// ── Layout constants ──────────────────────────────────────────────────────────

const POSTER_WIDTH  = 120;
const POSTER_HEIGHT = 180; // strict 2:3 ratio

const COMPACT_WIDTH  = 80;
const COMPACT_HEIGHT = 120; // same 2:3 ratio

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  artworkKey: string;
  /** Title used for the accessible label: "Poster for {title}" */
  title: string;
  /**
   * "detail" (default) — large centered poster with tilt and shadow for the
   *   entry detail screen.
   * "compact" — smaller (80×120), no tilt, left-aligned, for inline list use
   *   (culture page group headers and standalone entries).
   */
  variant?: "detail" | "compact";
}

type PosterState = "loading" | "found" | "none";

export function PosterCard({ artworkKey, title, variant = "detail" }: Props) {
  const compact = variant === "compact";
  const { colors, radius } = useTheme();
  const [state, setState] = useState<PosterState>("loading");
  const [match, setMatch] = useState<ArtworkMatch | null>(null);

  // Fade-in animation — triggers when image transitions from loading → found
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setMatch(null);
    fadeAnim.setValue(0);

    resolveArtwork(artworkKey).then((m) => {
      if (cancelled) return;
      setMatch(m);
      setState(m ? "found" : "none");
      if (m) {
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [artworkKey]);

  // "None" or loading-resolved-to-none: render nothing (no poster section)
  if (state === "none") return null;

  const provider = getArtworkProvider();
  const imageUri =
    match?.poster_path && provider ? provider.imageUrl(match.poster_path) : null;

  const w = compact ? COMPACT_WIDTH  : POSTER_WIDTH;
  const h = compact ? COMPACT_HEIGHT : POSTER_HEIGHT;

  const containerStyle: ViewStyle = compact
    ? {
        width: w,
        height: h,
        borderRadius: radius.md ?? 6,
        overflow: "hidden",
        alignSelf: "flex-start" as const,
        marginBottom: 8,
      }
    : {
        width: w,
        height: h,
        borderRadius: radius.lg ?? 10,
        overflow: "hidden",
        // Paper-print: gentle counter-clockwise tilt + soft drop shadow
        transform: [{ rotate: "-1.5deg" }],
        shadowColor: "#000",
        shadowOffset: { width: 1, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
        alignSelf: "center" as const,
        marginVertical: 8,
      };

  const placeholderStyle: ViewStyle = compact
    ? {
        width: w,
        height: h,
        borderRadius: radius.md ?? 6,
        backgroundColor: colors.border,
        alignSelf: "flex-start" as const,
        marginBottom: 8,
      }
    : {
        width: w,
        height: h,
        borderRadius: radius.lg ?? 10,
        backgroundColor: colors.border,
        alignSelf: "center" as const,
        marginVertical: 8,
      };

  const imageStyle: ImageStyle = { width: w, height: h };

  // While resolving: show a quiet placeholder to reserve space
  if (state === "loading") {
    return <View style={placeholderStyle} accessibilityElementsHidden />;
  }

  // If we have a match but no URI (poster_path missing), hide gracefully
  if (!imageUri) return null;

  return (
    <Animated.View
      style={[containerStyle, { opacity: fadeAnim }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Poster for ${title}`}
    >
      <Image
        source={{ uri: imageUri }}
        style={StyleSheet.flatten(imageStyle) as ImageStyle}
        resizeMode="cover"
      />
    </Animated.View>
  );
}
