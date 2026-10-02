const { checkPatch } = require('../../scripts/patch-node-forge.cjs');
const { unresolved } = require('../../scripts/audit-production.cjs');
const advisory = {
  name: 'node-forge',
  url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
};
const report = (via: unknown[]) => ({
  metadata: {},
  vulnerabilities: {
    'node-forge': { severity: 'high', via },
    expo: { severity: 'high', via: ['node-forge'] },
  },
});
test('every installed forge copy accepts valid signatures and rejects nested garbage', () => {
  checkPatch();
});
test('the audit exception covers only the patched advisory and its dependency chain', () => {
  expect(unresolved(report([advisory]))).toEqual([]);
  expect(
    unresolved(report([advisory, { ...advisory, url: 'https://example.test/new-advisory' }])),
  ).toEqual(['node-forge', 'expo']);
  expect(unresolved(report(['missing-dependency']))).toEqual(['node-forge', 'expo']);
  expect(unresolved(report(['expo']))).toEqual(['node-forge', 'expo']);
});
test('audit errors and incomplete reports cannot pass', () => {
  expect(() => unresolved({ error: { code: 'ENOTFOUND' } })).toThrow();
  expect(() => unresolved({ vulnerabilities: {} })).toThrow();
});
