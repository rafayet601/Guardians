import { StyleSheet } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { spacing } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = '🐾', title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Animated.View entering={FadeInUp.duration(420)} style={styles.wrap}>
      <Text style={styles.icon}>{icon}</Text>
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

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm },
  icon: { fontSize: 52, marginBottom: spacing.xs },
  message: { maxWidth: 280 },
  action: { marginTop: spacing.md },
});
