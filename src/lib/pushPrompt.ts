import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When to ask for notification permission.
 *
 * The primer used to appear at first launch, before the person had seen a
 * single cat and stacked on top of the location primer. Alerts are the loop's
 * ALERT step, so they matter, but the right moment is one where the value is
 * obvious: after the app knows where they are (alerts are about cats near
 * them), after they post a report (they want to know who helps), after they
 * claim a cat, or after they apply to adopt (they are waiting on a decision).
 * The Settings toggle is always available regardless.
 */
export type PushPromptReason = 'location' | 'report' | 'claim' | 'adopt';

/** Two asks in total: the first, and one more at a later high-intent moment. */
export const MAX_PUSH_ASKS = 2;
/** A passive "location" nudge waits this long after the previous ask. */
export const PASSIVE_ASK_COOLDOWN_MS = 24 * 3_600_000;

export interface PushAskState {
  optedIn: boolean;
  /** The OS has permanently refused; only device Settings can undo it. */
  osBlocked: boolean;
  asks: number;
  lastAskAt: number | null;
}

/**
 * Whether to show the notifications primer now. Reporting a cat, claiming a
 * rescue or applying to adopt are deliberate acts and may ask even soon after a previous ask; the
 * passive location trigger waits out a cooldown so it never nags.
 */
export function shouldAskForPush(
  state: PushAskState,
  reason: PushPromptReason,
  now: number = Date.now(),
): boolean {
  if (state.optedIn || state.osBlocked) return false;
  if (state.asks >= MAX_PUSH_ASKS) return false;
  if (reason === 'location' && state.lastAskAt !== null) {
    return now - state.lastAskAt >= PASSIVE_ASK_COOLDOWN_MS;
  }
  return true;
}

const asksKey = (userId: string) => `@guardians/push_asks/${userId}`;

export async function readPushAsks(
  userId: string,
): Promise<Pick<PushAskState, 'asks' | 'lastAskAt'>> {
  try {
    const raw = await AsyncStorage.getItem(asksKey(userId));
    const parsed = raw ? (JSON.parse(raw) as { asks?: unknown; lastAskAt?: unknown }) : {};
    return {
      asks: typeof parsed.asks === 'number' ? parsed.asks : 0,
      lastAskAt: typeof parsed.lastAskAt === 'number' ? parsed.lastAskAt : null,
    };
  } catch {
    return { asks: 0, lastAskAt: null };
  }
}

export async function recordPushAsk(userId: string, now: number = Date.now()): Promise<void> {
  try {
    const { asks } = await readPushAsks(userId);
    await AsyncStorage.setItem(asksKey(userId), JSON.stringify({ asks: asks + 1, lastAskAt: now }));
  } catch {
    // Best effort: losing the count can only cause one extra ask.
  }
}

type Listener = (reason: PushPromptReason) => void;
const listeners = new Set<Listener>();

/**
 * Screens announce a moment worth asking at; the root layout decides whether to
 * actually show the primer. `afterMs` lets a celebration or navigation finish
 * first so the primer does not land on top of it.
 */
export function requestPushPrompt(reason: PushPromptReason, afterMs = 0): void {
  const fire = () => listeners.forEach((listener) => listener(reason));
  if (afterMs > 0) setTimeout(fire, afterMs);
  else fire();
}

/** Root layout subscribes here. Returns the unsubscribe function. */
export function onPushPromptRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
