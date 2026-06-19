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
import { colors, motion, palette, spacing } from '@/theme';

const GRADIENT = [palette.green700, palette.green900] as const;

export default function WelcomeScreen() {
  const router = useRouter();

  // Signature moment: a gentle, slow float on the paw logo.
  const float = useSharedValue(0);
  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [float]);
  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(float.value, [0, 1], [4, -4]) }],
  }));

  return (
    <LinearGradient colors={GRADIENT} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.hero}>
          <Animated.Text
            entering={FadeInDown.duration(motion.enter).springify().damping(motion.damping)}
            style={[styles.logo, floatStyle]}
          >
            🐾
          </Animated.Text>
          <Animated.View
            entering={FadeInDown.delay(motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)}
          >
            <Text variant="display" color={colors.white} center>
              Guardians
            </Text>
          </Animated.View>
          <Animated.View
            entering={FadeInDown.delay(2 * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)}
          >
            <Text variant="subheading" color={palette.green100} center style={styles.tagline}>
              Spot. Rescue. Rehome.{'\n'}A community for feral & lost cats.
            </Text>
          </Animated.View>
        </View>

        <View style={styles.features}>
          <Feature icon="📍" text="Map every cat that needs help" index={3} />
          <Feature icon="🦸" text="Guardians answer the call to rescue" index={4} />
          <Feature icon="🏠" text="Adopters give them a forever home" index={5} />
        </View>

        <Animated.View
          entering={FadeInDown.delay(6 * motion.stagger)
            .duration(motion.enter)
            .springify()
            .damping(motion.damping)}
          style={styles.actions}
        >
          <Button
            title="Get started"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => router.push('/sign-up')}
          />
          <PressableScale
            onPress={() => router.push('/sign-in')}
            style={styles.signInLink}
            hitSlop={8}
          >
            <Text variant="bodyStrong" color={colors.white} center>
              I already have an account
            </Text>
          </PressableScale>
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Feature({ icon, text, index }: { icon: string; text: string; index: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * motion.stagger)
        .duration(motion.enter)
        .springify()
        .damping(motion.damping)}
      style={styles.feature}
    >
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text variant="bodyStrong" color={colors.white}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  logo: { fontSize: 88 },
  tagline: { marginTop: spacing.sm, opacity: 0.95 },
  features: { paddingHorizontal: spacing.xxl, gap: spacing.lg, marginBottom: spacing.xxl },
  feature: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureIcon: { fontSize: 26, width: 34, textAlign: 'center' },
  actions: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  signInLink: { paddingVertical: spacing.xs },
});
