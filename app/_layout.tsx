import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { SpaceMono_400Regular } from '@expo-google-fonts/space-mono/400Regular';
import { SpaceMono_700Bold } from '@expo-google-fonts/space-mono/700Bold';
import { useQueryClient } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import { Platform } from 'react-native';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { env } from '@/lib/env';
import { notificationRoute, notificationSightingId } from '@/lib/notificationRoute';
import { initObservability } from '@/lib/observability';
import { markPrimerShown, trackPermissionResult } from '@/lib/permissions';
import { getPushOptIn, registerForPush, setPushOptIn } from '@/lib/push';
import {
  onPushPromptRequest,
  readPushAsks,
  recordPushAsk,
  shouldAskForPush,
  type PushPromptReason,
} from '@/lib/pushPrompt';
import { queryKeys } from '@/lib/queryClient';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
initObservability();

function RootNavigator() {
  const { session, initializing } = useAuth();
  const userId = session?.user.id;
  const segments = useSegments();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pushPrimerVisible, setPushPrimerVisible] = useState(false);
  const [pushPrimerReason, setPushPrimerReason] = useState<PushPromptReason>('location');
  const pushPrimerOpen = useRef(false);
  useEffect(() => {
    pushPrimerOpen.current = pushPrimerVisible;
  });

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

    // Legal pages must remain public, including before backend setup.
    if (root === 'privacy' || root === 'terms') return;

    // Backend not set up yet → force the setup screen.
    if (!env.isConfigured) {
      if (root !== 'setup') router.replace('/setup');
      return;
    }

    // Password-recovery / email-confirm deep links manage their own flow and
    // briefly hold a session before the user finishes — don't redirect them.
    if (root === 'reset' || root === 'confirm' || root === 'oauth-callback') return;

    const inAuthFlow = root === '(auth)';
    if (!session && !inAuthFlow) {
      router.replace('/welcome');
    } else if (session && inAuthFlow) {
      router.replace('/');
    }
  }, [session, initializing, segments, router, fontsReady]);

  // Push is strictly opt-in (P1-1). Returning opted-in users re-register
  // silently on session start (token refresh). Nobody is asked at launch any
  // more: the primer used to appear before the person had seen a single cat and
  // stacked on the location primer. Screens announce moments worth asking at
  // (location known, report posted, cat claimed) via requestPushPrompt.
  useEffect(() => {
    if (!userId || !env.isConfigured || Platform.OS === 'web') return;
    let active = true;
    (async () => {
      if (active && (await getPushOptIn(userId))) void registerForPush(userId);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !env.isConfigured || Platform.OS === 'web') return;
    return onPushPromptRequest(async (reason) => {
      if (pushPrimerOpen.current) return;
      try {
        const permission = await Notifications.getPermissionsAsync();
        const { asks, lastAskAt } = await readPushAsks(userId);
        const ask = shouldAskForPush(
          {
            optedIn: await getPushOptIn(userId),
            // Once the OS has refused for good our primer cannot lead anywhere.
            osBlocked: !permission.granted && !permission.canAskAgain,
            asks,
            lastAskAt,
          },
          reason,
        );
        if (!ask || pushPrimerOpen.current) return;
        await recordPushAsk(userId);
        setPushPrimerReason(reason);
        setPushPrimerVisible(true);
      } catch {
        // Asking is best-effort; the Settings toggle is always there.
      }
    });
  }, [userId]);

  const allowPushPrimer = async () => {
    setPushPrimerVisible(false);
    await markPrimerShown('notifications', session?.user.id);
    try {
      await setPushOptIn(session?.user.id ?? '', true);
      const token = await registerForPush(session?.user.id ?? '');
      if (!token) await setPushOptIn(session?.user.id ?? '', false);
      trackPermissionResult('notifications', token ? 'granted' : 'denied');
      if (!token) notify('Alerts unavailable', 'You can enable rescue alerts later in Settings.');
    } catch (e) {
      notify('Could not enable alerts', getErrorMessage(e, 'Please try again in Settings.'));
    }
  };

  const dismissPushPrimer = async () => {
    setPushPrimerVisible(false);
    await markPrimerShown('notifications', session?.user.id);
    try {
      await setPushOptIn(session?.user.id ?? '', false);
    } catch (e) {
      notify('Could not update alerts', getErrorMessage(e));
    }
    trackPermissionResult('notifications', 'dismissed');
  };

  // A push means something just changed on a cat. Refresh what the app has
  // cached for it, so opening the report (or glancing at the map) shows the
  // claim or status change the push announced rather than a stale copy.
  useEffect(() => {
    if (Platform.OS === 'web' || !session) return;
    const refresh = (data: unknown) => {
      const id = notificationSightingId(data);
      if (id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sighting(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sightingUpdates(id) });
      }
      void queryClient.invalidateQueries({ queryKey: ['sightings'] });
    };
    const sub = Notifications.addNotificationReceivedListener((n) =>
      refresh(n.request.content.data),
    );
    return () => sub.remove();
  }, [queryClient, session]);

  // Tapping a push notification deep-links to where it can be acted on: the
  // sighting for lifecycle/urgent pushes, the lost-cat screen for a match.
  useEffect(() => {
    if (Platform.OS === 'web' || initializing || !session || !fontsReady) return;
    const redirect = (resp: Notifications.NotificationResponse) => {
      const data = resp.notification.request.content.data;
      const route = notificationRoute(data);
      if (!route) return;
      const id = notificationSightingId(data);
      if (id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sighting(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sightingUpdates(id) });
      }
      router.push(route as Parameters<typeof router.push>[0]);
      Notifications.clearLastNotificationResponse();
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) redirect(last);
    const sub = Notifications.addNotificationResponseReceivedListener(redirect);
    return () => sub.remove();
  }, [router, queryClient, initializing, session, fontsReady]);

  // Hold the splash screen until fonts are ready so text doesn't flash unstyled.
  if (!fontsReady) return null;

  return (
    <>
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      >
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
          name="adopt/screening"
          options={{
            headerShown: true,
            title: 'Background check',
            headerTintColor: colors.primary,
          }}
        />
        <Stack.Screen
          name="privacy"
          options={{ headerShown: true, title: 'Privacy Policy', headerTintColor: colors.primary }}
        />
        <Stack.Screen
          name="terms"
          options={{
            headerShown: true,
            title: 'Terms of Service',
            headerTintColor: colors.primary,
          }}
        />
        <Stack.Screen
          name="moderation"
          options={{ headerShown: true, title: 'Moderation', headerTintColor: colors.primary }}
        />
        <Stack.Screen
          name="blocked-users"
          options={{ headerShown: true, title: 'Blocked users', headerTintColor: colors.primary }}
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

      {/* One-time notifications primer — push is opt-in (P1-1) */}
      <PermissionPrimer
        visible={pushPrimerVisible}
        kind="notifications"
        reason={pushPrimerReason}
        onAllow={allowPushPrimer}
        onDismiss={dismissPushPrimer}
      />
    </>
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
