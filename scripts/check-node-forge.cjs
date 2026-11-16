/* global __dirname */
// node-forge <= 1.4.2 has signature-verification advisories (first among them
// GHSA-86w9-cpqp-85rv). This repo used to backport a fix; upstream 1.4.3 now
// carries it, so nothing is patched. This check keeps every installed copy at
// or above the fixed release and keeps the malformed-signature regression.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const MINIMUM = [1, 4, 3];

function atLeastMinimum(version) {
  const parts = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < MINIMUM.length; i++) {
    if (!Number.isInteger(parts[i])) return false;
    if (parts[i] !== MINIMUM[i]) return parts[i] > MINIMUM[i];
  }
  return true;
}

function installations() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([name]) =>
    name.endsWith('node_modules/node-forge'),
  );
  assert(entries.length > 0, 'Review the node-forge check: dependency no longer installed');
  return entries.map(([name, metadata]) => {
    const dir = path.join(ROOT, name);
    const installed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    for (const version of [metadata.version, installed])
      assert(
        atLeastMinimum(version),
        `node-forge ${version} predates ${MINIMUM.join('.')}: upgrade it`,
      );
    return dir;
  });
}

function verifySignatures(forge) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 65537 });
  const md = forge.md.sha256.create().update('Guardians signing regression');
  const digest = md.digest().getBytes();
  assert.equal(keys.publicKey.verify(digest, keys.privateKey.sign(md)), true);
  const a = forge.asn1;
  const create = (type, constructed, value) =>
    a.create(a.Class.UNIVERSAL, type, constructed, value);
  for (const includeNull of [false, true]) {
    const algorithm = [create(a.Type.OID, false, a.oidToDer(forge.oids.sha256).getBytes())];
    if (includeNull) algorithm.push(create(a.Type.NULL, false, ''));
    const encode = () =>
      a
        .toDer(
          create(a.Type.SEQUENCE, true, [
            create(a.Type.SEQUENCE, true, algorithm),
            create(a.Type.OCTETSTRING, false, digest),
          ]),
        )
        .getBytes();
    assert.equal(keys.publicKey.verify(digest, keys.privateKey.sign(encode(), 'NONE')), true);
    algorithm.push(create(a.Type.OCTETSTRING, false, 'unconsumed garbage'));
    assert.throws(
      () => keys.publicKey.verify(digest, keys.privateKey.sign(encode(), 'NONE')),
      /DigestInfo/,
    );
  }
}

function checkForge() {
  for (const dir of installations()) verifySignatures(require(dir));
}
module.exports = { checkForge, verifySignatures, atLeastMinimum };
if (require.main === module) checkForge();
