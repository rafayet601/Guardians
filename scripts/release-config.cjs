const { Buffer } = require('node:buffer');

// This is a build-time format check, not JWT authentication. Only legacy anon
// keys and current publishable keys belong in a shipped application.
function isPublicSupabaseKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

function releaseErrors(env, platform) {
  const errors = [];
  const real = (key) =>
    env[key] &&
    !/YOUR-|placeholder|example\.com|release-test(?:\.supabase\.co|-public-anon-key)/i.test(
      env[key],
    );
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
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          /\.(test|invalid|localhost)$/.test(url.hostname)
        )
          throw new Error();
      } catch {
        errors.push(`${key} must be an HTTPS URL without embedded credentials.`);
      }
    }
  }
  if (
    real('EXPO_PUBLIC_SUPABASE_ANON_KEY') &&
    !isPublicSupabaseKey(env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    errors.push('EXPO_PUBLIC_SUPABASE_ANON_KEY must be a publishable key or legacy anon JWT.');
  }
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
