import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LevelProgress } from '@/components/LevelProgress';
import { PressableScale } from '@/components/PressableScale';
import { StatusPill } from '@/components/StatusPill';
import { Avatar, Button, Card, Loading, Pill, Text } from '@/components/ui';
import { useAllBadges, useUserBadges } from '@/hooks/useGamification';
import { useCountUp } from '@/hooks/useCountUp';
import { useMyProfile } from '@/hooks/useProfile';
import { useMySightings } from '@/hooks/useSightings';
import { colors, motion, radius, spacing } from '@/theme';
import { compactNumber } from '@/utils/format';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: profile, isLoading, isRefetching, refetch } = useMyProfile();
  const { data: allBadges = [] } = useAllBadges();
  const { data: earned = [] } = useUserBadges(profile?.id);
  const { data: sightings = [] } = useMySightings();

  if (isLoading || !profile) return <Loading label="Loading your profile…" />;

  const earnedIds = new Set(earned.map((b) => b.badge_id));

  return (
    <ScrollView
      style={[styles.flex, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
      }
    >
      {/* Header */}
      <Animated.View
        entering={FadeInDown.delay(0).duration(motion.enter).springify().damping(motion.damping)}
      >
        <View style={styles.headerRow}>
          <Avatar url={profile.avatar_url} name={profile.username} size={72} />
          <View style={styles.headerInfo}>
            <Text variant="title" numberOfLines={1}>
              {profile.username}
            </Text>
            {profile.full_name ? (
              <Text variant="small" muted>
                {profile.full_name}
              </Text>
            ) : null}
            <View style={styles.roleRow}>
              {profile.is_guardian ? <Pill label="🦸 Guardian" fg={colors.primary} bg={colors.primarySoft} /> : null}
              {profile.wants_to_adopt ? <Pill label="🏠 Adopter" fg={colors.accentDark} bg={colors.accentSoft} /> : null}
            </View>
          </View>
          <PressableScale onPress={() => router.push('/settings')} hitSlop={10} style={styles.gear} scaleTo={0.88}>
            <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
          </PressableScale>
        </View>

        {profile.bio ? (
          <Text variant="body" style={styles.bio}>
            {profile.bio}
          </Text>
        ) : null}
      </Animated.View>

      {/* Level */}
      <Animated.View
        entering={FadeInDown.delay(1 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
      >
        <Card style={styles.section}>
          <LevelProgress points={profile.points} />
        </Card>
      </Animated.View>

      {/* Kibble wallet */}
      <Animated.View
        entering={FadeInDown.delay(2 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
      >
        <Card style={styles.kibbleCard}>
          <View style={styles.kibbleInfo}>
            <Text variant="caption" muted>
              SPENDABLE KIBBLE
            </Text>
            <KibbleBalance balance={profile.kibble_balance} />
            <Text variant="caption" muted>
              Redeem for brand perks — your rank stays put.
            </Text>
          </View>
          <Button title="Redeem" size="sm" onPress={() => router.push('/rewards')} />
        </Card>
      </Animated.View>

      {/* Stats */}
      <Animated.View
        entering={FadeInDown.delay(3 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
        style={styles.statsRow}
      >
        <Stat label="Reports" value={profile.reports_count} icon="👀" />
        <Stat label="Rescues" value={profile.rescues_count} icon="🦸" />
        <Stat label="Rehomed" value={profile.adoptions_count} icon="🏠" />
      </Animated.View>

      {/* Badges */}
      <Animated.View
        entering={FadeInDown.delay(4 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
      >
        <Text variant="heading" style={styles.sectionTitle}>
          Badges
        </Text>
        <View style={styles.badgeGrid}>
          {allBadges.map((b, i) => {
            const has = earnedIds.has(b.id);
            return (
              <Animated.View
                key={b.id}
                entering={ZoomIn.delay(Math.min(i, 8) * (motion.stagger / 2)).duration(motion.enter).springify().damping(motion.damping)}
                style={[styles.badge, !has && styles.badgeLocked]}
              >
                <Text style={styles.badgeIcon}>{has ? b.icon : '🔒'}</Text>
                <Text variant="caption" center numberOfLines={2} color={has ? colors.text : colors.textMuted}>
                  {b.name}
                </Text>
              </Animated.View>
            );
          })}
        </View>
      </Animated.View>

      {/* My sightings */}
      <Animated.View
        entering={FadeInDown.delay(5 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
      >
        <Text variant="heading" style={styles.sectionTitle}>
          My reports ({sightings.length})
        </Text>
        {sightings.length === 0 ? (
          <Text variant="small" muted style={styles.empty}>
            You haven't reported any cats yet. Tap the + button to add one!
          </Text>
        ) : (
          <View style={styles.mineList}>
            {sightings.slice(0, 8).map((s) => (
              <Card key={s.id} onPress={() => router.push(`/sighting/${s.id}`)} style={styles.mineRow}>
                <View style={styles.mineInfo}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {s.title?.trim() || 'Cat sighting'}
                  </Text>
                  <StatusPill status={s.status} />
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Card>
            ))}
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}

function KibbleBalance({ balance }: { balance: number }) {
  const shown = useCountUp(balance);
  return <Text variant="title">🐟 {compactNumber(shown)}</Text>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text variant="title">{value}</Text>
      <Text variant="caption" muted>
        {label.toUpperCase()}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerInfo: { flex: 1, gap: 4 },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap' },
  gear: { padding: spacing.xs },
  bio: { marginTop: spacing.sm },
  section: {},
  kibbleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  kibbleInfo: { flex: 1, gap: 2 },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.lg },
  statIcon: { fontSize: 22 },
  sectionTitle: { marginBottom: spacing.sm },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    width: '23%',
    aspectRatio: 0.85,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
    gap: 4,
  },
  badgeLocked: { backgroundColor: colors.divider, borderColor: 'transparent' },
  badgeIcon: { fontSize: 26 },
  empty: { paddingVertical: spacing.md },
  mineList: { gap: spacing.sm },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mineInfo: { flex: 1, gap: spacing.xs },
});
