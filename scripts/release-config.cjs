const { Buffer } = require('node:buffer');

function releaseErrors(env, platform) {
  const errors = [];
  const real = (key) => env[key] && !/YOUR-|placeholder|example\.com/i.test(env[key]);
  if (platform && !['android', 'ios', 'web'].includes(platform))
    errors.push('Release platform must be android, ios, or web.');
  for (const key of [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EAS_PROJECT_ID',
    'EXPO_PUBLIC_SUPPORT_URL',
  ]) {
    if (!real(key)) errors.push(`Set ${key} for the production environment.`);
  }
  for (const key of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPPORT_URL']) {
    if (real(key)) {
      try {
        const url = new URL(env[key]);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          ['localhost', '127.0.0.1', '[::1]', 'release-test.supabase.co'].includes(url.hostname) ||
          /\.(test|invalid|localhost)$/.test(url.hostname)
        )
          throw new Error();
      } catch {
        errors.push(`${key} must be a production HTTPS URL without embedded credentials.`);
      }
    }
  }
  const publicKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (publicKey === 'release-test-public-anon-key')
    errors.push('Replace the smoke-test Supabase key with the production public key.');
  let role;
  try {
    role = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role;
  } catch {
    // Publishable keys need not be JWTs. This check detects known privileged keys;
    // it does not verify signatures or replace hosted authorization tests.
  }
  if (publicKey.startsWith('sb_secret_') || (role && role !== 'anon'))
    errors.push('Use only a Supabase anon/publishable key in the client environment.');
  const sentryConfigured = ['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT'].some(
    (key) => env[key],
  );
  if (sentryConfigured) {
    for (const key of ['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT'])
      if (!real(key)) errors.push(`Set ${key} to complete production Sentry configuration.`);
    if (env.EAS_BUILD_PROFILE === 'production' && platform !== 'web' && !real('SENTRY_AUTH_TOKEN'))
      errors.push('Set SENTRY_AUTH_TOKEN for production native sourcemap upload.');
  }
  if (
    real('EAS_PROJECT_ID') &&
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.EAS_PROJECT_ID)
  )
    errors.push('EAS_PROJECT_ID must be a project UUID.');
  if (platform !== 'web' && platform !== 'ios' && !real('EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY'))
    errors.push('Set EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY for Android maps.');
  return errors;
}
module.exports = { releaseErrors };
if (require.main === module) {
  const errors = releaseErrors(process.env, process.argv[2]);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Production configuration checks passed.');
}
