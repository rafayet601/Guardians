import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Button, Loading, Screen, Text } from '@/components/ui';
import { scrubAuthCallbackUrl, useAuthCallbackUrl } from '@/hooks/useAuthCallbackUrl';
import { sessionFromUrl } from '@/lib/authLink';
import { spacing } from '@/theme';

/** Wait for the full callback before consuming its one-time email confirmation token. */
export default function ConfirmScreen() {
  const router = useRouter();
  const { url, ready } = useAuthCallbackUrl();
  const [status, setStatus] = useState<'loading' | 'invalid'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const exchange = useRef<{ url: string; attempt: number; promise: Promise<boolean> } | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const verify = async () => {
      try {
        if (!url) {
          if (active) {
            setProcessedUrl(url);
            setStatus('invalid');
          }
          return;
        }
        if (exchange.current?.url !== url || exchange.current.attempt !== attempt) {
          exchange.current = { url, attempt, promise: sessionFromUrl(url, 'confirmation') };
        }
        const ok = await exchange.current.promise;
        scrubAuthCallbackUrl(url);
        if (!active) return;
        setProcessedUrl(url);
        if (ok) router.replace('/');
        else setStatus('invalid');
      } catch {
        scrubAuthCallbackUrl(url);
        if (active) {
          setProcessedUrl(url);
          setStatus('invalid');
        }
      }
    };
    void verify();
    return () => {
      active = false;
    };
  }, [url, ready, attempt, router]);

  if (!ready || processedUrl !== url || status === 'loading')
    return <Loading label="Confirming your email…" />;

  return (
    <Screen scroll>
      <Text variant="title" center>
        Email confirmation unavailable
      </Text>
      <Text variant="body" muted center style={{ marginVertical: spacing.lg }}>
        We could not verify this link. Check your connection and try again, or request a new
        confirmation email from sign in if the link has expired or already been used.
      </Text>
      {url ? (
        <Button
          title="Try again"
          fullWidth
          onPress={() => {
            setStatus('loading');
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      <Button
        title="Back to sign in"
        variant="ghost"
        fullWidth
        onPress={() => router.replace('/sign-in')}
        style={{ marginTop: spacing.md }}
      />
    </Screen>
  );
}
