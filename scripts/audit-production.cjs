const { spawnSync } = require('node:child_process');
const { checkPatch } = require('./patch-node-forge.cjs');
const ADVISORY = 'https://github.com/advisories/GHSA-86w9-cpqp-85rv';

// Only this exact, locally patched finding and its transitive parents qualify.
// New advisories, unresolved graph edges, and audit failures still fail closed.
function unresolved(report) {
  if (report.error || !report.vulnerabilities || !report.metadata)
    throw new Error('Incomplete npm audit response');
  const entries = report.vulnerabilities;
  function mitigated(name, seen = new Set()) {
    const entry = entries[name];
    if (!entry || seen.has(name) || !entry.via?.length) return false;
    const next = new Set([...seen, name]);
    return entry.via.every((via) =>
      typeof via === 'string'
        ? mitigated(via, next)
        : name === 'node-forge' && via.name === 'node-forge' && via.url === ADVISORY,
    );
  }
  return Object.keys(entries).filter(
    (name) => ['high', 'critical'].includes(entries[name].severity) && !mitigated(name),
  );
}
function main() {
  checkPatch(); // Hash every installed copy AND exercise malformed signature rejection.
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--omit=dev', '--json'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.error || ![0, 1].includes(result.status))
    throw new Error('npm audit did not complete successfully');
  const report = JSON.parse(result.stdout);
  const failures = unresolved(report);
  console.log('Raw npm advisory counts:', report.metadata.vulnerabilities);
  if (report.vulnerabilities['node-forge'])
    console.log(`Locally patched and regression-verified: ${ADVISORY}`);
  if (failures.length)
    throw new Error(`Unresolved high/critical advisories: ${failures.join(', ')}`);
  console.log('No unmitigated high/critical production advisories.');
}
module.exports = { unresolved };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
