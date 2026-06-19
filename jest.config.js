/**
 * Jest config (SDK 56). Focused on fast, reliable unit tests of the pure logic
 * the whole app depends on — gamification math, geo, reward eligibility, and
 * the status state-machine. Component/E2E coverage is handled separately
 * (Maestro flows in .maestro/).
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  // jest-expo's default plus the extra ESM/native packages our pure modules pull in.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|date-fns|@supabase/.*|@react-native-async-storage/.*))',
  ],
};
