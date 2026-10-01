// Validate the same environment Metro will use before producing a release bundle.
const { load } = require('@expo/env');
const { spawnSync } = require('node:child_process');
const { releaseErrors } = require('./release-config.cjs');

process.env.NODE_ENV = 'production';
load(process.cwd(), { silent: true });
const errors = releaseErrors(process.env, 'web');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--clear'],
    {
      stdio: 'inherit',
      env: { ...process.env, GUARDIANS_RELEASE_CHECK: '1', EAS_BUILD_PLATFORM: 'web' },
    },
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
