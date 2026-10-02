/* global __dirname */
// Backport the verifier guard proposed in digitalbazaar/forge#1152.
// Remove with the audit exception once an upstream patched release is adopted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const ORIGINAL = 'fd4740238145ec26470eb3f06a627c72039538ce1307dbdce40521f94dfd0a50';
const PATCHED = 'c9b1e3799e230528b6d6815c1f6cd3c6058b9d45975264b55d995abb976589af';
const before = '            obj.value.length !== 2) {';
const after =
  "            obj.value.length !== 2 ||\n            obj.value[0].value.length !==\n              (('parameters' in capture) ? 2 : 1)) {";
const hash = (source) => crypto.createHash('sha256').update(source).digest('hex');

function installations() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([name]) =>
    name.endsWith('node_modules/node-forge'),
  );
  assert(entries.length > 0, 'Review node-forge mitigation: dependency no longer installed');
  return entries.map(([name, metadata]) => {
    assert.equal(metadata.version, '1.4.0', 'Review node-forge mitigation for the new version');
    const dir = path.join(ROOT, name);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version,
      '1.4.0',
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

function checkPatch() {
  for (const dir of installations()) {
    assert.equal(
      hash(fs.readFileSync(path.join(dir, 'lib/rsa.js'))),
      PATCHED,
      'node-forge patch missing or changed',
    );
    verifySignatures(require(dir));
  }
}
function applyPatch() {
  for (const dir of installations()) {
    const file = path.join(dir, 'lib/rsa.js');
    const source = fs.readFileSync(file, 'utf8');
    if (hash(source) === PATCHED) continue;
    assert.equal(hash(source), ORIGINAL, 'Unexpected node-forge source; refusing to patch');
    const patched = source.replace(before, after);
    assert.equal(hash(patched), PATCHED);
    fs.writeFileSync(file, patched);
  }
  checkPatch();
}
module.exports = { checkPatch, verifySignatures };
if (require.main === module) applyPatch();
