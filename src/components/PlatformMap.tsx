// Native implementation (iOS/Android). Metro uses PlatformMap.web.tsx on web.
// TypeScript also resolves this file, so screens type-check against the real
// react-native-maps types.
import RNMapView, {
  Circle as RNCircle,
  Marker as RNMarker,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
} from 'react-native-maps';

import { env } from '@/lib/env';

/**
 * Use Google Maps only when a key is configured (Google on iOS also needs a dev
 * build). Otherwise fall back to the platform default — Apple Maps on iOS, which
 * works in Expo Go with no key.
 */
export const MAP_PROVIDER =
  env.googleMapsAndroidKey || env.googleMapsIosKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

export const MapView = RNMapView;
export const Marker = RNMarker;
export const Circle = RNCircle;

export type { Region, LatLng } from 'react-native-maps';
