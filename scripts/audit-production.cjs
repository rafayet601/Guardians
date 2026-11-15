const { spawnSync } = require('node:child_process');
const { checkForge } = require('./check-node-forge.cjs');
const { checkPatch: checkBracesPatch } = require('./patch-braces.cjs');
const ADVISORIES = {
  braces: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
};

// Only these exact, locally patched findings and their transitive parents qualify.
// New advisories, unresolved graph edges, and audit failures still fail closed.
function unresolved(report) {
  const counts = report?.metadata?.vulnerabilities;
  const levels = ['info', 'low', 'moderate', 'high', 'critical'];
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !report?.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !counts ||
    [...levels, 'total'].some((level) => !Number.isInteger(counts[level]) || counts[level] < 0) ||
    levels.reduce((sum, level) => sum + counts[level], 0) !== counts.total
  )
    throw new Error('Incomplete npm audit response');
  const entries = report.vulnerabilities;
  for (const level of levels) {
    if (
      Object.values(entries).filter((entry) => entry?.severity === level).length !== counts[level]
    )
      throw new Error('Inconsistent npm audit counts or vulnerability entries');
  }
  function mitigated(name) {
    const seen = new Set();
    let verifiedLeaves = 0;
    function visit(current) {
      // npm's Metro graph contains legitimate cycles. Visit every edge once;
      // a cycle alone never qualifies without a verified advisory leaf.
      if (seen.has(current)) return true;
      seen.add(current);
      const entry = entries[current];
      if (!entry || !Array.isArray(entry.via) || !entry.via.length) return false;
      return entry.via.every((via) => {
        if (typeof via === 'string') return visit(via);
        const verified =
          !!ADVISORIES[current] && !!via && via.name === current && via.url === ADVISORIES[current];
        if (verified) verifiedLeaves++;
        return verified;
      });
    }
    return visit(name) && verifiedLeaves > 0;
  }
  return Object.keys(entries).filter(
    (name) => ['high', 'critical'].includes(entries[name].severity) && !mitigated(name),
  );
}
function main() {
  checkForge(); // Every installed copy is a fixed release AND rejects malformed signatures.
  checkBracesPatch(); // Hash parser/walkers AND isolate malicious nesting regression.
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
  for (const [name, advisory] of Object.entries(ADVISORIES)) {
    if (report.vulnerabilities[name])
      console.log(`Locally patched and regression-verified: ${advisory}`);
  }
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
