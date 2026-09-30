import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, Loading, Screen, Text } from '@/components/ui';
import { useAuthCallbackUrl, scrubAuthCallbackUrl } from '@/hooks/useAuthCallbackUrl';
import { sessionFromUrl } from '@/lib/authLink';

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const { url, ready } = useAuthCallbackUrl();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void (async () => {
      let ok = false;
      try {
        ok = url ? await sessionFromUrl(url, 'oauth') : false;
      } catch {
        // Never log callback URLs, codes, or tokens.
      }
      if (!active) return;
      scrubAuthCallbackUrl(url);
      if (ok) router.replace('/');
      else setFailed(true);
    })();
    return () => {
      active = false;
    };
  }, [ready, url, router]);

  if (!failed) return <Loading label="Completing sign-in…" />;
  return (
    <Screen scroll>
      <Text variant="title">Sign-in wasn’t completed</Text>
      <Text variant="body" muted>
        The request may have been cancelled or expired. Start again on this device.
      </Text>
      <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
