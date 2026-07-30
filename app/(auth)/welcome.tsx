import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { Button, Text } from '@/components/ui';
import { colors, motion, palette, radius, spacing } from '@/theme';

// Deep emerald → rescue green base the aurora orbs drift over.
const BASE_GRADIENT = [palette.green900, palette.green700, palette.green500] as const;

/**
 * Soft, drifting color orbs that together read as a flowing mesh-gradient
 * "shader" behind the hero. Each orb is a rounded, clipped LinearGradient that
 * fades to its own hue at zero alpha (so edges feather instead of hard-cutting),
 * animated on an independent slow loop so the field never visibly repeats.
 * Pure Reanimated + expo-linear-gradient — no native shader dependency, and it
 * renders identically on web (the dev preview) and native.
 */
type Orb = {
  colors: readonly [string, string];
  box: ViewStyle;
  dur: number;
  delay: number;
  drift: { x: number; y: number };
  rotate: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

const ORBS: Orb[] = [
  {
    colors: ['rgba(244,169,60,0.42)', 'rgba(244,169,60,0)'], // honey, top-right
    box: { width: 360, height: 360, top: -120, right: -90 },
    dur: 7200,
    delay: 0,
    drift: { x: 26, y: 20 },
    rotate: 18,
    start: { x: 0.2, y: 0 },
    end: { x: 1, y: 1 },
  },
  {
    colors: ['rgba(176,232,206,0.55)', 'rgba(176,232,206,0)'], // mint, bottom-left
    box: { width: 420, height: 380, bottom: -150, left: -120 },
    dur: 9000,
    delay: 600,
    drift: { x: 30, y: 26 },
    rotate: 14,
    start: { x: 0, y: 1 },
    end: { x: 1, y: 0 },
  },
  {
    colors: ['rgba(45,200,130,0.5)', 'rgba(45,200,130,0)'], // emerald glow, center
    box: { width: 300, height: 300, top: '34%', left: '24%' },
    dur: 6200,
    delay: 1200,
    drift: { x: 22, y: 18 },
    rotate: 22,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  {
    colors: ['rgba(8,48,32,0.45)', 'rgba(8,48,32,0)'], // deep shadow, top-left
    box: { width: 340, height: 340, top: -90, left: -130 },
    dur: 8200,
    delay: 300,
    drift: { x: 24, y: 20 },
    rotate: 16,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
];

function AuroraOrb({ orb, reduced }: { orb: Orb; reduced: boolean }) {
  const t = useSharedValue(0.5);

  useEffect(() => {
    if (reduced) {
      t.value = 0.5;
      return;
    }
    t.value = withDelay(
      orb.delay,
      withRepeat(withTiming(1, { duration: orb.dur, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [reduced, orb.delay, orb.dur, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [-orb.drift.x, orb.drift.x]) },
      { translateY: interpolate(t.value, [0, 1], [-orb.drift.y, orb.drift.y]) },
      { scale: interpolate(t.value, [0, 1], [0.92, 1.16]) },
      { rotate: `${interpolate(t.value, [0, 1], [-orb.rotate, orb.rotate])}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.orb, orb.box, style]}>
      <LinearGradient
        colors={orb.colors}
        start={orb.start}
        end={orb.end}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;

  // Signature moment: the emblem drifts gently above the aurora.
  const float = useSharedValue(0.5);
  useEffect(() => {
    if (reduced) {
      float.value = 0.5;
      return;
    }
    float.value = withRepeat(
      withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduced, float]);
  const floatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(float.value, [0, 1], [6, -6]) },
      { scale: interpolate(float.value, [0, 1], [0.99, 1.02]) },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(float.value, [0, 1], [0.35, 0.6]),
    transform: [{ scale: interpolate(float.value, [0, 1], [1, 1.12]) }],
  }));

  return (
    <View style={styles.flex}>
      {/* ── Aurora hero ── */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={BASE_GRADIENT}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.hero}
        >
          {/* drifting mesh-gradient orbs */}
          {ORBS.map((orb, i) => (
            <AuroraOrb key={i} orb={orb} reduced={reduced} />
          ))}

          {/* top sheen for depth */}
          <LinearGradient
            colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.6 }}
            style={[StyleSheet.absoluteFill, styles.noEvents]}
          />

          <SafeAreaView edges={['top']} style={styles.heroSafe}>
            <Animated.View
              entering={
                reduced
                  ? undefined
                  : FadeInDown.duration(motion.enter).springify().damping(motion.damping)
              }
            >
              <Animated.View style={styles.emblemWrap}>
                <Animated.View style={[styles.halo, haloStyle]} />
                <Animated.View style={[styles.emblem, floatStyle]}>
                  <Text style={styles.emblemLetter}>G</Text>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </SafeAreaView>
        </LinearGradient>
      </View>

      {/* ── Content ── */}
      <SafeAreaView edges={['bottom']} style={styles.content}>
        <Animated.View
          entering={
            reduced
              ? undefined
              : FadeInDown.delay(motion.stagger)
                  .duration(motion.enter)
                  .springify()
                  .damping(motion.damping)
          }
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
          entering={
            reduced
              ? undefined
              : FadeInDown.delay(2 * motion.stagger)
                  .duration(motion.enter)
                  .springify()
                  .damping(motion.damping)
          }
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
          <PressableScale
            onPress={() => router.push('/sign-in')}
            style={styles.loginLink}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Log in"
          >
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
  orb: { position: 'absolute', borderRadius: 999, overflow: 'hidden', pointerEvents: 'none' },
  noEvents: { pointerEvents: 'none' },
  heroSafe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emblemWrap: { alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.5)',
    pointerEvents: 'none',
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
