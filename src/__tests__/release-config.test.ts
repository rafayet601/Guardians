const { releaseErrors } = require('../../scripts/release-config.cjs');
const configured = {
  EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-publishable-key',
  EXPO_PUBLIC_SUPPORT_URL: 'https://guardians.org/support',
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'maps-key',
};
test('production configuration rejects placeholders and missing business contact', () => {
  expect(releaseErrors({})).not.toHaveLength(0);
  expect(releaseErrors({ ...configured, EXPO_PUBLIC_SUPPORT_URL: '' })).toContain(
    'Set EXPO_PUBLIC_SUPPORT_URL for the production environment.',
  );
});
test('web builds do not need native Maps keys', () => {
  expect(releaseErrors({ ...configured, EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: '' }, 'web')).toEqual(
    [],
  );
  expect(
    releaseErrors({ ...configured, EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: '' }, 'android'),
  ).not.toHaveLength(0);
});
test('release configuration rejects smoke-test backends and privileged client keys', () => {
  expect(
    releaseErrors(
      { ...configured, EXPO_PUBLIC_SUPABASE_URL: 'https://release-test.supabase.co' },
      'web',
    ),
  ).not.toEqual([]);
  expect(
    releaseErrors(
      { ...configured, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'release-test-public-anon-key' },
      'web',
    ),
  ).not.toEqual([]);
  for (const key of [
    'sb_secret_private',
    `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`,
  ]) {
    expect(releaseErrors({ ...configured, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }, 'web')).not.toEqual(
      [],
    );
  }
});
test('release configuration rejects nonproduction URLs and incomplete diagnostics', () => {
  for (const url of [
    'http://guardians.org',
    'https://localhost',
    'https://guardians.test',
    'https://user:password@guardians.org',
  ]) {
    expect(releaseErrors({ ...configured, EXPO_PUBLIC_SUPPORT_URL: url }, 'ios')).not.toEqual([]);
  }
  expect(releaseErrors(configured, 'unknown')).not.toEqual([]);
  expect(
    releaseErrors({ ...configured, EXPO_PUBLIC_SENTRY_DSN: 'https://sentry.io/dsn' }, 'ios'),
  ).not.toEqual([]);
  expect(releaseErrors(configured, 'ios')).toEqual([]);
});
test('the patched query-string dependency decodes malformed inputs safely', () => {
  const qs = require('query-string');
  expect(qs.parse('cat=lost%20cat').cat).toBe('lost cat');
  expect(typeof qs.parse(`cat=${'%FF'.repeat(10000)}`).cat).toBe('string');
  expect(qs.stringify({ cat: 'lost cat' })).toBe('cat=lost%20cat');
});
