import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Card, EmptyState, Loading, Pill, Text } from '@/components/ui';
import { useMyRedemptions } from '@/hooks/useRewards';
import { colors, radius, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';
import type { RewardRedemption } from '@/types/models';

const KIBBLE = '🐟';

const STATUS_STYLE: Record<RewardRedemption['status'], { label: string; fg: string; bg: string }> =
  {
    active: { label: 'Active', fg: colors.primary, bg: colors.primarySoft },
    used: { label: 'Used', fg: colors.textSecondary, bg: colors.divider },
    expired: { label: 'Expired', fg: colors.danger, bg: colors.accentSoft },
  };

export default function RedemptionsScreen() {
  const { data: redemptions, isLoading } = useMyRedemptions();

  const reduced = useReducedMotion() ?? false;

  if (isLoading) return <Loading label="Loading your rewards…" />;

  return (
    <FlatList
      data={redemptions ?? []}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={
        <EmptyState
          icon="🎟️"
          title="No rewards yet"
          message="Redeem your Kibble in the Rewards tab and your discount codes will appear here."
        />
      }
      renderItem={({ item, index }) => {
        const status = STATUS_STYLE[item.status];
        return (
          <Animated.View
            entering={
              reduced
                ? FadeInDown.duration(0)
                : FadeInDown.delay(index * 55)
                    .duration(420)
                    .springify()
                    .damping(16)
            }
          >
            <Card style={styles.row}>
              <View style={styles.rowTop}>
                <View style={styles.flex}>
                  <Text variant="caption" muted numberOfLines={1}>
                    {item.offer?.brand?.name?.toUpperCase() ?? 'PARTNER'}
                  </Text>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {item.offer?.title ?? 'Reward'}
                  </Text>
                </View>
                <Pill label={status.label} fg={status.fg} bg={status.bg} />
              </View>

              <View style={styles.codeBox}>
                <Text variant="caption" muted>
                  CODE
                </Text>
                <Text variant="heading" color={colors.primary} style={styles.code}>
                  {item.code}
                </Text>
              </View>

              <Text variant="caption" muted>
                Redeemed {timeAgo(item.redeemed_at)} · {KIBBLE} {item.cost_kibble}
                {item.expires_at ? ` · expires ${timeAgo(item.expires_at)}` : ''}
              </Text>
            </Card>
          </Animated.View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, flexGrow: 1 },
  sep: { height: spacing.md },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  codeBox: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    borderStyle: 'dashed',
  },
  code: { letterSpacing: 1.5 },
});
