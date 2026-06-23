import {
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
} from '@expo-google-fonts/nunito';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { useFonts } from 'expo-font';
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

  const [fontsLoaded, fontError] = useFonts({
    'Nunito-Bold': Nunito_700Bold,
    'Nunito-ExtraBold': Nunito_800ExtraBold,
    'Nunito-Black': Nunito_900Black,
    'Jakarta-Regular': PlusJakartaSans_400Regular,
    'Jakarta-Medium': PlusJakartaSans_500Medium,
    'Jakarta-SemiBold': PlusJakartaSans_600SemiBold,
    'Jakarta-Bold': PlusJakartaSans_700Bold,
    SpaceMono: SpaceMono_400Regular,
    'SpaceMono-Bold': SpaceMono_700Bold,
  });
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (initializing || !fontsReady) return;
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
  }, [session, initializing, segments, router, fontsReady]);

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

  // Hold the splash screen until fonts are ready so text doesn't flash unstyled.
  if (!fontsReady) return null;

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
        name="moderation"
        options={{ headerShown: true, title: 'Moderation', headerTintColor: colors.primary }}
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
