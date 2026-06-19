import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { env } from '@/lib/env';
import { initObservability } from '@/lib/observability';
import { registerForPush } from '@/lib/push';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
initObservability();

function RootNavigator() {
  const { session, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;
    SplashScreen.hideAsync().catch(() => {});

    const root = segments[0];

    // Backend not set up yet → force the setup screen.
    if (!env.isConfigured) {
      if (root !== 'setup') router.replace('/setup');
      return;
    }

    // Password-recovery / email-confirm deep links manage their own flow and
    // briefly hold a session before the user finishes — don't redirect them.
    if (root === 'reset' || root === 'confirm') return;

    const inAuthFlow = root === '(auth)';
    if (!session && !inAuthFlow) {
      router.replace('/welcome');
    } else if (session && inAuthFlow) {
      router.replace('/');
    }
  }, [session, initializing, segments, router]);

  // Register this device for push once signed in (best-effort).
  useEffect(() => {
    if (session && env.isConfigured) void registerForPush();
  }, [session]);

  // Tapping a push notification deep-links to the relevant sighting.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as { sighting_id?: string } | undefined;
      if (data?.sighting_id) router.push(`/sighting/${data.sighting_id}`);
    });
    return () => sub.remove();
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="report" options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="sighting/[id]"
        options={{
          headerShown: true,
          headerTitle: '',
          headerTransparent: true,
          headerTintColor: colors.primary,
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="settings"
        options={{ headerShown: true, title: 'Settings', headerTintColor: colors.primary }}
      />
      <Stack.Screen
        name="rewards/[id]"
        options={{
          headerShown: true,
          headerTitle: '',
          headerTransparent: true,
          headerTintColor: colors.primary,
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="rewards/redemptions"
        options={{ headerShown: true, title: 'My rewards', headerTintColor: colors.primary }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <StatusBar style="dark" />
        <RootNavigator />
      </AppProviders>
    </ErrorBoundary>
  );
}
