/**
 * Shared card-chrome styles used by BatchReview and PlaceStagingCard.
 * Both components use the same layout: header row, optional error box,
 * quick-action bar, commit button bar, and a slim animated progress card.
 */
import { StyleSheet } from "react-native";
import { spacing, radius } from "./ThemeProvider";

export const br = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  filename: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  meta: { fontSize: 12 },
  errBox: {
    padding: 10,
    borderBottomWidth: 1,
  },
  errText: { fontSize: 11, marginBottom: 2 },
  quick: {
    flexDirection: "row",
    gap: spacing.base,
    padding: 10,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  quickText: { fontSize: 12, fontWeight: "600" },
  commitBar: { padding: spacing.md },
  commitBtn: {
    borderRadius: radius.lg,
    paddingVertical: 13,
    alignItems: "center",
  },
  commitBtnText: { fontSize: 14, fontWeight: "700" },
  loadMore: {
    padding: spacing.md,
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  loadMoreText: { fontSize: 13, fontWeight: "600" },
  commitTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  commitCount: { fontSize: 12, marginTop: 2 },
  track: {
    height: 4,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 2 },
});
