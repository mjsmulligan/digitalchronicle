/**
 * Theme system for Chronicle mobile.
 *
 * Usage:
 *   - Wrap the app in <ThemeProvider> (done in app/_layout.tsx).
 *   - Call useTheme() in any component to get tokens and setThemeId.
 *   - Existing screens that still import directly from src/theme.ts are
 *     unaffected until WP1.2 migrates them to useTheme().
 *
 * Adding a theme: register a new ThemeDefinition in THEMES below.
 * Components must never branch on themeId -- consume tokens only.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as FileSystem from "expo-file-system/legacy";

// ─── Token types ─────────────────────────────────────────────────────────────

export interface ThemeColors {
  // Backgrounds
  bg: string;
  surface: string;
  surfacePressed: string;
  surfaceAccent: string;
  surfaceAccentDeep: string;
  // Borders
  border: string;
  borderFaint: string;
  // Text
  textBright: string;
  textPrimary: string;
  textDim: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  // Accent
  accent: string;
  accentBold: string;
  accentSoft: string;
  accentSubtle: string;
  accentBadge: string;
  // Semantic
  star: string;
  success: string;
  info: string;
  error: string;
  errorLight: string;
  errorBg: string;
  deleteBg: string;
  white: string;
}

/**
 * Font family name tokens. Each value is a string that can be passed directly
 * to fontFamily in a StyleSheet.
 *
 * Leather uses Lora (serif only; sans/mono fall back to system defaults).
 * Paper uses Fraunces (serif), IBM Plex Sans (sans) and JetBrains Mono (mono).
 */
export interface ThemeFonts {
  serifBold: string;
  serifSemiBold: string;
  serifMedium: string;
  serifRegular: string;
  /** Regular-weight sans-serif; undefined falls back to system default. */
  sans?: string;
  /** Medium-weight sans-serif; undefined falls back to sans. */
  sansMedium?: string;
  /** Regular-weight monospace; undefined falls back to system default. */
  mono?: string;
  /** Medium-weight monospace; undefined falls back to mono. */
  monoMedium?: string;
}

export interface ThemeDefinition {
  id: string;
  /** Shown in the Appearance screen. */
  name: string;
  mode: "light" | "dark";
  colors: ThemeColors;
  fonts: ThemeFonts;
}

// ─── Leather theme (current values -- do not edit here; edit src/theme.ts) ───

const leather: ThemeDefinition = {
  id: "leather",
  name: "Leather",
  mode: "light",
  colors: {
    bg:                "#F3ECE4",
    surface:           "#F9F5ED",
    surfacePressed:    "#EFE8E0",
    surfaceAccent:     "#F5E8E0",
    surfaceAccentDeep: "#F9F0EB",
    border:            "#E8DDD2",
    borderFaint:       "#F3EDEA",
    textBright:        "#1A1410",
    textPrimary:       "#2B2218",
    textDim:           "#5A5047",
    textSecondary:     "#8B7D6B",
    textTertiary:      "#A89582",
    textMuted:         "#BFB3A0",
    accent:            "#A0522D",
    accentBold:        "#8B4513",
    accentSoft:        "#B85C3C",
    accentSubtle:      "#704020",
    accentBadge:       "#A0522D",
    star:              "#D97706",
    success:           "#4E9A5A",
    info:              "#0EA5E9",
    error:             "#C0321E",
    errorLight:        "#E89878",
    errorBg:           "#FFE8E3",
    deleteBg:          "#FFF0ED",
    white:             "#ffffff",
  },
  fonts: {
    serifBold:     "Lora_700Bold",
    serifSemiBold: "Lora_600SemiBold",
    serifMedium:   "Lora_500Medium",
    serifRegular:  "Lora_400Regular",
  },
};

// ─── Paper theme (spec 4.2 -- default once WP1.5 activates it) ───────────────

const paper: ThemeDefinition = {
  id: "paper",
  name: "Paper",
  mode: "light",
  colors: {
    bg:                "#F9F3E6",
    surface:           "#FEFAF1",
    surfacePressed:    "#EEE7D9",
    surfaceAccent:     "#EADCC5",
    surfaceAccentDeep: "#F4EDE0",
    border:            "#DAD0BF",
    borderFaint:       "#EDE6DA",
    textBright:        "#291C14",
    textPrimary:       "#291C14",
    textDim:           "#706052",
    textSecondary:     "#706052",
    textTertiary:      "#9A8B77",
    textMuted:         "#9A8B77",
    accent:            "#A5492B",
    accentBold:        "#8B3C22",
    accentSoft:        "#A5492B",
    accentSubtle:      "#7A3520",
    accentBadge:       "#A5492B",
    star:              "#D97706",
    success:           "#4E9A5A",
    info:              "#0EA5E9",
    error:             "#CC2827",
    errorLight:        "#E89878",
    errorBg:           "#FFE8E3",
    deleteBg:          "#FFF0ED",
    white:             "#ffffff",
  },
  fonts: {
    serifBold:     "Fraunces_600SemiBold",
    serifSemiBold: "Fraunces_600SemiBold",
    serifMedium:   "Fraunces_500Medium",
    serifRegular:  "Fraunces_400Regular",
    sans:          "IBMPlexSans_400Regular",
    sansMedium:    "IBMPlexSans_500Medium",
    mono:          "JetBrainsMono_400Regular",
    monoMedium:    "JetBrainsMono_500Medium",
  },
};

