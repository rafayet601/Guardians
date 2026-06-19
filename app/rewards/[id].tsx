import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { checkEligibility } from '@/api/rewards';
import { RewardBurst } from '@/components/RewardBurst';
import { Button, Card, Loading, Pill, Text } from '@/components/ui';
import { useUserBadges } from '@/hooks/useGamification';
import { useMyProfile } from '@/hooks/useProfile';
import { useOffers, useRedeemReward } from '@/hooks/useRewards';
import { confirmAsync, notify } from '@/lib/dialog';
import { colors, palette, radius, shadow, spacing } from '@/theme';
import { compactNumber } from '@/utils/format';
import type { RewardRedemption } from '@/types/models';

const KIBBLE = '🐟';

function celebrate() {
  if (Platform.OS !== 'web')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
function tapFeedback() {
  if (Platform.OS !== 'web')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export default function OfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: offers, isLoading } = useOffers();
  const { data: profile } = useMyProfile();
  const { data: earned = [] } = useUserBadges(profile?.id);
  const redeem = useRedeemReward();

  const [redeemed, setRedeemed] = useState<RewardRedemption | null>(null);

  if (isLoading) return <Loading label="Loading…" />;

  const offer = offers?.find((o) => o.id === id);
  if (!offer) {
    return (
      <View style={styles.centered}>
        <Text variant="heading">Reward unavailable</Text>
        <Text variant="small" muted>
          This reward may have ended.
        </Text>
      </View>
    );
  }

  const earnedIds = new Set(earned.map((b) => b.badge_id));
  const eligibility = checkEligibility(offer, profile, earnedIds);

  const onRedeem = async () => {
    tapFeedback();
    const ok = await confirmAsync({
      title: `Redeem for ${KIBBLE} ${offer.cost_kibble}?`,
      message: `This spends ${offer.cost_kibble} Kibble. Your rank points are not affected.`,
      confirmLabel: 'Redeem',
    });
    if (!ok) return;
    redeem.mutate(offer.id, {
      onSuccess: (r) => {
        celebrate();
        setRedeemed(r);
      },
      onError: (e) => notify('Could not redeem', e instanceof Error ? e.message : 'Please try again.'),
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {offer.image_url ? (
        <Image source={{ uri: offer.image_url }} style={styles.hero} contentFit="cover" />
      ) : (
        <View style={styles.hero}>
          <LinearGradient
            colors={[palette.green700, palette.green500]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.heroEmoji}>🎁</Text>
        </View>
      )}

      <Animated.View entering={FadeInDown.duration(460).springify().damping(16)} style={styles.body}>
        <Text variant="caption" muted>
          {offer.brand?.name?.toUpperCase() ?? 'PARTNER'}
        </Text>
        <Text variant="title">{offer.title}</Text>

        <View style={styles.metaRow}>
          <Pill label={`${KIBBLE} ${offer.cost_kibble} Kibble`} fg={colors.primary} bg={colors.primarySoft} />
          {offer.discount_label ? (
            <Pill label={offer.discount_label} fg={colors.accentDark} bg={colors.accentSoft} />
          ) : null}
          {offer.required_badge_id ? (
            <Pill label="🏅 Tier perk" fg={colors.textSecondary} bg={colors.divider} />
          ) : null}
        </View>

        {offer.description ? (
          <Text variant="body" style={styles.desc}>
            {offer.description}
          </Text>
        ) : null}

        {offer.brand?.blurb ? (
          <Card style={styles.section}>
            <Text variant="smallStrong">About {offer.brand.name}</Text>
            <Text variant="small" muted>
              {offer.brand.blurb}
            </Text>
          </Card>
        ) : null}

        {redeemed ? (
          <Animated.View
            entering={ZoomIn.springify().damping(12).stiffness(150)}
            style={styles.ticketWrap}
          >
            <RewardBurst />
            <View style={styles.ticket}>
              <View style={styles.ticketTop}>
                <Text variant="caption" color={colors.primary}>
                  REDEEMED 🎉
                </Text>
                <Text variant="small" muted center>
                  {offer.discount_label ?? 'Your reward'} · {offer.brand?.name ?? 'Partner'}
                </Text>
              </View>

              <View style={styles.perforation}>
                <View style={[styles.notch, styles.notchLeft]} />
                <View style={styles.dash} />
                <View style={[styles.notch, styles.notchRight]} />
              </View>

              <View style={styles.ticketBottom}>
                <Text variant="caption" muted>
                  CODE
                </Text>
                <Text variant="title" color={colors.primary} style={styles.code}>
                  {redeemed.code}
                </Text>
                <Text variant="caption" muted center>
                  Show this at checkout · saved under “My rewards”
                </Text>
              </View>

              <Button
                title="View my rewards"
                variant="outline"
                onPress={() => router.replace('/rewards/redemptions')}
                style={styles.ticketBtn}
              />
            </View>
          </Animated.View>
        ) : (
          <View style={styles.actions}>
            <Text variant="small" muted center>
              Balance: {KIBBLE} {compactNumber(profile?.kibble_balance ?? 0)}
            </Text>
            {eligibility.ok ? (
              <Button
                title={`Redeem for ${KIBBLE} ${offer.cost_kibble}`}
                size="lg"
                fullWidth
                loading={redeem.isPending}
                onPress={onRedeem}
              />
            ) : (
              <Button
                title={eligibility.reason ?? 'Locked'}
                size="lg"
                fullWidth
                disabled
                leftIcon={<Ionicons name="lock-closed" size={16} color={colors.textInverse} />}
              />
            )}
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  content: { paddingBottom: spacing.xxxl },
  hero: { width: '100%', height: 220, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 88 },
  body: { padding: spacing.lg, gap: spacing.sm },
  metaRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  desc: { marginTop: spacing.xs },
  section: { gap: spacing.xs, marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.lg },

  // celebratory ticket
  ticketWrap: { marginTop: spacing.lg },
  ticket: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  ticketTop: { alignItems: 'center', gap: 2 },
  perforation: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.xs },
  dash: {
    flex: 1,
    borderBottomWidth: 1.5,
    borderColor: colors.primarySoft,
    borderStyle: 'dashed',
  },
  notch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.background,
  },
  notchLeft: { marginLeft: -spacing.lg - 9 },
  notchRight: { marginRight: -spacing.lg - 9 },
  ticketBottom: { alignItems: 'center', gap: 2 },
  code: { letterSpacing: 2, marginVertical: 2 },
  ticketBtn: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
