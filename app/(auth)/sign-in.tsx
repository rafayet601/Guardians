import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { z } from 'zod';

import { Button, Input, Screen, Text } from '@/components/ui';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, spacing } from '@/theme';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(6, 'At least 6 characters').max(72, 'Password too long'),
});
type FormValues = z.infer<typeof schema>;

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await signIn(values.email.trim(), values.password);
      // root layout redirects to the app on session change
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not sign in'));
    }
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          entering={FadeInDown.delay(0 * motion.stagger)
            .duration(motion.enter)
            .springify()
            .damping(motion.damping)}
          style={styles.header}
        >
          <Text style={styles.logo}>🐾</Text>
          <Text variant="title">Welcome back</Text>
          <Text variant="body" muted>
            Sign in to keep helping cats.
          </Text>
        </Animated.View>

        <View style={styles.form}>
          <Animated.View
            entering={FadeInDown.delay(1 * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)}
          >
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.delay(2 * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)}
          >
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Password"
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="current-password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />
          </Animated.View>

          {formError ? (
            <Text variant="small" color={colors.danger}>
              {formError}
            </Text>
          ) : null}

          <Animated.View
            entering={FadeInDown.delay(3 * motion.stagger)
              .duration(motion.enter)
              .springify()
              .damping(motion.damping)}
          >
            <Button
              title="Sign in"
              size="lg"
              fullWidth
              loading={isSubmitting}
              onPress={handleSubmit(onSubmit)}
              style={styles.submit}
            />
          </Animated.View>
        </View>

        <Animated.View
          entering={FadeInDown.delay(4 * motion.stagger)
            .duration(motion.enter)
            .springify()
            .damping(motion.damping)}
        >
          <Pressable
            onPress={() => router.push('/forgot-password')}
            style={styles.forgot}
            hitSlop={8}
          >
            <Text variant="smallStrong" color={colors.primary} center>
              Forgot your password?
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/sign-up')} style={styles.switch} hitSlop={8}>
            <Text variant="body" muted center>
              New here?{' '}
              <Text variant="bodyStrong" color={colors.primary}>
                Create an account
              </Text>
            </Text>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xxl },
  logo: { fontSize: 56 },
  form: { gap: spacing.lg },
  submit: { marginTop: spacing.sm },
  forgot: { marginTop: spacing.xl, paddingVertical: spacing.xs },
  switch: { marginTop: spacing.lg },
});
