/** @jest-environment jsdom */
import * as Location from 'expo-location';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useCurrentLocation } from '@/hooks/useLocation';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let location: ReturnType<typeof useCurrentLocation>;
const permission = jest.mocked(Location.requestForegroundPermissionsAsync);
const position = jest.mocked(Location.getCurrentPositionAsync);

function Harness() {
  const state = useCurrentLocation();
  useLayoutEffect(() => {
    location = state;
  });
  return null;
}

beforeEach(() => {
  jest.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Harness />));
  permission.mockResolvedValue({
    granted: true,
    status: Location.PermissionStatus?.GRANTED ?? 'granted',
    canAskAgain: true,
    expires: 'never',
  } as Location.LocationPermissionResponse);
  position.mockResolvedValue({
    coords: { latitude: 40, longitude: -73 },
  } as Location.LocationObject);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('never prompts for permission on mount', () => {
  expect(permission).not.toHaveBeenCalled();
  expect(location.status).toBe('idle');
});

it('shares overlapping requests and allows a fresh request after completion', async () => {
  await act(async () => {
    const first = location.request();
    expect(location.request()).toBe(first);
    await first;
  });
  expect(permission).toHaveBeenCalledTimes(1);
  expect(position).toHaveBeenCalledTimes(1);
  expect(location.coords).toEqual({ lat: 40, lng: -73 });
  await act(async () => {
    await location.request();
  });
  expect(position).toHaveBeenCalledTimes(2);
});

it('clears old coordinates when permission is revoked and recovers when granted', async () => {
  await act(async () => {
    await location.request();
  });
  permission.mockResolvedValueOnce({
    status: 'denied',
    granted: false,
  } as Location.LocationPermissionResponse);
  await act(async () => {
    expect(await location.request()).toBeNull();
  });
  expect(location.status).toBe('denied');
  expect(location.coords).toBeNull();
  expect(position).toHaveBeenCalledTimes(1);
  await act(async () => {
    await location.request();
  });
  expect(location.status).toBe('granted');
  expect(location.coords).toEqual({ lat: 40, lng: -73 });
});

it('surfaces a position failure without throwing and permits a successful retry', async () => {
  position.mockRejectedValueOnce(new Error('Location services unavailable'));
  await act(async () => {
    expect(await location.request()).toBeNull();
  });
  expect(location.error).toBe('Location services unavailable');
  await act(async () => {
    await location.request();
  });
  expect(location.error).toBeNull();
  expect(location.status).toBe('granted');
});
