import { ExpoConfig, ConfigContext } from 'expo/config';
import { releaseErrors } from './scripts/release-config.cjs';
import { mapsPluginOptions } from './scripts/maps-config.cjs';

if (process.env.EAS_BUILD_PROFILE === 'production' || process.env.GUARDIANS_RELEASE_CHECK === '1') {
  const errors = releaseErrors(process.env, process.env.EAS_BUILD_PLATFORM);
  if (errors.length) throw new Error(`Production configuration incomplete:\n${errors.join('\n')}`);
}

/**
 * Dynamic Expo config.
 *
 * Secrets/keys are read from the environment so they never get committed.
 * Client-readable values use the EXPO_PUBLIC_ prefix (inlined into the JS
 * bundle); native Google Maps keys are injected here at build time.
 *
 * See .env.example for the full list of variables.
 */

// Sentry crash reporting. The config plugin uploads Hermes sourcemaps and
// debug symbols during EAS builds (needs SENTRY_AUTH_TOKEN set as an EAS
// secret). Only wired once the Sentry project exists (org/project slugs), so
// dev/local builds stay inert. `url` is omitted — we use sentry.io, which is
// the default (it is only needed for self-hosted instances).
const sentryPlugin: NonNullable<ExpoConfig['plugins']> =
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? [
        [
          '@sentry/react-native/expo',
          {
            organization: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
          },
        ],
      ]
    : [];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Guardians',
  slug: 'guardians',
  scheme: 'guardians',
  version: '1.0.0',
  // OTA updates: ties each update to the app version. The URL is only set once an
  // EAS project exists (run `eas update:configure`), so dev/local builds stay inert.
  runtimeVersion: { policy: 'fingerprint' },
  updates: process.env.EAS_PROJECT_ID
    ? { url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID}` }
    : undefined,
  orientation: 'portrait',
  icon: './assets/icon.png',
  // The design system is a single warm-light theme (tokens in src/theme are
  // light-only), so pin the UI to light for consistent system chrome. A true
  // dark mode would need a second palette + dynamic theming (tracked separately).
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.guardians.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Guardians uses your location to show nearby cat sightings and to tag where you spotted a cat.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Guardians uses your location to alert nearby guardians about cats that need rescue.',
      NSCameraUsageDescription:
        'Guardians needs your camera so you can photograph a cat you have spotted.',
      NSPhotoLibraryUsageDescription:
        'Guardians needs photo access so you can attach pictures of cats to your reports.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.guardians.app',
    adaptiveIcon: {
      backgroundColor: '#0E7C66',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    config: {
      googleMaps: {
        apiKey:
          process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ||
          process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    ['react-native-maps', mapsPluginOptions(process.env)],
    'expo-secure-store',
    'expo-web-browser',
    'expo-font',
    'expo-image',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#0E7C66',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Guardians uses your location to surface cat sightings near you.',
      },
    ],
    [
      'expo-image-picker',
      {
        microphonePermission: false,
        photosPermission:
          'Guardians needs photo access so you can attach pictures of cats to your reports.',
        cameraPermission:
          'Guardians needs your camera so you can photograph a cat you have spotted.',
      },
    ],
    [
      'expo-notifications',
      {
        color: '#0E7C66',
      },
    ],
    ...sentryPlugin,
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? 'f8a869e6-e03d-42f1-b84f-add62b4b23e4',
    },
  },
});
