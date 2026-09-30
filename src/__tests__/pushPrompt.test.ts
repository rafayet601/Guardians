import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MAX_PUSH_ASKS,
  PASSIVE_ASK_COOLDOWN_MS,
  onPushPromptRequest,
  readPushAsks,
  recordPushAsk,
  requestPushPrompt,
  shouldAskForPush,
  type PushAskState,
} from '@/lib/pushPrompt';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fresh: PushAskState = { optedIn: false, osBlocked: false, asks: 0, lastAskAt: null };
const now = 1_000_000_000_000;

describe('shouldAskForPush', () => {
  it('asks a brand-new user at every kind of moment', () => {
    for (const reason of ['location', 'report', 'claim', 'adopt'] as const) {
      expect(shouldAskForPush(fresh, reason, now)).toBe(true);
    }
  });

  it('never asks someone who already has alerts on', () => {
    expect(shouldAskForPush({ ...fresh, optedIn: true }, 'claim', now)).toBe(false);
  });

  it('never asks when the OS has permanently refused, since the prompt cannot appear', () => {
    expect(shouldAskForPush({ ...fresh, osBlocked: true }, 'report', now)).toBe(false);
  });

  it('stops after the maximum number of asks', () => {
    const spent = { ...fresh, asks: MAX_PUSH_ASKS, lastAskAt: now - 30 * 86_400_000 };
    for (const reason of ['location', 'report', 'claim', 'adopt'] as const) {
      expect(shouldAskForPush(spent, reason, now)).toBe(false);
    }
  });

  it('lets a deliberate act ask again soon after a decline, but not a passive nudge', () => {
    const justAsked = { ...fresh, asks: 1, lastAskAt: now - 60_000 };
    expect(shouldAskForPush(justAsked, 'report', now)).toBe(true);
    expect(shouldAskForPush(justAsked, 'claim', now)).toBe(true);
    expect(shouldAskForPush(justAsked, 'adopt', now)).toBe(true);
    expect(shouldAskForPush(justAsked, 'location', now)).toBe(false);
  });

  it('lets the passive nudge ask once its cooldown has passed', () => {
    const state = { ...fresh, asks: 1, lastAskAt: now - PASSIVE_ASK_COOLDOWN_MS };
    expect(shouldAskForPush(state, 'location', now)).toBe(true);
  });
});

describe('ask bookkeeping', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts at zero asks', async () => {
    expect(await readPushAsks('alice')).toEqual({ asks: 0, lastAskAt: null });
  });

  it('counts asks per account and remembers when the last one was', async () => {
    await recordPushAsk('alice', 111);
    await recordPushAsk('alice', 222);
    await recordPushAsk('bob', 333);
    expect(await readPushAsks('alice')).toEqual({ asks: 2, lastAskAt: 222 });
    expect(await readPushAsks('bob')).toEqual({ asks: 1, lastAskAt: 333 });
  });

  it('treats corrupt stored data as never asked', async () => {
    await AsyncStorage.setItem('@guardians/push_asks/alice', '{not json');
    expect(await readPushAsks('alice')).toEqual({ asks: 0, lastAskAt: null });
    await AsyncStorage.setItem('@guardians/push_asks/alice', '{"asks":"many"}');
    expect(await readPushAsks('alice')).toEqual({ asks: 0, lastAskAt: null });
  });
});

describe('requestPushPrompt', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tells every listener why, and stops after unsubscribe', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = onPushPromptRequest(a);
    const offB = onPushPromptRequest(b);
    requestPushPrompt('report');
    expect(a).toHaveBeenCalledWith('report');
    expect(b).toHaveBeenCalledWith('report');
    offA();
    requestPushPrompt('claim');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });

  it('waits when asked to, so a celebration can finish first', () => {
    const listener = jest.fn();
    const off = onPushPromptRequest(listener);
    requestPushPrompt('claim', 2500);
    jest.advanceTimersByTime(2499);
    expect(listener).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledWith('claim');
    off();
  });
});
