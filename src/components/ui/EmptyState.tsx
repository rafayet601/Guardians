import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, useReducedMotion } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon?: string;
  compact?: boolean;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = '🐾',
  compact = false,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <Animated.View
      entering={reduced ? FadeInUp.duration(0) : FadeInUp.duration(420)}
      style={[styles.wrap, compact && styles.compact]}
    >
      {!compact && (
        <View
          style={styles.illustration}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.orbit} />
          <View style={styles.icon}>
            <Ionicons name={EMPTY_ICONS[icon] ?? 'paw-outline'} size={36} color={colors.primary} />
          </View>
          <View style={styles.spark}>
            <Ionicons name="sparkles" size={18} color={colors.accentDark} />
          </View>
        </View>
      )}
      <Text variant="heading" center>
        {title}
      </Text>
      {message ? (
        <Text variant="body" muted center style={styles.message}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </Animated.View>
  );
}

const EMPTY_ICONS: Record<string, ComponentProps<typeof Ionicons>['name']> = {
  '🐾': 'paw-outline',
  '🏆': 'trophy-outline',
  '🎁': 'gift-outline',
  '🔍': 'search-outline',
  '💬': 'chatbubble-outline',
  '🛡️': 'shield-checkmark-outline',
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  compact: { padding: spacing.md },
  illustration: {
    width: 112,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  orbit: {
    position: 'absolute',
    width: 100,
    height: 76,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderRadius: radius.pill,
    transform: [{ rotate: '-25deg' }],
  },
  icon: {
    width: 76,
    height: 76,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  spark: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { maxWidth: 280 },
  action: { marginTop: spacing.md },
});
