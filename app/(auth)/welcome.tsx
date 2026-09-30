import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { BrandMark, Button, Text } from '@/components/ui';
import { colors, layout, radius, shadow, spacing, typography } from '@/theme';

const STEPS = [
  { icon: 'scan-outline', title: 'Spot', description: 'Share a sighting' },
  { icon: 'heart-outline', title: 'Care', description: 'Lend a little help' },
  { icon: 'home-outline', title: 'Connect', description: 'Find a loving home' },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= layout.wideBreakpoint;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.nav}>
          <BrandMark />
          <View style={styles.navTag}>
            <Ionicons name="heart" size={13} color={colors.primary} />
            <Text variant="smallStrong" color={colors.primary}>
              Small acts. Big love.
            </Text>
          </View>
        </View>
        <View style={[styles.main, wide && styles.mainWide]}>
          <View style={[styles.artPanel, wide && styles.artWide]}>
            <Image
              source={require('../../assets/illustrations/guardian-garden.webp')}
              style={styles.art}
              contentFit="cover"
              accessibilityLabel="Three cats in a lush green garden outside a welcoming home"
            />
            <View style={styles.artCaption}>
              <View style={styles.heart}>
                <Ionicons name="heart" size={20} color={colors.primary} />
              </View>
              <View style={styles.captionCopy}>
                <Text variant="smallStrong" color={colors.primaryDeep}>
                  A little kindness goes a long way.
                </Text>
                <Text variant="caption" muted>
                  For the cats who need us most.
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.content, wide && styles.contentWide]}>
            <Text variant="overline" color={colors.primary}>
              Your neighbourhood. Their safe place.
            </Text>
            <Text
              variant="display"
              style={[styles.headline, wide && styles.headlineWide]}
              accessibilityRole="header"
            >
              Every cat deserves{'\n'}a{' '}
              <Text
                variant="display"
                style={[styles.headline, wide && styles.headlineWide]}
                color={colors.primary}
              >
                Guardian.
              </Text>
            </Text>
            <Text muted style={styles.subtitle}>
              A kinder world for cats starts with us. Spot a cat in need, bring your community
              together, and help them find a way home.
            </Text>
            <View style={styles.steps}>
              {STEPS.map((step) => (
                <View key={step.title} style={styles.step}>
                  <View style={styles.stepIcon}>
                    <Ionicons name={step.icon} size={22} color={colors.primary} />
                  </View>
                  <Text variant="smallStrong">{step.title}</Text>
                  <Text variant="caption" muted center>
                    {step.description}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <Button
                title="Join Guardians"
                size="lg"
                fullWidth
                onPress={() => router.push('/sign-up')}
                leftIcon={<Ionicons name="paw" size={18} color={colors.white} />}
              />
              <Button
                title="I already have an account"
                variant="surface"
                size="lg"
                fullWidth
                onPress={() => router.push('/sign-in')}
              />
              <Text variant="small" muted center>
                No rescue experience needed. Just a little heart.
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.footer}>
          <Text variant="caption" muted>
            Made for people who care.
          </Text>
          <View style={styles.legal}>
            <PressableScale
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              style={styles.legalLink}
            >
              <Text variant="smallStrong" muted>
                Privacy
              </Text>
            </PressableScale>
            <PressableScale
              onPress={() => router.push('/terms')}
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
              style={styles.legalLink}
            >
              <Text variant="smallStrong" muted>
                Terms
              </Text>
            </PressableScale>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.welcomeMax,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  navTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  main: { flex: 1, justifyContent: 'center', gap: spacing.xxl },
  mainWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.section,
    paddingVertical: spacing.xxl,
  },
  artPanel: {
    width: '100%',
    aspectRatio: 1.45,
    borderRadius: radius.hero,
    overflow: 'hidden',
    backgroundColor: colors.primarySoft,
  },
  artWide: { flex: 1, aspectRatio: 0.85, maxHeight: 620 },
  art: { width: '100%', height: '100%' },
  artCaption: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  captionCopy: { flex: 1, gap: spacing.xs },
  heart: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { gap: spacing.md },
  contentWide: { flex: 1 },
  headline: typography.hero,
  headlineWide: typography.heroWide,
  subtitle: { lineHeight: 23 },
  steps: { flexDirection: 'row', paddingVertical: spacing.lg, gap: spacing.sm },
  step: { flex: 1, alignItems: 'center', gap: spacing.xs },
  stepIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  actions: { gap: spacing.md },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  legal: { flexDirection: 'row', gap: spacing.lg },
  legalLink: { minHeight: layout.touchTarget, justifyContent: 'center' },
});
