import { Platform } from 'react-native';
import RNMapView, {
  Circle as RNCircle,
  Marker as RNMarker,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
} from 'react-native-maps';

import { env } from '@/lib/env';

export const MAP_PROVIDER =
  Platform.OS === 'android'
    ? (env.googleMapsAndroidKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT)
    : (env.googleMapsIosKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT);

export const MapView = RNMapView;
export const Marker = RNMarker;
export const Circle = RNCircle;

export type { Region, LatLng } from 'react-native-maps';
