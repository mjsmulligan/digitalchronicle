import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
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
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      right: 16,
      zIndex: 1000,
    },
    navBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      height: 56,
      borderRadius: 12,
      backgroundColor: colors.surface,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
        },
        android: {
          elevation: 8,
        },
      }),
    },
    navItem: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 8,
    },
    pressed: {
      opacity: 0.7,
    },
  }), [colors]);

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <View style={styles.navBar}>
        {items.map((item, index) => (
          <Pressable
            key={index}
            onPress={item.onPress}
            style={({ pressed }) => [
              styles.navItem,
              pressed && styles.pressed,
            ]}
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: item.active }}
          >
            <Ionicons
              name={item.active ? item.activeIcon : item.icon}
              size={24}
              color={item.active ? colors.accentSoft : colors.textMuted}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
};
