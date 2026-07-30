import * as Location from 'expo-location';
import { useCallback, useState } from 'react';

export interface Coords {
  lat: number;
  lng: number;
}

type LocationStatus = 'idle' | 'loading' | 'granted' | 'denied';

/**
 * Exposes the device's foreground location via an explicit `request()` — the
 * OS prompt NEVER fires on mount (P1-1: a value-explaining primer must appear
 * first, and the caller owns that flow). Never throws — denial is surfaced via
 * `status` so the UI can fall back to a default region.
 *
 * Note: `Location.requestForegroundPermissionsAsync` is prompt-free when the
 * permission is already decided (granted, or denied with canAskAgain=false),
 * so callers may safely invoke `request()` for returning users.
 */
export function useCurrentLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (): Promise<Coords | null> => {
    setStatus('loading');
    setError(null);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return null;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      setStatus('granted');
      return next;
    } catch (e) {
      setStatus('denied');
      setError(e instanceof Error ? e.message : 'Location unavailable');
      return null;
    }
  }, []);

  // `location` is the primary field; `coords` is kept as a read alias so the
  // existing call sites keep working unchanged.
  return { location: coords, coords, status, error, request };
}
