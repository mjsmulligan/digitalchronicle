/**
 * Chronicle design tokens — single source of truth for colour, typography,
 * spacing, and border-radius values used across all mobile screens.
 *
 * Palette: warm dark (coffee/leather backgrounds, parchment text, terracotta accent).
 * Mirrors the character of the web version's warm parchment theme in dark mode.
 */

// ─── Fonts ────────────────────────────────────────────────────────────────────
//
// Serif: Lora via @expo-google-fonts/lora — bundled so it renders identically
// on Android (no more "serif" wildcard variation across Samsung/Pixel/Xiaomi)
// and on iOS. Loaded in _layout.tsx via useFonts before the splash screen hides.
//
// Sans: undefined here = system default (Roboto on Android, SF Pro on iOS).
// To upgrade to Inter, swap undefined with the Inter_* variant strings.

export const fonts = {
  /** Bold serif — trip titles, screen hero text, empty-state headings */
  serifBold:     "Lora_700Bold",
  /** Semi-bold serif — modal titles, card headings */
  serifSemiBold: "Lora_600SemiBold",
  /** Medium serif — subtitles, longform pull-quotes */
  serifMedium:   "Lora_500Medium",
  /** Regular serif — body in detail views */
  serifRegular:  "Lora_400Regular",
} as const;

// ─── Colours ─────────────────────────────────────────────────────────────────

export const colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  /** Page / screen background — warm cream */
  bg: "#F3ECE4",
  /** Card, input, surface — warm off-white */
  surface: "#F9F5ED",
  /** Pressed list-row highlight */
  surfacePressed: "#EFE8E0",
  /** Active filter / avatar self — light rust tint */
  surfaceAccent: "#F5E8E0",
  /** Badge bg — very light rust */
  surfaceAccentDeep: "#F9F0EB",

  // ── Borders ───────────────────────────────────────────────────────────────
  /** Standard card / input border — warm tan */
  border: "#E8DDD2",
  /** Subtle hairline divider — very light */
  borderFaint: "#F3EDEA",

  // ── Text ─────────────────────────────────────────────────────────────────
  /** Brightest headings — dark charcoal */
  textBright: "#1A1410",
  /** Primary body text — dark brown */
  textPrimary: "#2B2218",
  /** Slightly dimmed — mid-brown */
  textDim: "#5A5047",
  /** Secondary labels — warm tan */
  textSecondary: "#8B7D6B",
  /** Tertiary — dates, hints, captions */
  textTertiary: "#A89582",
  /** Muted / placeholders */
  textMuted: "#BFB3A0",

  // ── Accent — Warm Rust / Terracotta (matches web button colour) ──────────
  /** Primary accent border / icon */
  accent: "#A0522D",
  /** Bold accent — primary buttons */
  accentBold: "#8B4513",
  /** Soft accent — tab active, secondary icon */
  accentSoft: "#B85C3C",
  /** Pale rust text (on light rust surface) */
  accentSubtle: "#704020",
  /** Badge text — warm rust */
  accentBadge: "#A0522D",

  // ── Semantic ──────────────────────────────────────────────────────────────
  /** Star / rating — warm amber */
  star: "#D97706",
  /** Success — muted warm green */
  success: "#4E9A5A",
  /** Info / pending — teal blue */
  info: "#0EA5E9",
  /** Error text — warm red */
  error: "#C0321E",
  /** Error light text */
  errorLight: "#E89878",
  /** Danger background */
  errorBg: "#FFE8E3",
  /** Delete button background */
  deleteBg: "#FFF0ED",

  // ── Utility ───────────────────────────────────────────────────────────────
  white: "#ffffff",
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────
//
// Use via: `{ ...text.base, color: colors.textPrimary }`
// All sizes are in sp (React Native treats fontSize as sp on Android).

export const text = {
  /** 11 / 16 — badge labels, tiny captions */
  xs:   { fontSize: 11, lineHeight: 16 } as const,
  /** 12 / 18 — metadata, dates, section headers */
  sm:   { fontSize: 12, lineHeight: 18 } as const,
  /** 13 / 18 — secondary list text */
  smMd: { fontSize: 13, lineHeight: 18 } as const,
  /** 14 / 20 — supporting body, hints */
  md:   { fontSize: 14, lineHeight: 20 } as const,
  /** 15 / 22 — primary list title / body */
  base: { fontSize: 15, lineHeight: 22 } as const,
  /** 16 / 24 — form inputs, modal body */
  lg:   { fontSize: 16, lineHeight: 24 } as const,
  /** 18 / 26 — card subtitles */
  xl:   { fontSize: 18, lineHeight: 26 } as const,
  /** 20 / 28 — section headings */
  "2xl": { fontSize: 20, lineHeight: 28 } as const,
  /** 22 / 30 — card titles */
  "3xl": { fontSize: 22, lineHeight: 30 } as const,
  /** 28 / 36 — screen titles */
  "4xl": { fontSize: 28, lineHeight: 36 } as const,
  /** 48 / 56 — empty-state icon / hero */
  hero:  { fontSize: 48, lineHeight: 56 } as const,

  // Composed styles
  /** Uppercase section label (ENTRIES, SUGGESTED, etc.) */
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────
//
// 4-pt grid. Use as padding/margin/gap values.

export const spacing = {
  /** 4 */  xs:   4,
  /** 6 */  sm2:  6,
  /** 8 */  sm:   8,
  /** 12 */ md:   12,
  /** 14 */ md2:  14,
  /** 16 */ base: 16,
  /** 20 */ lg:   20,
  /** 24 */ xl:   24,
  /** 32 */ "2xl": 32,
  /** 48 */ "3xl": 48,
} as const;

// ─── Border Radius ────────────────────────────────────────────────────────────

export const radius = {
  /** 6 — small chips / badges */
  sm:   6,
  /** 8 — buttons */
  md:   8,
  /** 10 — list-row cards */
  lg:   10,
  /** 12 — standard cards */
  xl:   12,
  /** 16 — large hero cards */
  "2xl": 16,
  /** 20 — pill / filter chips */
  pill: 20,
  /** 9999 — fully round (avatars) */
  full: 9999,
} as const;

// ─── Common composed styles ───────────────────────────────────────────────────
//
// Reusable style objects for patterns that appear on almost every screen.
// Spread these into your local StyleSheet: `{ ...card, marginBottom: 8 }`

export const common = {
  /** Full-height page background */
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  /** Standard dark card */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.base,
  },

  /** Uppercase section label row */
  sectionLabel: {
    ...text.label,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },

  /** Centered empty-state container */
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing["2xl"],
  },

  /** Primary indigo action button */
  btnPrimary: {
    backgroundColor: colors.accentBold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md2,
    paddingVertical: spacing.sm,
    alignItems: "center" as const,
  },

  /** Standard dark header options — spread into Stack.Screen options.
   *  Includes headerShown: true so screens override the root layout's
   *  global headerShown: false default. */
  header: {
    headerShown: true,
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
} as const;
