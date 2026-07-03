// Sentry's wrapper around Expo's default Metro config: adds the serializer that
// emits debug IDs so release-build stack traces symbolicate. Behaves exactly like
// getDefaultConfig when Sentry upload env vars are absent (dev/CI).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
