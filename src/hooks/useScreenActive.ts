import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True while the screen is focused AND the app is in the foreground. Polling is
 * gated on this so a screen the user has left, or a backgrounded app, never
 * keeps hitting the API.
 */
export function useScreenActive(): boolean {
  const [active, setActive] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setActive(AppState.currentState === 'active');
      const subscription = AppState.addEventListener('change', (state) => {
        setActive(state === 'active');
      });
      return () => {
        subscription.remove();
        setActive(false);
      };
    }, []),
  );
  return active;
}
