import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, layout, radius, spacing } from '@/theme';
import { Text } from './Text';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <Text variant="overline" color={colors.primary}>
          {eyebrow}
        </Text>
        <Text variant="display" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="small" muted>
          {subtitle}
        </Text>
      </View>
      <View
        style={styles.icon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    maxWidth: layout.contentMax,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  copy: { flex: 1, gap: spacing.xs },
  icon: {
    width: 54,
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
