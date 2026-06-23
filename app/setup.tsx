import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Card, Screen, Text } from '@/components/ui';
import { colors, motion, spacing } from '@/theme';

const stagger = (i: number) =>
  FadeInDown.delay(i * motion.stagger).duration(motion.enter).springify().damping(motion.damping);

export default function SetupScreen() {
  return (
    <Screen scroll>
      <Animated.View entering={stagger(0)} style={styles.header}>
        <Text style={styles.logo}>🐾</Text>
        <Text variant="title" center>
          Almost there!
        </Text>
        <Text variant="body" muted center style={styles.sub}>
          Guardians needs a Supabase backend before it can run.
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(1)}>
        <Card style={styles.card}>
          <Text variant="subheading">1 · Create a Supabase project</Text>
          <Text variant="small" muted>
            Sign up at app.supabase.com and create a new project.
          </Text>
        </Card>
      </Animated.View>

      <Animated.View entering={stagger(2)}>
        <Card style={styles.card}>
          <Text variant="subheading">2 · Run the migrations</Text>
          <Text variant="small" muted>
            In the SQL Editor, run each file in{' '}
            <Text variant="smallStrong">supabase/migrations</Text> in order (0001 → 0012).
          </Text>
        </Card>
      </Animated.View>

      <Animated.View entering={stagger(3)}>
        <Card style={styles.card}>
          <Text variant="subheading">3 · Add your keys</Text>
          <Text variant="small" muted>
            Copy <Text variant="smallStrong">.env.example</Text> to{' '}
            <Text variant="smallStrong">.env</Text> and paste your Supabase URL + anon key and a
            Google Maps key. Then restart with{' '}
            <Text variant="smallStrong">npx expo start --clear</Text>.
          </Text>
        </Card>
      </Animated.View>

      <Animated.View entering={stagger(4)}>
        <Text variant="small" muted center style={styles.footer}>
          Full instructions are in the project README.
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  logo: { fontSize: 56 },
  sub: { maxWidth: 300 },
  card: { gap: spacing.xs, marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.primary },
  footer: { marginTop: spacing.lg },
});
