import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { z } from 'zod';

import { Button, Input, Screen, Text } from '@/components/ui';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, spacing } from '@/theme';

const schema = z.object({
  username: z
    .string()
    .min(3, 'At least 3 characters')
    .max(30, 'Too long')
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and _ only'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'At least 6 characters').max(72, 'Password too long'),
});
type FormValues = z.infer<typeof schema>;

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const { needsConfirmation } = await signUp({
        email: values.email.trim(),
        password: values.password,
        username: values.username.trim(),
      });
      if (needsConfirmation) {
        notify('Confirm your email', 'We sent you a confirmation link. Tap it, then sign in.');
        router.replace('/sign-in');
      }
      // otherwise the root layout redirects into the app automatically
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not create your account'));
    }
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          entering={FadeInDown.duration(motion.enter).springify().damping(motion.damping)}
          style={styles.header}
        >
          <Text style={styles.logo}>🐾</Text>
          <Text variant="title">Join Guardians</Text>
          <Text variant="body" muted center style={styles.sub}>
            Become a reporter, a guardian, or a forever home.
          </Text>
        </Animated.View>

        <View style={styles.form}>
          <Animated.View
            entering={FadeInDown.delay(1 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          >
            <Controller
              control={control}
              name="username"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Username"
                  placeholder="catlover"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.username?.message}
                />
              )}
            />
          </Animated.View>
          <Animated.View
            entering={FadeInDown.delay(2 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
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
            entering={FadeInDown.delay(3 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          >
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Password"
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="new-password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                  hint="At least 6 characters"
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
            entering={FadeInDown.delay(4 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          >
            <Button
              title="Create account"
              size="lg"
              fullWidth
              loading={isSubmitting}
              onPress={handleSubmit(onSubmit)}
              style={styles.submit}
            />
          </Animated.View>
        </View>

        <Animated.View
          entering={FadeInDown.delay(5 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
        >
          <Pressable onPress={() => router.replace('/sign-in')} style={styles.switch} hitSlop={8}>
            <Text variant="body" muted center>
              Already have an account?{' '}
              <Text variant="bodyStrong" color={colors.primary}>
                Sign in
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
  sub: { maxWidth: 300 },
  form: { gap: spacing.lg },
  submit: { marginTop: spacing.sm },
  switch: { marginTop: spacing.xxl },
});
