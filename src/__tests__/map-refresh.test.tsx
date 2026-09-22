import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getNearby, type NearbyParams } from '@/api/sightings';
import { useNearbySightings } from '@/hooks/useSightings';

const mockFocusContext = createContext(true);
let mockSignedIn = true;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => {
    const React = require('react');
    const focused = React.useContext(mockFocusContext);
    React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
jest.mock('@/api/sightings', () => ({ getNearby: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/observability', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useAiModeration', () => ({ screenCommentBestEffort: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ session: mockSignedIn ? { user: { id: 'guardian' } } : null }),
}));

const params = { lat: 40, lng: -74, radiusM: 3000 };

function Probe({ nearbyParams }: { nearbyParams: NearbyParams | null }) {
  useNearbySightings(nearbyParams);
  return null;
}

let client: QueryClient;
let tree: ReactTestRenderer | undefined;
let previousState: AppStateStatus;
let changeState: (state: AppStateStatus) => void;
let remove: jest.Mock;
let listener: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  previousState = AppState.currentState;
  AppState.currentState = 'active';
  mockSignedIn = true;
  jest.mocked(getNearby).mockReset().mockResolvedValue([]);
  changeState = () => {};
  remove = jest.fn();
  listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    changeState = callback;
    return { remove };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  client.clear();
  AppState.currentState = previousState;
  listener.mockRestore();
  jest.useRealTimers();
});

async function render(focused = true, nearbyParams: NearbyParams | null = params) {
  await act(async () => {
    const element = (
      <QueryClientProvider client={client}>
        <mockFocusContext.Provider value={focused}>
          <Probe nearbyParams={nearbyParams} />
        </mockFocusContext.Provider>
      </QueryClientProvider>
    );
    if (tree) tree.update(element);
    else tree = create(element);
  });
}

async function advance(ms: number) {
  await act(async () => jest.advanceTimersByTimeAsync(ms));
}

test('visible map refreshes sightings and suspends polling in the background', async () => {
  await render();
  expect(getNearby).toHaveBeenCalledTimes(1);
  await advance(30_000);
  expect(getNearby).toHaveBeenCalledTimes(2);
  await act(async () => changeState('background'));
  await advance(90_000);
  expect(getNearby).toHaveBeenCalledTimes(2);
  await act(async () => changeState('active'));
  expect(getNearby).toHaveBeenCalledTimes(3);
  await act(async () => tree?.unmount());
  tree = undefined;
  expect(remove).toHaveBeenCalledTimes(1);
});

test('leaving the map stops polling until it regains focus', async () => {
  await render();
  expect(getNearby).toHaveBeenCalledTimes(1);
  await render(false);
  expect(remove).toHaveBeenCalledTimes(1);
  await advance(90_000);
  expect(getNearby).toHaveBeenCalledTimes(1);
  await render(true);
  expect(getNearby).toHaveBeenCalledTimes(2);
});

test('mounting an unfocused map does not fetch', async () => {
  await render(false);
  await advance(90_000);
  expect(getNearby).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

test('mounting in the background waits for foreground activation', async () => {
  AppState.currentState = 'background';
  await render();
  await advance(90_000);
  expect(getNearby).not.toHaveBeenCalled();
  await act(async () => changeState('active'));
  expect(getNearby).toHaveBeenCalledTimes(1);
});

test('signed-out users never fetch, including after foregrounding or signing out', async () => {
  mockSignedIn = false;
  await render();
  await advance(30_000);
  await act(async () => changeState('background'));
  await act(async () => changeState('active'));
  expect(getNearby).not.toHaveBeenCalled();

  mockSignedIn = true;
  await render();
  expect(getNearby).toHaveBeenCalledTimes(1);
  mockSignedIn = false;
  await render();
  await advance(90_000);
  expect(getNearby).toHaveBeenCalledTimes(1);
});

test('missing search parameters never fetch', async () => {
  await render(true, null);
  await advance(90_000);
  expect(getNearby).not.toHaveBeenCalled();
});
