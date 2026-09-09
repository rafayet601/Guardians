import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { unregisterPushToken, upsertPushToken } from '@/api/push';
import {
  getPushOptIn,
  registerForPush,
  setPushAccount,
  setPushOptIn,
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
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExpoPushToken[device]' })),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setPushAccount('alice');
});

test('legacy device consent and another account consent never opt in a new account', async () => {
  await AsyncStorage.setItem('@guardians/push_opt_in', 'true');
  expect(await getPushOptIn('alice')).toBe(false);
  await setPushOptIn('alice', true);
  setPushAccount('bob');
  expect(await getPushOptIn('bob')).toBe(false);
  expect(await registerForPush('bob')).toBeNull();
  expect(upsertPushToken).not.toHaveBeenCalled();
});

test('sign-out waits for registration and removes this device association', async () => {
  await setPushOptIn('alice', true);
  await registerForPush('alice');
  await unregisterForPush('alice');
  expect(unregisterPushToken).toHaveBeenCalledWith('ExpoPushToken[device]');
  expect(await AsyncStorage.getItem('@guardians/push_token/alice')).toBeNull();
});

test('a registration finishing after an account change cannot attach the old account', async () => {
  await setPushOptIn('alice', true);
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementationOnce(async () => {
    setPushAccount('bob');
    return { data: 'ExpoPushToken[device]' };
  });
  expect(await registerForPush('alice')).toBeNull();
  expect(upsertPushToken).not.toHaveBeenCalled();
});

test('failed opt-out preserves the token for retry and reaches the UI', async () => {
  await setPushOptIn('alice', true);
  await registerForPush('alice');
  (unregisterPushToken as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await expect(setPushOptIn('alice', false)).rejects.toThrow('offline');
  expect(await getPushOptIn('alice')).toBe(true);
  expect(await AsyncStorage.getItem('@guardians/push_token/alice')).toBe('ExpoPushToken[device]');
});
