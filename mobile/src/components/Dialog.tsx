/**
 * Themed dialog component — replaces React Native's Alert.alert() so dialogs
 * match the app's warm dark palette instead of the OS default white sheet.
 *
 * Usage:
 *   const dialog = useDialog();
 *
 *   // Simple info / error
 *   dialog.alert("Import failed", String(err));
 *   dialog.alert("Import complete", "42 entries added.", () => router.dismiss());
 *
 *   // Destructive confirmation (backdrop tap disabled)
 *   dialog.confirm(
 *     "Reset database",
 *     "This cannot be undone.",
 *     "Reset",
 *     async () => { await clearAll(); }
 *   );
 *
 *   // Render once in the screen's JSX (modal layers above everything)
 *   return (
 *     <>
 *       <YourScreen />
 *       <Dialog {...dialog.props} onDismiss={dialog.dismiss} />
 *     </>
 *   );
 */
import { useState, useCallback } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing, radius } from "../theme";

// ── types ─────────────────────────────────────────────────────────────────────

type ActionStyle = "default" | "cancel" | "destructive";

interface DialogAction {
  label: string;
  style?: ActionStyle;
  onPress?: () => void | Promise<void>;
}

interface DialogConfig {
  title: string;
  message: string;
  actions: DialogAction[];
  /** When true the backdrop tap does nothing — use for destructive confirmations */
  lockBackdrop?: boolean;
}

interface DialogState extends DialogConfig {
  visible: boolean;
}

const HIDDEN: DialogState = {
  visible: false,
  title: "",
  message: "",
  actions: [],
};

// ── hook ──────────────────────────────────────────────────────────────────────

export function useDialog() {
  const [state, setState] = useState<DialogState>(HIDDEN);

  const dismiss = useCallback(() => setState(HIDDEN), []);

  /** One button — information or error feedback */
  const alert = useCallback(
    (title: string, message: string, onOk?: () => void) => {
      setState({
        visible: true,
        title,
        message,
        actions: [{ label: "OK", style: "default", onPress: onOk }],
      });
    },
    []
  );

  /** Two buttons — cancel (left) + destructive action (right) */
  const confirm = useCallback(
    (
      title: string,
      message: string,
      confirmLabel: string,
      onConfirm: () => void | Promise<void>
    ) => {
      setState({
        visible: true,
        title,
        message,
        lockBackdrop: true,
        actions: [
          { label: "Cancel", style: "cancel" },
          { label: confirmLabel, style: "destructive", onPress: onConfirm },
        ],
      });
    },
    []
  );

  return { alert, confirm, dismiss, props: state };
}

// ── component ─────────────────────────────────────────────────────────────────

interface DialogProps extends DialogState {
  onDismiss: () => void;
}

export function Dialog({
  visible,
  title,
  message,
  actions,
  lockBackdrop,
  onDismiss,
}: DialogProps) {
  const handleAction = (action: DialogAction) => {
    onDismiss();
    action.onPress?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={lockBackdrop ? undefined : onDismiss}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable
        style={styles.backdrop}
        onPress={lockBackdrop ? undefined : onDismiss}
      >
        {/* Card — inner Pressable swallows taps so they don't reach backdrop */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={[styles.actions, actions.length === 1 && styles.actionsSingle]}>
            {actions.map((action, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [
                  styles.btn,
                  action.style === "cancel"      && styles.btnCancel,
                  action.style === "destructive" && styles.btnDestructive,
                  pressed                        && styles.btnPressed,
                ]}
                onPress={() => handleAction(action)}
              >
                <Text
                  style={[
                    styles.btnText,
                    action.style === "cancel"      && styles.btnTextCancel,
                    action.style === "destructive" && styles.btnTextDestructive,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing["2xl"],
  },

  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    // Subtle shadow so it lifts off the backdrop
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },

  title: {
    fontFamily: fonts.serifSemiBold,
    fontWeight: "600",
    fontSize: 18,
    color: colors.textBright,
    marginBottom: spacing.sm,
  },

  message: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },

  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionsSingle: {
    justifyContent: "flex-end",
  },

  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md2,
    borderRadius: radius.lg,
    alignItems: "center",
    backgroundColor: colors.accentBold,
  },
  btnCancel: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDestructive: {
    backgroundColor: colors.error,
  },
  btnPressed: {
    opacity: 0.7,
  },

  btnText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.white,
  },
  btnTextCancel: {
    color: colors.textSecondary,
  },
  btnTextDestructive: {
    color: colors.white,
  },
});
