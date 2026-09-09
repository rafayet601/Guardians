function releaseErrors(env, platform) {
  const errors = [];
  const real = (key) => env[key] && !/YOUR-|placeholder|example\.com/i.test(env[key]);
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
        if (new URL(env[key]).protocol !== 'https:') throw new Error();
      } catch {
        errors.push(`${key} must be an HTTPS URL.`);
      }
    }
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
