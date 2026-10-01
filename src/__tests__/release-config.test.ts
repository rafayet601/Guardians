const { releaseErrors } = require('../../scripts/release-config.cjs');
const configured = {
  EAS_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-publishable-key',
  EXPO_PUBLIC_SUPPORT_URL: 'https://guardians.test/support',
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: 'maps-key',
};
test('production configuration rejects placeholders and missing business contact', () => {
  expect(releaseErrors({})).not.toHaveLength(0);
  expect(releaseErrors({ ...configured, EXPO_PUBLIC_SUPPORT_URL: '' })).toContain(
    'Set EXPO_PUBLIC_SUPPORT_URL for the production environment.',
  );
});
test('production rejects the browser smoke-test backend and key', () => {
  expect(
    releaseErrors(
      {
        ...configured,
        EXPO_PUBLIC_SUPABASE_URL: 'https://release-test.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'release-test-public-anon-key',
      },
      'web',
    ),
  ).toEqual([
    'Set EXPO_PUBLIC_SUPABASE_URL for the production environment.',
    'Set EXPO_PUBLIC_SUPABASE_ANON_KEY for the production environment.',
  ]);
});
test('web builds do not need native Maps keys', () => {
  expect(releaseErrors({ ...configured, EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: '' }, 'web')).toEqual(
    [],
  );
  expect(
    releaseErrors({ ...configured, EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: '' }, 'android'),
  ).not.toHaveLength(0);
});
test('iOS can release with Apple Maps without an Android key', () => {
  expect(releaseErrors({ ...configured, EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: '' }, 'ios')).toEqual(
    [],
  );
});
test('web release export stops before Metro when production settings are missing', () => {
  const { spawnSync } = require('node:child_process');
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join, resolve } = require('node:path');
  const cwd = mkdtempSync(join(tmpdir(), 'guardians-release-'));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(configured)) delete env[key];
    const result = spawnSync(process.execPath, [resolve('scripts/export-release-web.cjs')], {
      cwd,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Set EXPO_PUBLIC_SUPPORT_URL');
    expect(result.stderr).not.toContain('GOOGLE_MAPS_ANDROID');
    expect(result.stdout).not.toContain('Starting Metro');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
test('the patched query-string dependency decodes malformed inputs safely', () => {
  const qs = require('query-string');
  expect(qs.parse('cat=lost%20cat').cat).toBe('lost cat');
  expect(typeof qs.parse(`cat=${'%FF'.repeat(10000)}`).cat).toBe('string');
  expect(qs.stringify({ cat: 'lost cat' })).toBe('cat=lost%20cat');
});
