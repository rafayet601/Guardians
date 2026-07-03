// Web fallback. react-native-maps is native-only and crashes on web, so on web
// we render a friendly placeholder. Everything else in the app works on web; the
// live map is available in the iOS/Android (Expo Go) app.
import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

export const MAP_PROVIDER = undefined;

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};
export type LatLng = { latitude: number; longitude: number };

// Props are intentionally loose: this shim ignores every map-specific prop and
// only forwards `style`. Typed as `any` so screens can pass real MapView props.

export const MapView = forwardRef<unknown, any>(function MapView(props, ref) {
  // Imperative methods used by screens are no-ops on web (so optional-chained
  // calls like mapRef.current?.animateToRegion don't throw).
  useImperativeHandle(ref, () => ({ animateToRegion: () => {}, fitToCoordinates: () => {} }));
  return (
    <View style={[styles.fallback, props.style]}>
      <Text style={styles.emoji}>🗺️</Text>
      <Text variant="smallStrong" color={colors.textSecondary} center>
        Live map is available in the mobile app
      </Text>
      <Text variant="caption" muted center style={styles.hint}>
        Open Guardians in Expo Go (iOS/Android) for the interactive map.
      </Text>
    </View>
  );
});

// Markers, circles (and anything map-only) render nothing on web.
export const Marker = (_props: { [key: string]: unknown }) => null;
export const Circle = (_props: { [key: string]: unknown }) => null;

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
  },
  emoji: { fontSize: 44 },
  hint: { maxWidth: 260 },
});
