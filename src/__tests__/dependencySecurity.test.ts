const { checkForge, atLeastMinimum } = require('../../scripts/check-node-forge.cjs');
const { unresolved } = require('../../scripts/audit-production.cjs');
// The exception logic is exercised with the one advisory that still has a
// local mitigation (braces); node-forge is fixed upstream and has none.
const advisory = {
  name: 'braces',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
};
const metadata = (high = 0) => ({
  vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high },
});
const report = (via: unknown[]) => ({
  auditReportVersion: 2,
  metadata: metadata(2),
  vulnerabilities: {
    braces: { severity: 'high', via },
    expo: { severity: 'high', via: ['braces'] },
  },
});
test('every installed forge copy is a fixed release and rejects nested garbage', () => {
  checkForge();
  expect(atLeastMinimum('1.4.3')).toBe(true);
  expect(atLeastMinimum('1.5.0')).toBe(true);
  expect(atLeastMinimum('2.0.0')).toBe(true);
  expect(atLeastMinimum('1.4.2')).toBe(false);
  expect(atLeastMinimum('1.4.0')).toBe(false);
  expect(atLeastMinimum('not-a-version')).toBe(false);
});
test('a node-forge advisory is no longer excused by the audit gate', () => {
  const forge = {
    name: 'node-forge',
    url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
  };
  expect(
    unresolved({
      auditReportVersion: 2,
      metadata: metadata(1),
      vulnerabilities: { 'node-forge': { severity: 'high', via: [forge] } },
    }),
  ).toEqual(['node-forge']);
});
test('the audit exception covers only the patched advisory and its dependency chain', () => {
  expect(unresolved(report([advisory]))).toEqual([]);
  expect(
    unresolved(report([advisory, { ...advisory, url: 'https://example.test/new-advisory' }])),
  ).toEqual(['braces', 'expo']);
  expect(unresolved(report(['missing-dependency']))).toEqual(['braces', 'expo']);
  expect(unresolved(report(['expo']))).toEqual(['braces', 'expo']);
  expect(
    unresolved({
      auditReportVersion: 2,
      metadata: metadata(1),
      vulnerabilities: { other: { severity: 'high', via: [{ name: 'other' }] } },
    }),
  ).toEqual(['other']);
});
test('audit errors and incomplete reports cannot pass', () => {
  expect(() => unresolved({ error: { code: 'ENOTFOUND' } })).toThrow();
  expect(() => unresolved({ vulnerabilities: {} })).toThrow();
  expect(() => unresolved({ ...report([advisory]), metadata: metadata() })).toThrow();
  expect(() =>
    unresolved({ auditReportVersion: 2, vulnerabilities: 'invalid', metadata: metadata() }),
  ).toThrow();
  expect(() => unresolved({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} })).toThrow();
  expect(() =>
    unresolved({
      ...report([advisory]),
      metadata: { vulnerabilities: { ...metadata().vulnerabilities, total: 1 } },
    }),
  ).toThrow();
});

const { checkPatch: checkBracesPatch } = require('../../scripts/patch-braces.cjs');
const bracesAdvisory = advisory;
test('every braces copy bounds malicious strings and direct AST walkers without breaking normal patterns', () => {
  checkBracesPatch();
});
test('cycles qualify only when all reachable leaves are exact mitigated findings', () => {
  const graph = {
    auditReportVersion: 2,
    metadata: metadata(4),
    vulnerabilities: {
      braces: { severity: 'high', via: [bracesAdvisory] },
      micromatch: { severity: 'high', via: ['braces'] },
      metro: { severity: 'high', via: ['metro-config', 'micromatch'] },
      'metro-config': { severity: 'high', via: ['metro'] },
    },
  };
  expect(unresolved(graph)).toEqual([]);
  graph.vulnerabilities.braces.via.push({
    ...bracesAdvisory,
    url: 'https://example.test/new-advisory',
  });
  expect(unresolved(graph)).toEqual(['braces', 'micromatch', 'metro', 'metro-config']);
  graph.vulnerabilities.braces.via = [{ ...bracesAdvisory, name: 'wrong-package' }];
  expect(unresolved(graph)).toEqual(['braces', 'micromatch', 'metro', 'metro-config']);
});
