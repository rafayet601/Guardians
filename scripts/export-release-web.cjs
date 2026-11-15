// Validate the same environment Metro will use before producing a release bundle.
const { load } = require('@expo/env');
const { spawnSync } = require('node:child_process');
const { releaseErrors } = require('./release-config.cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const headers = require('./web-headers.cjs');

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
  if (result.status === 0) {
    // Single-page exports do not emit Router's static routes manifest. EAS
    // Hosting reads this exact SDK manifest; _headers alone is not supported.
    mkdirSync(join('dist', '_expo'), { recursive: true });
    writeFileSync(
      join('dist', '_expo', '.routes.json'),
      JSON.stringify({ headers, redirects: [] }),
    );
  }
}
