import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { Loading } from '@/components/ui';
import { sessionFromUrl } from '@/lib/authLink';

/**
 * Lands here from the email-confirmation deep link. Establishes the session
 * from the link and drops the user into the app; falls back to welcome if the
 * link carried no usable token.
 */
export default function ConfirmScreen() {
  const router = useRouter();
  const url = Linking.useURL();

  useEffect(() => {
    let active = true;
    (async () => {
      const ok = url ? await sessionFromUrl(url) : false;
      if (!active) return;
      router.replace(ok ? '/' : '/welcome');
    })();
    return () => {
      active = false;
    };
  }, [url, router]);

  return <Loading label="Confirming your email…" />;
}
