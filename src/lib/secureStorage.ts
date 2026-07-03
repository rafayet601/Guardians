import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Encrypted-at-rest storage adapter for the Supabase auth session.
 *
 * Native: values are kept in the OS keychain/keystore via expo-secure-store.
 * SecureStore rejects values larger than ~2KB on Android, and an access-token +
 * refresh-token blob can exceed that, so large values are transparently chunked
 * across multiple keys (a small "__chunks__:N" marker is stored under the base
 * key). Web has no SecureStore, so we fall back to AsyncStorage (localStorage).
 *
 * Note: existing sessions written to AsyncStorage before this change won't be
 * found here, so users sign in once after upgrading — acceptable pre-launch.
 */
const CHUNK_SIZE = 1800;
const isNative = Platform.OS !== 'web';
const chunkMarker = /^__chunks__:(\d+)$/;

async function getItem(key: string): Promise<string | null> {
  if (!isNative) return AsyncStorage.getItem(key);

  const head = await SecureStore.getItemAsync(key);
  if (head == null) return null;

  const match = chunkMarker.exec(head);
  if (!match) return head;

  const count = Number(match[1]);
  let value = '';
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}__${i}`);
    if (part == null) return null; // corrupted/partial → treat as missing
    value += part;
  }
  return value;
}

async function removeItem(key: string): Promise<void> {
  if (!isNative) return AsyncStorage.removeItem(key);

  const head = await SecureStore.getItemAsync(key);
  const match = head ? chunkMarker.exec(head) : null;
  if (match) {
    const count = Number(match[1]);
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}__${i}`);
  }
  await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (!isNative) return AsyncStorage.setItem(key, value);

  await removeItem(key); // clear any stale chunks first

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const count = Math.ceil(value.length / CHUNK_SIZE);
  await SecureStore.setItemAsync(key, `__chunks__:${count}`);
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(
      `${key}__${i}`,
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
}

export const secureStorage = { getItem, setItem, removeItem };
