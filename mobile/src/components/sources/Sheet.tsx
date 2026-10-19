/**
 * Sheet: a bottom sheet built on React Native's Modal (no native dependency).
 *
 * Used by the Sources page for connect and manage flows
 * (docs/specs/sources-page.md, section 6).
 *
 *   <Sheet visible={open} title="Google Calendar" onClose={() => setOpen(false)}>
 *     ...content...
 *   </Sheet>
 *
 * Behaviour:
 *   - Scrim, rounded top corners, drag handle, max height 85 percent.
 *   - Content scrolls when it is taller than the sheet.
 *   - Dismissed by scrim tap, the close button, dragging down, or the Android
 *     back button. Every path calls onClose; the parent owns `visible`.
 *   - Respects the system "reduce motion" setting (no slide, no fade).
 *   - Announces its title on open, and returns screen reader focus to
 *     `returnFocusRef` (the element that opened it) on close.
 *   - Safe-area aware at the bottom edge, and lifts above the keyboard.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, spacing, radius } from "../ThemeProvider";

/** Fraction of the window height the sheet may fill. */
export const SHEET_MAX_HEIGHT_FRACTION = 0.85;
/** Drag distance (dp) or release velocity (dp/ms) that dismisses the sheet. */
const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.8;
const OPEN_MS = 240;
const CLOSE_MS = 180;

export interface SheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** The element that opened the sheet. Screen reader focus returns to it on close. */
  returnFocusRef?: React.RefObject<View | null>;
  children: React.ReactNode;
}

export function Sheet({ visible, title, onClose, returnFocusRef, children }: SheetProps) {
  const { colors, fonts } = useTheme();
  const { bottom } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // `mounted` outlives `visible` so the close animation can finish.
  const [mounted, setMounted] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);

  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current; // 0 closed, 1 open
  const dragY = useRef(new Animated.Value(0)).current;
  const wasVisible = useRef(visible);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { live = false; sub.remove(); };
  }, []);

  // Open and close, driven by `visible`.
  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      setMounted(true);
      dragY.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduceMotion ? 0 : OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      // Give the modal a moment to mount before announcing.
      const t = setTimeout(() => AccessibilityInfo.announceForAccessibility(title), 350);
      return () => clearTimeout(t);
    }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduceMotion ? 0 : CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      dragY.setValue(0);
      const node = returnFocusRef?.current ? findNodeHandle(returnFocusRef.current) : null;
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag the handle area down to dismiss.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) {
            onClose();
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [dragY, onClose],
  );

  const handleRequestClose = useCallback(() => onClose(), [onClose]);

  const maxHeight = Math.round(windowHeight * SHEET_MAX_HEIGHT_FRACTION);
  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [maxHeight, 0] }),
    dragY,
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, justifyContent: "flex-end" },
        scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
        sheet: {
          maxHeight,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius["2xl"] + 4,
          borderTopRightRadius: radius["2xl"] + 4,
          borderWidth: 1,
          borderBottomWidth: 0,
          borderColor: colors.border,
          overflow: "hidden",
        },
        handleArea: { alignItems: "center", paddingTop: spacing.sm, paddingBottom: spacing.xs },
        handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
        header: {
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: spacing.lg,
          paddingRight: spacing.xs,
        },
        title: {
          flex: 1,
          fontFamily: fonts.serifSemiBold,
          fontSize: 20,
          color: colors.textBright,
        },
        closeBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
        body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
      }),
    [colors, fonts, maxHeight],
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.scrim, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint={`Closes ${title}`}
          />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          <View {...pan.panHandlers}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
                {title}
              </Text>
              <Pressable
                style={styles.closeBtn}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={`Close ${title}`}
                hitSlop={4}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={[styles.body, { paddingBottom: Math.max(bottom, spacing.base) + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
