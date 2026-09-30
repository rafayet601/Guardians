import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { PressableScale } from '@/components/PressableScale';
import { SightingCard } from '@/components/SightingCard';
import { Button, Card, Loading, Screen, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { NEXT_STEP } from '@/constants/journey';
import { useMyProfile } from '@/hooks/useProfile';
import { useMyActivity } from '@/hooks/useSightings';
import { colors, motion, radius, spacing } from '@/theme';

export default function HomeScreen() {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const profile = useMyProfile();
  const activity = useMyActivity();
  const { refetch } = activity;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const name = profile.data?.full_name?.split(' ')[0] || profile.data?.username;
  const refresh = () => {
    void profile.refetch();
    void activity.refetch();
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={profile.isRefetching || activity.isRefetching}
          onRefresh={refresh}
          tintColor={colors.primaryDark}
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text variant="overline" color={colors.primaryDark}>
            Guardians · Community cat rescue
          </Text>
          <Text variant="title" style={styles.greeting}>
            {name ? `Welcome, ${name}` : 'Welcome, Guardian'}
          </Text>
        </View>
        <PressableScale
          onPress={() => router.push('/settings')}
          style={styles.settings}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Ionicons name="settings-outline" size={22} color={colors.primaryDark} />
        </PressableScale>
      </View>

      <Animated.View entering={reduced ? undefined : FadeInDown.duration(motion.enter)}>
        <LinearGradient colors={[colors.primaryDeep, colors.primaryDark]} style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroTag}>
              <Ionicons name="paw" size={14} color={colors.primaryDeep} />
              <Text variant="caption" color={colors.primaryDeep}>
                SMALL ACTS. SECOND CHANCES.
              </Text>
            </View>
            <Ionicons name="heart-outline" size={32} color={colors.primaryLight} />
          </View>
          <Text variant="display" color={colors.white}>
            A safer street.{'\n'}A way home.
          </Text>
          <Text variant="body" color={colors.white}>
            A sighting can start a rescue. You don’t have to do it alone.
          </Text>
          <Button
            title="I spotted a cat"
            variant="surface"
            fullWidth
            leftIcon={<Ionicons name="add-circle-outline" size={20} color={colors.primaryDeep} />}
            onPress={() => router.push('/report')}
          />
        </LinearGradient>
      </Animated.View>

      <View>
        <Text variant="heading">How will you help today?</Text>
        <Text variant="small" muted style={styles.sectionHint}>
          There’s a place for every kind of Guardian.
        </Text>
        <View style={styles.actions}>
          <Action
            icon="map-outline"
            title="Help nearby"
            body="Find cats waiting for a Guardian."
            onPress={() => router.push({ pathname: '/map', params: { filter: 'needs_help' } })}
          />
          <Action
            icon="home-outline"
            title="Give a home"
            body="Meet cats ready for their next chapter."
            onPress={() => router.push('/adopt')}
          />
        </View>
        {AI_FEATURES.lostCatReunion ? (
          <Button
            title="Looking for your lost cat?"
            variant="ghost"
            onPress={() => router.push('/lost-cat')}
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="heading">Your ongoing journeys</Text>
        <Text variant="small" muted>
          Your reports and the rescues you’ve claimed, together.
        </Text>
        {activity.isError && !!activity.data?.length ? (
          <Card style={styles.firstJourney}>
            <Text variant="small" muted>
              We couldn’t refresh your journeys. These are your last loaded reports.
            </Text>
            <Button title="Retry journeys" variant="outline" onPress={() => activity.refetch()} />
          </Card>
        ) : null}
        {activity.isLoading ? (
          <Loading label="Finding your journeys…" />
        ) : activity.isError && !activity.data?.length ? (
          <Card style={styles.firstJourney}>
            <Text variant="bodyStrong">Your journeys couldn’t refresh</Text>
            <Text variant="small" muted>
              Check your connection, then try again.
            </Text>
            <Button title="Retry journeys" variant="outline" onPress={() => activity.refetch()} />
          </Card>
        ) : !activity.data?.length ? (
          <Card style={styles.firstJourney}>
            <View style={styles.iconCircle}>
              <Ionicons name="paw-outline" size={26} color={colors.primaryDark} />
            </View>
            <Text variant="subheading">Your first small act starts here</Text>
            <Text variant="body" muted>
              Report a sighting or open the map to find a cat you can help. You’ll be able to follow
              the journey here.
            </Text>
            <Button
              title="Explore the rescue map"
              variant="outline"
              onPress={() => router.push('/map')}
            />
          </Card>
        ) : (
          activity.data.map((sighting) => (
            <View key={sighting.id} style={styles.journey}>
              <SightingCard
                title={sighting.title}
                status={sighting.status}
                temperament={sighting.temperament}
                thumbnailUrl={sighting.photos?.[0]?.url}
                needsUrgentHelp={sighting.needs_urgent_help}
                isInjured={sighting.is_injured}
                createdAt={sighting.updated_at}
                timeLabel="Updated"
                onPress={() => router.push(`/sighting/${sighting.id}`)}
              />
              <Text variant="small" muted style={styles.nextStep}>
                {NEXT_STEP[sighting.status]}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text variant="heading">From a sighting to a second chance</Text>
        <View style={styles.guide}>
          <Guide
            number="01"
            title="Spot & share"
            body="Add a photo, location, and what you observed. A clear report helps others act."
          />
          <Guide
            number="02"
            title="Rally & rescue"
            body="A Guardian claims the report and keeps everyone updated along the way."
          />
          <Guide
            number="03"
            title="Care & rehome"
            body="Once safe and ready, the cat can be matched with a loving home."
          />
        </View>
      </View>

      {profile.data ? (
        <Card style={styles.impact}>
          <Text variant="overline" color={colors.primaryDark}>
            Your kindness, in action
          </Text>
          <View style={styles.impactRow}>
            <Impact value={profile.data.reports_count} label="Reports" />
            <Impact value={profile.data.rescues_count} label="Rescues" />
            <Impact value={profile.data.adoptions_count} label="Adoptions" />
          </View>
          <Text variant="small" muted>
            Every contribution helps a cat get closer to care.
          </Text>
        </Card>
      ) : null}

      <View style={styles.safety}>
        <Ionicons name="shield-checkmark-outline" size={20} color={colors.primaryDark} />
        <Text variant="small" muted style={styles.flex}>
          Your safety matters too. Only take on help you can safely provide. Guardians connects
          neighbours; it isn’t an emergency response service.
        </Text>
      </View>
    </Screen>
  );
}

function Action({
  icon,
  title,
  body,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={24} color={colors.primaryDark} />
      </View>
      <Text variant="subheading">{title}</Text>
      <Text variant="small" muted>
        {body}
      </Text>
      <Ionicons name="arrow-forward" size={18} color={colors.primaryDark} />
    </PressableScale>
  );
}
function Guide({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <View style={styles.guideRow}>
      <Text variant="mono" color={colors.primaryDark} style={styles.guideNumber}>
        {number}
      </Text>
      <View style={styles.flex}>
        <Text variant="subheading">{title}</Text>
        <Text variant="small" muted>
          {body}
        </Text>
      </View>
    </View>
  );
}
function Impact({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.flex}>
      <Text variant="title" color={colors.primaryDeep}>
        {value}
      </Text>
      <Text variant="small" muted>
        {label}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: spacing.lg, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  greeting: { marginTop: spacing.sm },
  settings: { padding: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface },
  hero: { padding: spacing.xl, borderRadius: radius.xl, gap: spacing.lg },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    padding: spacing.sm,
    borderRadius: radius.pill,
  },
  sectionHint: { marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, flexWrap: 'wrap' },
  action: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  iconCircle: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryTint,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  section: { gap: spacing.md },
  firstJourney: { gap: spacing.md },
  journey: { gap: spacing.sm },
  nextStep: { paddingHorizontal: spacing.sm },
  guide: {
    gap: spacing.lg,
    backgroundColor: colors.cream,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  guideRow: { flexDirection: 'row', gap: spacing.lg },
  guideNumber: { paddingTop: spacing.xs },
  impact: { gap: spacing.lg },
  impactRow: { flexDirection: 'row', gap: spacing.lg },
  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
});
