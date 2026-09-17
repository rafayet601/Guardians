import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from './Text';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row} accessibilityLabel="Guardians">
      <View style={styles.mark}>
        <Ionicons name="paw" size={22} color={colors.white} />
      </View>
      {!compact && (
        <Text variant="heading" color={colors.primaryDeep}>
          guardians
          <Text color={colors.primary} variant="heading">
            .
          </Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
  },
});
