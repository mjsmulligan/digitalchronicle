/**
 * TabBar — the app's bottom navigation bar.
 *
 * Design (spec 6.1):
 *   - Docked to the bottom; `surfaceMuted` background; hairline top border.
 *   - Active item: filled `surfaceAccent` pill behind the icon; icon + label
 *     in `accentSoft`. Inactive: `textSecondary`.
 *   - 24dp icons, 11sp sans labels, 80dp total height + safe area inset.
 *   - No floating shadow — integrates with the screen rather than hovering over it.
 *
 * The component is still exported as `FloatingNavBar` so all existing import
 * sites stay unchanged. The props contract is identical.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../components/ThemeProvider';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface NavItem {
  icon: IoniconName;
  activeIcon: IoniconName;
  active: boolean;
  onPress: () => void;
  label: string;
}

interface FloatingNavBarProps {
  items: NavItem[];
}

export const FloatingNavBar: React.FC<FloatingNavBarProps> = ({ items }) => {
  const insets = useSafeAreaInsets();
  const { colors, fonts } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceMuted,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingBottom: insets.bottom,
      height: 56 + insets.bottom,
    },
    item: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 8,
      paddingBottom: 4,
      gap: 2,
    },
    pill: {
      width: 64,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceAccent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: 11,
      fontFamily: fonts.sans,
      fontWeight: '600',
      lineHeight: 14,
    },
    labelActive:   { color: colors.accentSoft },
    labelInactive: { color: colors.textSecondary },
  }), [colors, fonts, insets.bottom]);

  return (
    <View style={styles.bar}>
      {items.map((item, index) => (
        <Pressable
          key={index}
          onPress={item.onPress}
          style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
          accessibilityLabel={item.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.active }}
        >
          {item.active ? (
            <View style={styles.pill}>
              <Ionicons name={item.activeIcon} size={24} color={colors.accentSoft} />
            </View>
          ) : (
            <Ionicons name={item.icon} size={24} color={colors.textSecondary} />
          )}
          <Text style={[styles.label, item.active ? styles.labelActive : styles.labelInactive]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};
