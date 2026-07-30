import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { setPushEnabled, upsertPushToken } from '@/api/push';
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

// Push is strictly opt-in (P1-1): the privacy policy describes urgent alerts
// as opt-in, so nothing — no OS prompt, no token upsert — happens until the
// user explicitly enables alerts via the notifications primer.
const PUSH_OPT_IN_KEY = '@guardians/push_opt_in';

/** True only when the user has explicitly opted in to push alerts. */
export async function getPushOptIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_OPT_IN_KEY)) === 'true';
  } catch {
    return false; // fail-closed: an unreadable flag must not enable pushes
  }
}

/**
 * Persist the push opt-in choice and mirror it to the user's server-side token
 * rows, so alerts stop — or resume — even if the app is never opened again on
 * this device.
 *
 * BOTH directions must be mirrored. `upsert_push_token` (0010) only writes
 * `last_known_location`/`updated_at` on conflict, so re-registering a token
 * does NOT clear a previous opt-out: without the enable call, opting back in
 * would leave `push_enabled = false` forever and silently drop every lifecycle
 * push while the UI switch reads "on".
 */
export async function setPushOptIn(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_OPT_IN_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    captureError(e, { scope: 'setPushOptIn' });
  }
  try {
    await setPushEnabled(enabled);
  } catch (e) {
    captureError(e, { scope: `setPushOptIn:${enabled ? 'enable' : 'disable'}Remote` });
  }
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
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  if (!(await getPushOptIn())) return null;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('urgent', {
        name: 'Urgent rescues',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return null;

    await upsertPushToken(token, await coarseHomeCoords());
    return token;
  } catch (e) {
    captureError(e, { scope: 'registerForPush' });
    return null;
  }
}
