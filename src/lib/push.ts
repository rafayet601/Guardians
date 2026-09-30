import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { unregisterPushToken, upsertPushToken } from '@/api/push';
import { withTimeout } from '@/lib/async';
import { captureError } from '@/lib/observability';
import { distanceMeters } from '@/utils/geo';

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
const homeKey = (userId: string) => `@guardians/push_home/${userId}`;

/** How far the device must move before its stored alert area is re-sent. */
export const HOME_REFRESH_METERS = 1500;
/** Even a device that never moves re-sends its area this often, so it never goes stale. */
export const HOME_REFRESH_MS = 12 * 3_600_000;

interface HomeArea {
  lat: number;
  lng: number;
  /** When this area was last sent to the server (ms since epoch). */
  at: number;
}

/**
 * Whether a new position is worth sending. `upsert_push_token` overwrites the
 * stored alert area with whatever it is given, so this errs on the side of
 * keeping the last good one, but never lets it drift or go stale.
 */
export function shouldRefreshHome(
  stored: HomeArea | null,
  next: { lat: number; lng: number },
  now: number,
): boolean {
  if (!stored) return true;
  return distanceMeters(stored, next) >= HOME_REFRESH_METERS || now - stored.at >= HOME_REFRESH_MS;
}

async function readHome(userId: string): Promise<HomeArea | null> {
  try {
    const raw = await AsyncStorage.getItem(homeKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HomeArea>;
    return typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      typeof parsed.at === 'number'
      ? { lat: parsed.lat, lng: parsed.lng, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

async function writeHome(userId: string, coords: { lat: number; lng: number }): Promise<void> {
  try {
    await AsyncStorage.setItem(
      homeKey(userId),
      JSON.stringify({ lat: coords.lat, lng: coords.lng, at: Date.now() }),
    );
  } catch {
    // Best effort: a lost record only means the next fix re-sends the area.
  }
}
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
  await AsyncStorage.removeItem(homeKey(userId));
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

/** A cached fix older than this is not trusted as "where the person is now". */
const LAST_KNOWN_MAX_AGE_MS = 6 * 3_600_000;

/**
 * Prompt-free coarse location, only when permission is already granted. Falls
 * back to a quick low-accuracy fix when the OS has nothing cached: the cache is
 * often empty on a fresh install, which used to register the device with no
 * alert area at all.
 */
async function coarseHomeCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    const current = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      5000,
      'Location fix timed out',
    );
    return { lat: current.coords.latitude, lng: current.coords.longitude };
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

      const fresh = await coarseHomeCoords();
      // upsert_push_token overwrites the alert area with whatever it receives, so
      // a launch that cannot get a fix must re-send the last good area rather
      // than wipe it, or the device silently drops out of urgent alerts.
      const stored = fresh ? null : await readHome(userId);
      const coords = fresh ?? (stored ? { lat: stored.lat, lng: stored.lng } : null);
      if (accountId !== userId || started !== generation) return null;
      // Persist before upload so a retry can detach a token after a lost response.
      await AsyncStorage.setItem(tokenKey(userId), token);
      if (accountId !== userId || started !== generation) return null;
      await upsertPushToken(token, coords);
      if (fresh) await writeHome(userId, fresh);
      return token;
    } catch (e) {
      captureError(e, { scope: 'registerForPush' });
      return null;
    }
  });
}

/**
 * Keep this device's alert area following the person. Registration captures it
 * once, at launch, and at first launch location has usually not been granted
 * yet, so the device registered with no area and `tokens_near` (the urgent
 * alert fan-out) never matched it. Call this whenever a fix is available; it
 * only talks to the server when the person has moved or the area is stale.
 *
 * Does nothing unless this account has opted in and this device has a token.
 */
export function refreshPushHomeArea(
  userId: string,
  coords: { lat: number; lng: number },
): Promise<boolean> {
  const started = generation;
  return serial(async () => {
    if (Platform.OS === 'web' || !Device.isDevice) return false;
    if (accountId !== userId || started !== generation) return false;
    try {
      const token = await AsyncStorage.getItem(tokenKey(userId));
      if (!token || !(await getPushOptIn(userId))) return false;
      if (!shouldRefreshHome(await readHome(userId), coords, Date.now())) return false;
      if (accountId !== userId || started !== generation) return false;
      await upsertPushToken(token, coords);
      await writeHome(userId, coords);
      return true;
    } catch (e) {
      captureError(e, { scope: 'refreshPushHomeArea' });
      return false;
    }
  });
}
