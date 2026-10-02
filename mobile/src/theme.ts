/**
 * Chronicle design tokens — single source of truth for colour, typography,
 * spacing, and border-radius values used across all mobile screens.
 *
 * Palette is Tailwind Slate (backgrounds / text) + Indigo (accents).
 */

// ─── Colours ─────────────────────────────────────────────────────────────────

export const colors = {
  // ── Backgrounds ──────────────────────────────────────────────────────────
  /** Page / screen background — slate-900 */
  bg: "#0f172a",
  /** Card, input, surface — slate-800 */
  surface: "#1e293b",
  /** Pressed list-row highlight — slightly lighter than surface */
  surfacePressed: "#1a2535",
  /** Deep indigo surface (active filters, person avatar self) — indigo-900 */
  surfaceAccent: "#312e81",
  /** Darkest indigo surface (badge bg) — indigo-950 */
  surfaceAccentDeep: "#1e1b4b",

  // ── Borders ───────────────────────────────────────────────────────────────
  /** Standard card / input border — slate-700 */
  border: "#334155",
  /** Subtle hairline divider — slate-800 (same as surface) */
  borderFaint: "#1e293b",

  // ── Text ─────────────────────────────────────────────────────────────────
  /** Brightest headings — slate-50 */
  textBright: "#f8fafc",
  /** Primary body text — slate-100 */
  textPrimary: "#f1f5f9",
  /** Slightly dimmed — slate-200 (avatar initials, chip labels) */
  textDim: "#e2e8f0",
  /** Secondary labels — slate-400 */
  textSecondary: "#94a3b8",
  /** Tertiary — dates, hints, captions — slate-500 */
  textTertiary: "#64748b",
  /** Muted / placeholders — slate-600 */
  textMuted: "#475569",

  // ── Accent — Indigo ───────────────────────────────────────────────────────
  /** Primary accent border / icon — indigo-500 */
  accent: "#6366f1",
  /** Bold accent — primary buttons — indigo-600 */
  accentBold: "#4f46e5",
  /** Soft accent — tab active, secondary icon — indigo-400 */
  accentSoft: "#818cf8",
  /** Lightest indigo text (on dark indigo surface) — indigo-100 */
  accentSubtle: "#e0e7ff",
  /** Indigo badge text — indigo-300 */
  accentBadge: "#a5b4fc",

  // ── Semantic ──────────────────────────────────────────────────────────────
  /** Star / rating — amber-500 */
  star: "#f59e0b",
  /** Success — green-500 */
  success: "#22c55e",
  /** Info / pending — blue-500 */
  info: "#3b82f6",
  /** Error text — red-500 */
  error: "#ef4444",
  /** Error light text — red-300 */
  errorLight: "#fca5a5",
  /** Danger background — red-950 */
  errorBg: "#450a0a",
  /** Delete button background — red-900 */
  deleteBg: "#7f1d1d",

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

  /** Standard dark header options */
  header: {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.textBright,
    headerShadowVisible: false,
  },
} as const;
