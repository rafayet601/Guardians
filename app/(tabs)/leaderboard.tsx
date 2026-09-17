import { Ionicons } from '@expo/vector-icons';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Card, EmptyState, Loading, PageHeader, Text } from '@/components/ui';
import { useLeaderboard } from '@/hooks/useGamification';
import { useAuth } from '@/providers/AuthProvider';
import { colors, layout, motion, palette, radius, spacing } from '@/theme';
import type { LeaderboardEntry } from '@/types/models';
import { compactNumber } from '@/utils/format';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data, isLoading, isError, isRefetching, refetch } = useLeaderboard();
  const reduced = useReducedMotion() ?? false;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <Animated.View
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(motion.enter).springify().damping(motion.damping)
        }
        style={styles.header}
      >
        <PageHeader
          eyebrow="Kindness adds up"
          title="Top Guardians"
          subtitle="Celebrating the people making a difference."
          icon="trophy-outline"
        />
      </Animated.View>

      {isLoading ? (
        <Loading label="Loading rankings…" />
      ) : isError && !data ? (
        <EmptyState
          title="Could not load rankings"
          message="Check your connection and try again."
          actionLabel={isRefetching ? 'Retrying…' : 'Try again'}
          onAction={isRefetching ? undefined : () => void refetch()}
        />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={11}
          removeClippedSubviews
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            data && data.length >= 3 ? <Podium entries={data.slice(0, 3)} /> : null
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

function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <View style={styles.podium}>
      <View style={styles.podiumHeading}>
        <Ionicons name="sparkles" size={16} color={colors.accentDark} />
        <Text variant="overline" color={colors.accentDark}>
          A little extra recognition
        </Text>
      </View>
      <View style={styles.podiumRow}>
        {[entries[1], entries[0], entries[2]].map((entry) => (
          <View key={entry.id} style={[styles.podiumPerson, entry.rank === 1 && styles.winner]}>
            {entry.rank === 1 && <Ionicons name="trophy" size={24} color={colors.accentDark} />}
            <View style={[styles.podiumAvatar, entry.rank === 1 && styles.winnerAvatar]}>
              <Avatar
                url={entry.avatar_url}
                name={entry.username}
                size={entry.rank === 1 ? 64 : 48}
              />
            </View>
            <Text variant="smallStrong" numberOfLines={1}>
              {entry.username}
            </Text>
            <Text variant="caption" color={colors.primary}>
              {compactNumber(entry.points)} pts
            </Text>
            <View style={[styles.podiumBase, entry.rank === 1 && styles.winnerBase]}>
              <Text variant="title" color={entry.rank === 1 ? colors.accentDark : colors.primary}>
                {String(entry.rank).padStart(2, '0')}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({ entry, index, isMe }: { entry: LeaderboardEntry; index: number; isMe: boolean }) {
  const medal = MEDALS[entry.rank];
  const isTop = entry.rank <= 3;
  const reduced = useReducedMotion() ?? false;
  return (
    <Animated.View
      entering={
        reduced
          ? undefined
          : FadeInDown.delay(Math.min(index, 8) * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)
      }
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
  podium: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: 0,
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  podiumHeading: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  podiumPerson: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.sm },
  winner: { gap: spacing.sm },
  podiumAvatar: {
    padding: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  winnerAvatar: { borderColor: colors.accent, borderWidth: 2 },
  podiumBase: {
    width: '100%',
    backgroundColor: colors.primarySoft,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  winnerBase: { backgroundColor: colors.accentSoft, paddingBottom: spacing.xxl },
  flex: { flex: 1, backgroundColor: colors.background },
  header: {},
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.bottomClearance,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.contentMax,
    alignSelf: 'center',
  },
  sep: { height: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTop: { borderColor: colors.accentSoft, backgroundColor: palette.amber100 },
  rowMe: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryTint },
  rank: { width: 28, alignItems: 'center' },
  info: { flex: 1, gap: 2 },
  points: { alignItems: 'center', minWidth: 48 },
});
