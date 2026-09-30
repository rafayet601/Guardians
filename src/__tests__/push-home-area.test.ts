import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { upsertPushToken } from '@/api/push';
import {
  HOME_REFRESH_METERS,
  HOME_REFRESH_MS,
  refreshPushHomeArea,
  registerForPush,
  setPushAccount,
  setPushOptIn,
  shouldRefreshHome,
  unregisterForPush,
} from '@/lib/push';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/api/push', () => ({ unregisterPushToken: jest.fn(), upsertPushToken: jest.fn() }));
jest.mock('@/lib/observability', () => ({ captureError: jest.fn() }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'project' } } } }));
jest.mock('expo-location', () => ({
  Accuracy: { Low: 2 },
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExpoPushToken[device]' })),
}));

const fix = (lat: number, lng: number) => ({ coords: { latitude: lat, longitude: lng } });
const DHAKA = { lat: 23.8103, lng: 90.4125 };
// ~2.2 km north of Dhaka: past the refresh threshold. ~220 m: well inside it.
const FAR = { lat: DHAKA.lat + 0.02, lng: DHAKA.lng };
const NEAR = { lat: DHAKA.lat + 0.002, lng: DHAKA.lng };

const permission = (granted: boolean) =>
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  permission(false);
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('no fix'));
  setPushAccount('alice');
});

describe('shouldRefreshHome', () => {
  const now = 1_000_000_000_000;
  const stored = { ...DHAKA, at: now };

  it('always sends the first area', () => {
    expect(shouldRefreshHome(null, DHAKA, now)).toBe(true);
  });

  it('stays quiet for small movements soon after the last send', () => {
    expect(shouldRefreshHome(stored, NEAR, now + 60_000)).toBe(false);
    expect(shouldRefreshHome(stored, DHAKA, now + 60_000)).toBe(false);
  });

  it('re-sends once the person has moved past the threshold', () => {
    expect(shouldRefreshHome(stored, FAR, now + 60_000)).toBe(true);
    expect(HOME_REFRESH_METERS).toBeGreaterThan(500);
  });

  it('re-sends a stationary device once its area is stale', () => {
    expect(shouldRefreshHome(stored, DHAKA, now + HOME_REFRESH_MS - 1)).toBe(false);
    expect(shouldRefreshHome(stored, DHAKA, now + HOME_REFRESH_MS)).toBe(true);
  });
});

describe('registerForPush alert area', () => {
  it('uses the cached fix when location is already granted', async () => {
    permission(true);
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fix(DHAKA.lat, DHAKA.lng));
    await setPushOptIn('alice', true);
    await registerForPush('alice');
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', DHAKA);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back to a live fix when the OS has nothing cached', async () => {
    permission(true);
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fix(DHAKA.lat, DHAKA.lng));
    await setPushOptIn('alice', true);
    await registerForPush('alice');
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', DHAKA);
  });

  it('registers without an area when location was never granted (nothing to preserve)', async () => {
    await setPushOptIn('alice', true);
    await registerForPush('alice');
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', null);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('re-sends the last good area instead of wiping it when a launch gets no fix', async () => {
    // Launch 1: a fix is available and gets stored.
    permission(true);
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fix(DHAKA.lat, DHAKA.lng));
    await setPushOptIn('alice', true);
    await registerForPush('alice');

    // Launch 2: permission is granted but the OS cannot produce a position.
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('no fix'));
    jest.mocked(upsertPushToken).mockClear();
    await registerForPush('alice');
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', DHAKA);
  });
});

describe('refreshPushHomeArea', () => {
  async function registeredWithoutLocation() {
    await setPushOptIn('alice', true);
    await registerForPush('alice'); // first launch: no location yet
    jest.mocked(upsertPushToken).mockClear();
  }

  it('gives a device that registered with no area its first one once location is known', async () => {
    await registeredWithoutLocation();
    expect(await refreshPushHomeArea('alice', DHAKA)).toBe(true);
    expect(upsertPushToken).toHaveBeenCalledTimes(1);
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', DHAKA);
  });

  it('does not call the server again for a stationary or barely-moving device', async () => {
    await registeredWithoutLocation();
    await refreshPushHomeArea('alice', DHAKA);
    jest.mocked(upsertPushToken).mockClear();
    expect(await refreshPushHomeArea('alice', DHAKA)).toBe(false);
    expect(await refreshPushHomeArea('alice', NEAR)).toBe(false);
    expect(upsertPushToken).not.toHaveBeenCalled();
  });

  it('follows the person when they move far enough', async () => {
    await registeredWithoutLocation();
    await refreshPushHomeArea('alice', DHAKA);
    jest.mocked(upsertPushToken).mockClear();
    expect(await refreshPushHomeArea('alice', FAR)).toBe(true);
    expect(upsertPushToken).toHaveBeenCalledWith('ExpoPushToken[device]', FAR);
  });

  it('never touches the server for an account that has not opted in or has no token', async () => {
    expect(await refreshPushHomeArea('alice', DHAKA)).toBe(false);
    await setPushOptIn('alice', true); // opted in, but this device never registered
    expect(await refreshPushHomeArea('alice', DHAKA)).toBe(false);
    expect(upsertPushToken).not.toHaveBeenCalled();
  });

  it('ignores a fix that arrives for an account that is no longer signed in', async () => {
    await registeredWithoutLocation();
    setPushAccount('bob');
    expect(await refreshPushHomeArea('alice', DHAKA)).toBe(false);
    expect(upsertPushToken).not.toHaveBeenCalled();
  });

  it('forgets the stored area when the device is detached, so a stale one is never reused', async () => {
    permission(true);
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fix(DHAKA.lat, DHAKA.lng));
    await setPushOptIn('alice', true);
    await registerForPush('alice');
    expect(await AsyncStorage.getItem('@guardians/push_home/alice')).not.toBeNull();
    await unregisterForPush('alice');
    expect(await AsyncStorage.getItem('@guardians/push_home/alice')).toBeNull();
  });
});
