import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { z } from 'zod';

import { AuthHeader } from '@/components/AuthHeader';
import { OAuthButtons } from '@/components/OAuthButtons';
import { Button, Input, Screen, Text } from '@/components/ui';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, layout, motion, spacing } from '@/theme';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(6, 'At least 6 characters').max(72, 'Password too long'),
});
type FormValues = z.infer<typeof schema>;

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, resendConfirmation } = useAuth();
  const [resending, setResending] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [oauthPending, setOAuthPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;
  const {
    control,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    if (oauthPending || resending) return;
    setFormError(null);
    try {
      await signIn(values.email.trim(), values.password);
      // root layout redirects to the app on session change
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not sign in'));
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.page}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          entering={
            reduced
              ? undefined
              : FadeInDown.delay(0 * motion.stagger)
                  .duration(motion.enter)
                  .springify()
                  .damping(motion.damping)
          }
          style={styles.header}
        >
          <AuthHeader
            title="Welcome back."
            subtitle="Your next good deed starts here. Sign in to your community."
          />
        </Animated.View>

        <OAuthButtons disabled={isSubmitting || resending} onBusyChange={setOAuthPending} />

        <View style={styles.form}>
          <Animated.View
            entering={
              reduced
                ? undefined
                : FadeInDown.delay(1 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
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
            entering={
              reduced
                ? undefined
                : FadeInDown.delay(2 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
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
            entering={
              reduced
                ? undefined
                : FadeInDown.delay(3 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
          >
            <Button
              title="Sign in"
              size="lg"
              fullWidth
              loading={isSubmitting}
              disabled={oauthPending || resending}
              onPress={handleSubmit(onSubmit)}
              style={styles.submit}
            />
          </Animated.View>
        </View>

        <Button
          title="Resend confirmation email"
          variant="ghost"
          loading={resending}
          disabled={isSubmitting || oauthPending || resending}
          onPress={async () => {
            const email = z.string().trim().email().safeParse(getValues('email'));
            if (!email.success) {
              setFormError('Enter your email above to request a confirmation link.');
              return;
            }
            setResending(true);
            setFormError(null);
            setConfirmationMessage(null);
            try {
              await resendConfirmation(email.data);
              setConfirmationMessage(
                'If your account needs confirmation, a new link has been sent. Check your inbox and spam folder, and open the link in this same browser or app.',
              );
            } catch (e) {
              setFormError(
                getErrorMessage(e, 'Could not resend the email. Please try again later.'),
              );
            } finally {
              setResending(false);
            }
          }}
        />
        {confirmationMessage ? (
          <Text variant="small" muted accessibilityLiveRegion="polite">
            {confirmationMessage}
          </Text>
        ) : null}

        <Animated.View
          entering={
            reduced
              ? undefined
              : FadeInDown.delay(4 * motion.stagger)
                  .duration(motion.enter)
                  .springify()
                  .damping(motion.damping)
          }
        >
          <Pressable
            onPress={() => router.push('/forgot-password')}
            style={styles.forgot}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Forgot your password"
          >
            <Text variant="smallStrong" color={colors.primary} center>
              Forgot your password?
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.replace('/sign-up')}
            style={styles.switch}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Create an account"
          >
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
  page: {
    width: '100%',
    maxWidth: layout.formMax,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
  },
  header: {},
  logo: { fontSize: 56 },
  form: { gap: spacing.lg },
  submit: { marginTop: spacing.sm },
  forgot: { marginTop: spacing.xl, paddingVertical: spacing.xs },
  switch: { marginTop: spacing.lg },
});
