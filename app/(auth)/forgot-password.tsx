import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { z } from 'zod';

import { Button, Input, Screen, Text } from '@/components/ui';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, spacing } from '@/theme';

const schema = z.object({ email: z.string().email('Enter a valid email') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await resetPassword(values.email);
      notify(
        'Check your email',
        'If an account exists for that address, we sent a link to reset your password.',
      );
      router.back();
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not send the reset email'));
    }
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          entering={FadeInDown.delay(0 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          style={styles.header}
        >
          <Text style={styles.logo}>🔑</Text>
          <Text variant="title">Reset your password</Text>
          <Text variant="body" muted center style={styles.sub}>
            Enter your email and we'll send you a link to set a new password.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(1 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
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

        {formError ? (
          <Text variant="small" color={colors.danger} style={styles.formError}>
            {formError}
          </Text>
        ) : null}

        <Animated.View
          entering={FadeInDown.delay(2 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
        >
          <Button
            title="Send reset link"
            size="lg"
            fullWidth
            loading={isSubmitting}
            onPress={handleSubmit(onSubmit)}
            style={styles.submit}
          />
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(3 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
        >
          <Pressable onPress={() => router.back()} style={styles.switch} hitSlop={8}>
            <Text variant="body" muted center>
              Back to <Text variant="bodyStrong" color={colors.primary}>sign in</Text>
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
  formError: { marginTop: spacing.sm },
  submit: { marginTop: spacing.lg },
  switch: { marginTop: spacing.xxl },
});
