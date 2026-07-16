import { zodResolver } from '@hookform/resolvers/zod';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet } from 'react-native';
import { z } from 'zod';

import { Button, Input, Loading, Screen, Text } from '@/components/ui';
import { sessionFromUrl } from '@/lib/authLink';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, spacing } from '@/theme';

const schema = z
  .object({
    password: z.string().min(6, 'At least 6 characters').max(72, 'Password too long'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const { session, updatePassword } = useAuth();
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  // Establish the recovery session from the email deep link.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ok = url ? await sessionFromUrl(url) : false;
        if (!active) return;
        setStatus(ok || session ? 'ready' : 'invalid');
      } catch (err) {
        console.error('Failed to parse reset URL:', err);
        if (!active) return;
        setStatus('invalid');
      }
    })();
    return () => {
      active = false;
    };
  }, [url, session]);

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await updatePassword(values.password);
      notify('Password updated', 'You can now use your new password.');
      router.replace('/');
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not update your password'));
    }
  };

  if (status === 'loading') return <Loading label="Verifying your reset link…" />;

  if (status === 'invalid') {
    return (
      <Screen scroll>
        <Text style={styles.logo}>⚠️</Text>
        <Text variant="title" center>
          Reset link expired
        </Text>
        <Text variant="body" muted center style={styles.sub}>
          This password-reset link is invalid or has expired. Request a new one from the sign-in
          screen.
        </Text>
        <Button
          title="Back to sign in"
          size="lg"
          fullWidth
          onPress={() => router.replace('/sign-in')}
          style={styles.submit}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.logo}>🔐</Text>
        <Text variant="title" center>
          Choose a new password
        </Text>

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="New password"
              placeholder="••••••••"
              secureTextEntry
              autoComplete="new-password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.password?.message}
              style={styles.field}
            />
          )}
        />
        <Controller
          control={control}
          name="confirm"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Confirm password"
              placeholder="••••••••"
              secureTextEntry
              autoComplete="new-password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.confirm?.message}
            />
          )}
        />

        {formError ? (
          <Text variant="small" color={colors.danger} style={styles.formError}>
            {formError}
          </Text>
        ) : null}

        <Button
          title="Update password"
          size="lg"
          fullWidth
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
          style={styles.submit}
        />

        <Pressable onPress={() => router.replace('/sign-in')} style={styles.switch} hitSlop={8}>
          <Text variant="body" muted center>
            Back to{' '}
            <Text variant="bodyStrong" color={colors.primary}>
              sign in
            </Text>
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { fontSize: 56, textAlign: 'center', marginTop: spacing.xxl, marginBottom: spacing.sm },
  sub: { maxWidth: 300, alignSelf: 'center', marginTop: spacing.xs },
  field: { marginTop: spacing.lg },
  formError: { marginTop: spacing.sm },
  submit: { marginTop: spacing.lg },
  switch: { marginTop: spacing.xxl },
});
