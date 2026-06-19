import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Card, EmptyState, Loading, Text } from '@/components/ui';
import { useLeaderboard } from '@/hooks/useGamification';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, palette, radius, spacing } from '@/theme';
import type { LeaderboardEntry } from '@/types/models';
import { compactNumber } from '@/utils/format';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data, isLoading, isRefetching, refetch } = useLeaderboard();

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <Animated.View
        entering={FadeInDown.duration(motion.enter).springify().damping(motion.damping)}
        style={styles.header}
      >
        <Text variant="title">🏆 Top Guardians</Text>
        <Text variant="small" muted>
          Every rescue, report and adoption earns points.
        </Text>
      </Animated.View>

      {isLoading ? (
        <Loading label="Loading rankings…" />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState icon="🏆" title="No rankings yet" message="Be the first to earn points!" />
          }
          renderItem={({ item, index }) => (
            <Row entry={item} index={index} isMe={item.id === user?.id} />
          )}
        />
      )}
    </View>
  );
}

function Row({ entry, index, isMe }: { entry: LeaderboardEntry; index: number; isMe: boolean }) {
  const medal = MEDALS[entry.rank];
  const isTop = entry.rank <= 3;
  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * motion.stagger)
        .duration(motion.enter)
        .springify()
        .damping(motion.damping)}
    >
      <Card padded style={[styles.row, isTop && !isMe && styles.rowTop, isMe && styles.rowMe]}>
        <View style={styles.rank}>
          <Text variant="subheading" color={isMe ? colors.primary : colors.textSecondary}>
            {medal ?? entry.rank}
          </Text>
        </View>
        <Avatar url={entry.avatar_url} name={entry.username} size={44} />
        <View style={styles.info}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {entry.username}
            {isMe ? '  (you)' : ''}
          </Text>
          <Text variant="small" muted>
            Lvl {entry.level} · {entry.rescues_count} rescues
          </Text>
        </View>
        <View style={styles.points}>
          <Text variant="subheading" color={colors.primary}>
            {compactNumber(entry.points)}
          </Text>
          <Text variant="caption" muted>
            PTS
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 2 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
  sep: { height: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTop: { borderColor: colors.accentSoft, backgroundColor: palette.amber100 },
  rowMe: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryTint },
  rank: { width: 28, alignItems: 'center' },
  info: { flex: 1, gap: 2 },
  points: { alignItems: 'center', minWidth: 48 },
});
