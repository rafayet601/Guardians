import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

/** A failed refresh must not hide usable cached content or imply it is current. */
export function QueryNotice({
  message,
  onRetry,
  retrying = false,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Ionicons name="cloud-offline-outline" size={20} color={colors.accentDark} />
        <Text variant="small" style={styles.message} color={colors.textSecondary}>
          {message}
        </Text>
      </View>
      <Button title="Try again" variant="ghost" size="sm" loading={retrying} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    marginBottom: spacing.lg,
  },
  copy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  message: { flex: 1 },
});
