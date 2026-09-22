import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getNearby } from '@/api/sightings';
import { useNearbySightings } from '@/hooks/useSightings';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/api/sightings', () => ({ getNearby: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/observability', () => ({ track: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));

function Probe() {
  useNearbySightings({ lat: 40, lng: -74, radiusM: 3000 });
  return null;
}

test('visible map refreshes other users sightings and suspends polling in the background', async () => {
  jest.useFakeTimers();
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  (getNearby as jest.Mock).mockResolvedValue([]);
  let changeState: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      changeState = callback;
      return { remove };
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(getNearby).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(getNearby).toHaveBeenCalledTimes(2);
    await act(async () => {
      changeState('background');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(90_000);
    });
    expect(getNearby).toHaveBeenCalledTimes(2);
    await act(async () => {
      changeState('active');
    });
    expect(getNearby).toHaveBeenCalledTimes(3);
    await act(async () => {
      tree?.unmount();
    });
    expect(remove).toHaveBeenCalled();
    tree = undefined;
  } finally {
    await act(async () => {
      tree?.unmount();
    });
    client.clear();
    AppState.currentState = previousState;
    listener.mockRestore();
    jest.useRealTimers();
  }
});
