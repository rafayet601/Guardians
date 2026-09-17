import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OAuthProvider } from '@/api/auth';
import { Button, Text } from '@/components/ui';
import { useOAuthProviders } from '@/hooks/useOAuthProviders';
import { getErrorMessage } from '@/lib/errors';
import { signInWithOAuth } from '@/lib/oauth';
import { colors, spacing } from '@/theme';

export function OAuthButtons({
  disabled,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { data: providers = [], isError, isFetching, refetch } = useOAuthProviders();
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const start = async (provider: OAuthProvider) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setPending(provider);
    setError(null);
    onBusyChange(true);
    try {
      await signInWithOAuth(provider);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not sign in. Please try again.'));
    } finally {
      lock.current = false;
      setPending(null);
      onBusyChange(false);
    }
  };

  if (!providers.length && !isError) return null;
  return (
    <View style={styles.container}>
      {providers.map((provider) => (
        <Button
          key={provider}
          title={`Continue with ${provider === 'google' ? 'Google' : 'Apple'}`}
          variant="outline"
          fullWidth
          disabled={disabled || pending !== null}
          loading={pending === provider}
          onPress={() => void start(provider)}
        />
      ))}
      {isError ? (
        <>
          <Text variant="small" muted>
            Social sign-in options could not be loaded. You can still use email.
          </Text>
          <Button
            title="Retry sign-in options"
            variant="ghost"
            loading={isFetching}
            disabled={disabled || pending !== null}
            onPress={() => void refetch()}
          />
        </>
      ) : null}
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {providers.length ? (
        <Text variant="small" muted center>
          Or continue with email
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ container: { gap: spacing.md, marginBottom: spacing.lg } });
