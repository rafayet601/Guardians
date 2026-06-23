import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { Button, Text } from '@/components/ui';
import { colors, motion, palette, radius, spacing } from '@/theme';

const HERO_GRADIENT = [palette.green300, palette.green500, palette.green700] as const;

export default function WelcomeScreen() {
  const router = useRouter();

  // Signature moment: the emblem drifts gently, evoking the design's flowing hero.
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [float]);
  const floatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [5, -5]) },
      { scale: interpolate(float.value, [0, 1], [0.99, 1.01]) },
    ],
  }));
  const blobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(float.value, [0, 1], [-12, 12]) }],
  }));

  return (
    <View style={styles.flex}>
      {/* ── Flowing green hero ── */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={HERO_GRADIENT}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.hero}
        >
          <Animated.View style={[styles.blob, styles.blobA, blobStyle]} />
          <Animated.View style={[styles.blob, styles.blobB, blobStyle]} />
          <SafeAreaView edges={['top']} style={styles.heroSafe}>
            <Animated.View
              entering={FadeInDown.duration(motion.enter).springify().damping(motion.damping)}
            >
              <Animated.View style={[styles.emblem, floatStyle]}>
                <Text style={styles.emblemLetter}>G</Text>
              </Animated.View>
            </Animated.View>
          </SafeAreaView>
        </LinearGradient>
      </View>

      {/* ── Content ── */}
      <SafeAreaView edges={['bottom']} style={styles.content}>
        <Animated.View
          entering={FadeInDown.delay(motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
        >
          <Text variant="overline" color={colors.primary} style={styles.kicker}>
            Community Cat Rescue
          </Text>
          <Text variant="display" style={styles.headline}>
            Every cat deserves a Guardian
          </Text>
          <Text variant="body" muted style={styles.subtitle}>
            Spot a cat in need, rally your neighbourhood, and help them find a way home.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(2 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          style={styles.actions}
        >
          <Button title="Get started" size="lg" fullWidth onPress={() => router.push('/sign-up')} />
          <Button
            title="I already have an account"
            variant="surface"
            size="lg"
            fullWidth
            onPress={() => router.push('/sign-in')}
          />
          <PressableScale onPress={() => router.push('/sign-in')} style={styles.loginLink} hitSlop={8}>
            <Text variant="smallStrong" muted center>
              Already a Guardian?{'  '}
              <Text variant="smallStrong" color={colors.primary}>
                Log in
              </Text>
            </Text>
          </PressableScale>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  heroWrap: { flex: 1.15 },
  hero: {
    flex: 1,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  heroSafe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobA: {
    width: 320,
    height: 320,
    top: -90,
    right: -110,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  blobB: {
    width: 260,
    height: 260,
    bottom: -70,
    left: -90,
    backgroundColor: 'rgba(11,61,40,0.22)',
  },
  emblem: {
    width: 118,
    height: 118,
    borderRadius: 999,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.green900,
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  emblemLetter: {
    fontFamily: 'Nunito-Black',
    fontWeight: '900',
    fontSize: 56,
    color: colors.primary,
    marginTop: -4,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    justifyContent: 'space-between',
  },
  kicker: { marginBottom: spacing.sm },
  headline: { fontSize: 32, lineHeight: 37 },
  subtitle: { marginTop: spacing.md, maxWidth: 320 },
  actions: { gap: spacing.md },
  loginLink: { paddingVertical: spacing.xs },
});
