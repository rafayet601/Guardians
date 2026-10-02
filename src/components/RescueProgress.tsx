import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { NEXT_STEP, RESCUE_STAGES, rescueStageIndex } from '@/constants/journey';
import { colors, radius, spacing } from '@/theme';
import type { CatStatus } from '@/types/models';

export function RescueProgress({
  status,
  canManage = false,
}: {
  status: CatStatus;
  canManage?: boolean;
}) {
  const current = rescueStageIndex(status);
  if (current < 0) return null;
  return (
    <View style={styles.wrap}>
      <Text variant="overline" color={colors.primaryDark}>
        The journey home
      </Text>
      <View
        style={styles.stages}
        accessible
        accessibilityLabel={`Rescue journey: ${RESCUE_STAGES[current].label}, step ${current + 1} of ${RESCUE_STAGES.length}`}
      >
        {RESCUE_STAGES.map((stage, index) => (
          <View key={stage.label} style={styles.stage}>
            <View style={[styles.bar, index <= current && styles.complete]} />
            <Text
              variant="caption"
              color={index === current ? colors.primaryDark : colors.textSecondary}
            >
              {stage.label}
            </Text>
          </View>
        ))}
      </View>
      {canManage ? (
        <Text variant="small" muted>
          {NEXT_STEP[status]}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.lg,
  },
  stages: { flexDirection: 'row', gap: spacing.xs },
  stage: { flex: 1, gap: spacing.sm },
  bar: { height: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.border },
  complete: { backgroundColor: colors.primaryDark },
});
