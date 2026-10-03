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
 * to fontFamily in a StyleSheet. WP1.3 will load Fraunces, IBM Plex Sans and
 * JetBrains Mono and populate sans/mono; for now they are optional.
 */
export interface ThemeFonts {
  serifBold: string;
  serifSemiBold: string;
  serifMedium: string;
  serifRegular: string;
  /** Base sans-serif family; undefined means system default (Roboto/SF Pro). */
  sans?: string;
  /** Base monospace family; undefined means system default. */
  mono?: string;
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
// Fonts are placeholders until WP1.3 bundles Fraunces + IBM Plex Sans + JetBrains Mono.

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
  // Placeholder: WP1.3 replaces these with Fraunces weights.
  fonts: {
    serifBold:     "Lora_700Bold",
    serifSemiBold: "Lora_600SemiBold",
    serifMedium:   "Lora_500Medium",
    serifRegular:  "Lora_400Regular",
  },
};

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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseThemeResult extends ThemeDefinition {
  setThemeId: (id: string) => void;
}

/**
 * Returns the active theme's tokens plus setThemeId.
 * Must be called inside a ThemeProvider.
 *
 * Example:
 *   const { colors, fonts } = useTheme();
 *   <Text style={{ color: colors.textPrimary, fontFamily: fonts.serifBold }} />
 */
export function useTheme(): UseThemeResult {
  const { theme, setThemeId } = useContext(ThemeContext);
  return { ...theme, setThemeId };
}