// ─── Invariant tokens (same across all themes for now) ───────────────────────
// These live here so screens only import from ThemeProvider and have no reason
// to reach into the deleted compat layer (src/theme.ts).

export const text = {
  xs:    { fontSize: 11, lineHeight: 16 } as const,
  sm:    { fontSize: 12, lineHeight: 18 } as const,
  smMd:  { fontSize: 13, lineHeight: 18 } as const,
  md:    { fontSize: 14, lineHeight: 20 } as const,
  base:  { fontSize: 15, lineHeight: 22 } as const,
  lg:    { fontSize: 16, lineHeight: 24 } as const,
  xl:    { fontSize: 18, lineHeight: 26 } as const,
  "2xl": { fontSize: 20, lineHeight: 28 } as const,
  "3xl": { fontSize: 22, lineHeight: 30 } as const,
  "4xl":      { fontSize: 28, lineHeight: 36 } as const,
  hero:       { fontSize: 48, lineHeight: 56 } as const,
  // Named type roles (spec 4.4)
  dayNum:     { fontSize: 32, lineHeight: 36 } as const,
  feedTitle:  { fontSize: 17, lineHeight: 24 } as const,
  pageTitle:  { fontSize: 28, lineHeight: 34 } as const,
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
} as const;

export const spacing = {
  xs:    4,
  sm2:   6,
  sm:    8,
  md:    12,
  md2:   14,
  base:  16,
  lg:    20,
  xl:    24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const radius = {
  sm:    6,
  md:    8,
  lg:    10,
  xl:    12,
  "2xl": 16,
  pill:  20,
  full:  9999,
} as const;

// ─── Registry ─────────────────────────────────────────────────────────────────

export const THEMES: Record<string, ThemeDefinition> = {
  leather,
  paper,
};

const DEFAULT_THEME_ID = "leather";

function resolveTheme(id: string | null | undefined): ThemeDefinition {
  return (id && THEMES[id]) || THEMES[DEFAULT_THEME_ID]!;
}

// ─── Persistence (expo-file-system, no extra dependency) ─────────────────────

const PREFS_PATH = (FileSystem.documentDirectory ?? "") + "chronicle-prefs.json";

async function readPersistedThemeId(): Promise<string | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(PREFS_PATH);
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return typeof obj.themeId === "string" ? obj.themeId : null;
  } catch {
    return null;
  }
}

async function writePersistedThemeId(id: string): Promise<void> {
  try {
    let existing: Record<string, unknown> = {};
    try {
      const raw = await FileSystem.readAsStringAsync(PREFS_PATH);
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // No existing file -- start fresh.
    }
    await FileSystem.writeAsStringAsync(
      PREFS_PATH,
      JSON.stringify({ ...existing, themeId: id }),
    );
  } catch {
    // Persistence failure is non-fatal; in-memory state remains correct.
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeDefinition;
  setThemeId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: leather,
  setThemeId: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeDefinition>(leather);

  // Load the persisted choice once on mount.
  useEffect(() => {
    readPersistedThemeId().then((id) => {
      if (id && THEMES[id] && id !== theme.id) {
        setTheme(THEMES[id]!);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setThemeId = useCallback((id: string) => {
    const next = resolveTheme(id);
    setTheme(next);
    writePersistedThemeId(id);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Common composed styles (computed from live theme tokens) ─────────────────

/**
 * Builds reusable composed style objects from the active theme's color/font
 * tokens. Returned via useTheme() as `common` so screens can spread them
 * exactly as they did with the old compat-layer `common` export.
 *
 * Example:
 *   const { colors, common } = useTheme();
 *   <Stack.Screen options={{ title: "Detail", ...common.header }} />
 */
function makeCommon(colors: ThemeColors, fonts: ThemeFonts) {
  return {
    screen: {
      flex: 1 as const,
      backgroundColor: colors.bg,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.base,
    },
    sectionLabel: {
      ...text.label,
      fontFamily: fonts.mono,
      color: colors.textTertiary,
      marginBottom: spacing.sm,
    },
    empty: {
      flex: 1 as const,
      backgroundColor: colors.bg,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      padding: spacing["2xl"],
    },
    btnPrimary: {
      backgroundColor: colors.accentBold,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md2,
      paddingVertical: spacing.sm,
      alignItems: "center" as const,
    },
    header: {
      headerShown: true as const,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.textBright,
      headerShadowVisible: false,
      headerTitleStyle: {
        fontFamily: fonts.serifSemiBold,
        fontWeight: "600" as const,
        fontSize: 18,
        color: colors.textBright,
      },
    },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseThemeResult extends ThemeDefinition {
  text: typeof text;
  spacing: typeof spacing;
  radius: typeof radius;
  common: ReturnType<typeof makeCommon>;
  setThemeId: (id: string) => void;
}

/**
 * Returns the active theme's tokens plus invariant scales and composed styles.
 * Must be called inside a ThemeProvider.
 *
 * Example:
 *   const { colors, fonts, text, spacing, radius, common } = useTheme();
 *   <Text style={{ color: colors.textPrimary, ...text.base }} />
 *   <Stack.Screen options={{ title: "", ...common.header }} />
 */
export function useTheme(): UseThemeResult {
  const { theme, setThemeId } = useContext(ThemeContext);
  return {
    ...theme,
    text,
    spacing,
    radius,
    common: makeCommon(theme.colors, theme.fonts),
    setThemeId,
  };
}
