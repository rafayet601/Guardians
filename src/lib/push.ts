import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { unregisterPushToken, upsertPushToken } from '@/api/push';
import { captureError } from '@/lib/observability';

// Show urgent alerts even when the app is foregrounded. (No-op target on web.)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Consent is scoped to the account; legacy device-global consent is ignored.
const optInKey = (userId: string) => `@guardians/push_opt_in/${userId}`;
const tokenKey = (userId: string) => `@guardians/push_token/${userId}`;
let accountId: string | null = null;
let generation = 0;
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => {});
  return next;
}

/** Called synchronously on auth identity changes. Cancels stale registration. */
export function setPushAccount(userId: string | null): void {
  if (accountId !== userId) {
    accountId = userId;
    generation++;
  }
}

export async function getPushOptIn(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(optInKey(userId))) === 'true';
  } catch {
    return false;
  }
}

async function removeDeviceToken(userId: string): Promise<void> {
  const token = await AsyncStorage.getItem(tokenKey(userId));
  if (token) await unregisterPushToken(token);
  await AsyncStorage.removeItem(tokenKey(userId));
}

/** A failed server opt-out must reach the UI, never display false success. */
export function setPushOptIn(userId: string, enabled: boolean): Promise<void> {
  if (!enabled) generation++;
  return serial(async () => {
    if (accountId !== userId) throw new Error('Your account changed. Please try again.');
    if (!enabled) await removeDeviceToken(userId);
    await AsyncStorage.setItem(optInKey(userId), enabled ? 'true' : 'false');
  });
}

/** Wait for any registration, then detach this device before ending its session. */
export function unregisterForPush(userId: string): Promise<void> {
  generation++;
  return serial(() => removeDeviceToken(userId));
}

/** Cheap, prompt-free coarse location (only if permission is already granted). */
async function coarseHomeCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync();
    if (!last) return null;
    return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Request notification permission, obtain the Expo push token, and store it
 * (with a coarse home area) for geo-targeted alerts. Opt-in only: returns
 * early without an OS prompt or token upsert unless `getPushOptIn()` is true.
 * Otherwise best-effort: returns null and never throws on web, simulators,
 * denial, or any setup error.
 */
export function registerForPush(userId: string): Promise<string | null> {
  const started = generation;
  return serial(async () => {
    if (Platform.OS === 'web' || !Device.isDevice) return null;
    if (accountId !== userId || started !== generation || !(await getPushOptIn(userId)))
      return null;
    try {
      // Android needs a channel before it can show the permission prompt.
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('urgent', {
          name: 'Urgent rescues',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
        });
      }

      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted;
      if (!granted) {
        const req = await Notifications.requestPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) return null;

      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const { data: token } = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      if (!token) return null;

      const coords = await coarseHomeCoords();
      if (accountId !== userId || started !== generation) return null;
      // Persist before upload so a retry can detach a token after a lost response.
      await AsyncStorage.setItem(tokenKey(userId), token);
      if (accountId !== userId || started !== generation) return null;
      await upsertPushToken(token, coords);
      return token;
    } catch (e) {
      captureError(e, { scope: 'registerForPush' });
      return null;
    }
  });
}
