import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkEligibility } from '@/api/rewards';
import { PressableScale } from '@/components/PressableScale';
import { SponsoredCard } from '@/components/SponsoredCard';
import { EmptyState, Loading, Pill, Text } from '@/components/ui';
import { useUserBadges } from '@/hooks/useGamification';
import { useCountUp } from '@/hooks/useCountUp';
import { useMyProfile } from '@/hooks/useProfile';
import { useOffers } from '@/hooks/useRewards';
import { colors, palette, radius, shadow, spacing } from '@/theme';
import { compactNumber } from '@/utils/format';
import type { RewardOffer } from '@/types/models';

export const KIBBLE = '🐟';

const WALLET_GRADIENT = [palette.green900, palette.green700, palette.green500] as const;
const SHIMMER_GRADIENT = ['rgba(255,255,255,0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0)'] as const;

export default function RewardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: profile } = useMyProfile();
  const { data: earned = [] } = useUserBadges(profile?.id);
  const { data: offers, isLoading, isRefetching, refetch } = useOffers();

  const earnedIds = new Set(earned.map((b) => b.badge_id));

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="title">Rewards</Text>
        <Text variant="small" muted>
          Spend your Kibble on perks from pet-friendly brands.
        </Text>
      </View>

      {isLoading ? (
        <Loading label="Loading rewards…" />
      ) : (
        <FlatList
          data={offers ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <WalletHero
                balance={profile?.kibble_balance ?? 0}
                points={profile?.points ?? 0}
                onMyRewards={() => router.push('/rewards/redemptions')}
              />
              <SponsoredCard slot="rewards_banner" />
              <Text variant="heading" style={styles.sectionTitle}>
                Available rewards
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="🎁"
              title="No rewards yet"
              message="Check back soon — we're lining up brand partners."
            />
          }
          renderItem={({ item, index }) => (
            <OfferRow
              offer={item}
              index={index}
              eligibility={checkEligibility(item, profile, earnedIds)}
              onPress={() => router.push(`/rewards/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function WalletHero({
  balance,
  points,
  onMyRewards,
}: {
  balance: number;
  points: number;
  onMyRewards: () => void;
}) {
  const shown = useCountUp(balance);
  const shimmer = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.ease) }), -1, false);
    bob.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [shimmer, bob]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(shimmer.value, [0, 1], [-280, 380]) }, { rotate: '18deg' }],
  }));
  const bobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(bob.value, [0, 1], [2, -10]) },
      { rotate: `${interpolate(bob.value, [0, 1], [-7, 7])}deg` },
    ],
  }));

  return (
    <Animated.View entering={FadeInDown.duration(520).springify().damping(15)} style={styles.heroShadow}>
      <View style={styles.hero}>
        <LinearGradient
          colors={WALLET_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* floating fish motif */}
        <Animated.Text style={[styles.heroMotif, bobStyle]}>🐟</Animated.Text>
        {/* shimmer sweep */}
        <Animated.View style={[styles.shimmer, shimmerStyle]}>
          <LinearGradient
            colors={SHIMMER_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <View style={styles.heroContent}>
          <View style={styles.heroTop}>
            <Text variant="caption" color={colors.primarySoft}>
              YOUR KIBBLE
            </Text>
            <PressableScale onPress={onMyRewards} style={styles.myRewards} scaleTo={0.92}>
              <Ionicons name="ticket-outline" size={14} color={colors.white} />
              <Text variant="caption" color={colors.white}>
                MY REWARDS
              </Text>
            </PressableScale>
          </View>

          <Text variant="display" color={colors.white} style={styles.balance}>
            {KIBBLE} {shown.toLocaleString()}
          </Text>

          <Text variant="small" color={palette.green100}>
            Earned alongside your {compactNumber(points)} rank points — spending Kibble never
            lowers your rank.
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function OfferRow({
  offer,
  index,
  eligibility,
  onPress,
}: {
  offer: RewardOffer;
  index: number;
  eligibility: { ok: boolean; reason?: string };
  onPress: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 55).duration(440).springify().damping(16)}>
      <PressableScale onPress={onPress} style={styles.offer}>
        <View style={[styles.thumb, !eligibility.ok && styles.dim]}>
          {offer.image_url ? (
            <Image source={{ uri: offer.image_url }} style={styles.thumbImg} contentFit="cover" />
          ) : (
            <LinearGradient colors={[palette.green100, palette.green50]} style={StyleSheet.absoluteFill} />
          )}
          {!offer.image_url ? <Text style={styles.thumbEmoji}>🎁</Text> : null}
        </View>

        <View style={[styles.offerBody, !eligibility.ok && styles.dim]}>
          <Text variant="caption" muted numberOfLines={1}>
            {offer.brand?.name?.toUpperCase() ?? 'PARTNER'}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2}>
            {offer.title}
          </Text>
          <View style={styles.offerMeta}>
            <Pill label={`${KIBBLE} ${offer.cost_kibble}`} fg={colors.primary} bg={colors.primarySoft} />
            {offer.discount_label ? (
              <Pill label={offer.discount_label} fg={colors.accentDark} bg={colors.accentSoft} />
            ) : null}
          </View>
        </View>

        {eligibility.ok ? (
          <View style={styles.chevron}>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        ) : (
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
            <Text variant="caption" muted center numberOfLines={2} style={styles.lockText}>
              {eligibility.reason}
            </Text>
          </View>
        )}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 2 },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  headerBlock: { gap: spacing.md, marginBottom: spacing.md },

  // wallet hero
  heroShadow: { borderRadius: radius.xl, ...shadow.floating },
  hero: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    minHeight: 156,
    justifyContent: 'center',
  },
  heroContent: { padding: spacing.xl, gap: spacing.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroMotif: { position: 'absolute', right: -8, top: -14, fontSize: 130, opacity: 0.12 },
  shimmer: { position: 'absolute', top: -40, bottom: -40, width: 90 },
  myRewards: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  balance: { marginTop: spacing.xs, letterSpacing: -0.5 },

  sectionTitle: { marginTop: spacing.xs },
  sep: { height: spacing.md },

  // offer rows
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  thumb: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbEmoji: { fontSize: 26 },
  offerBody: { flex: 1, gap: 4 },
  offerMeta: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: 2 },
  dim: { opacity: 0.55 },
  chevron: { width: 28, alignItems: 'flex-end' },
  lock: { width: 74, alignItems: 'center', gap: 2 },
  lockText: { lineHeight: 13 },
});
