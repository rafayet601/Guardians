/* global __dirname, __filename */
// Scoped local mitigation for GHSA-vfj7-8cjw-p6xm (braces 3.0.3).
// Remove with the exact audit exception once a compatible upstream fix is adopted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const patches = [
  {
    file: 'lib/parse.js',
    original: 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310',
    patched: '69f0829724ecf9161f60c8b202662df7a98196eb3c2a4583ddc2d2bc29b42475',
    changes: [
      [
        '    if (value === CHAR_LEFT_PARENTHESES) {',
        "    if (value === CHAR_LEFT_PARENTHESES) {\n      if (stack.length > 128) throw new RangeError('braces nesting exceeds supported depth');",
      ],
      [
        '    if (value === CHAR_LEFT_CURLY_BRACE) {',
        "    if (value === CHAR_LEFT_CURLY_BRACE) {\n      if (stack.length > 128) throw new RangeError('braces nesting exceeds supported depth');",
      ],
    ],
  },
  {
    file: 'lib/compile.js',
    original: 'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f',
    patched: 'eafc8ecfbb2e7f373e957459232568d9aed9989a15dd02fc7b8b2de22a0e6343',
    changes: [
      [
        '  const walk = (node, parent = {}) => {',
        "  const walk = (node, parent = {}, depth = 0) => {\n    if (depth > 129) throw new RangeError('braces nesting exceeds supported depth');",
      ],
      ['walk(child, node)', 'walk(child, node, depth + 1)'],
    ],
  },
  {
    file: 'lib/expand.js',
    original: '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7',
    patched: '848fd1722db357457b8ab9d3f75fca7b0946d0136685af06ddf98aed98656495',
    changes: [
      [
        '  const walk = (node, parent = {}) => {',
        "  const walk = (node, parent = {}, depth = 0) => {\n    if (depth > 129) throw new RangeError('braces nesting exceeds supported depth');",
      ],
      ['walk(child, node)', 'walk(child, node, depth + 1)'],
    ],
  },
  {
    file: 'lib/stringify.js',
    original: '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a',
    patched: 'ab7d2c383958600ced1112879a6c985a12bada34f5787b16d5b9a2c507eb4cd6',
    changes: [
      [
        '  const stringify = (node, parent = {}) => {',
        "  const stringify = (node, parent = {}, depth = 0) => {\n    if (depth > 129) throw new RangeError('braces nesting exceeds supported depth');",
      ],
      ['        output += stringify(child);', '        output += stringify(child, {}, depth + 1);'],
    ],
  },
];
const hash = (source) => crypto.createHash('sha256').update(source).digest('hex');

function installations() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([name]) =>
    name.endsWith('node_modules/braces'),
  );
  assert(entries.length > 0, 'Review braces mitigation: dependency no longer installed');
  return entries.map(([name, metadata]) => {
    assert.equal(metadata.version, '3.0.3', 'Review braces mitigation for the new version');
    const dir = path.join(ROOT, name);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version,
      '3.0.3',
    );
    return dir;
  });
}

function verifyDepth(braces, dir) {
  assert.equal(braces.compile('src/{api,hooks}/**/*.{ts,tsx}'), 'src/(api|hooks)/**/*.(ts|tsx)');
  assert.deepEqual(braces.expand('item-{1..3}'), ['item-1', 'item-2', 'item-3']);
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
  const bound = '{'.repeat(128) + 'a,b' + '}'.repeat(128);
  assert.doesNotThrow(() => braces.compile(bound));
  // Quotes, escaped characters and bracket expressions are literals, not AST nesting.
  for (const literal of [
    '"' + '{'.repeat(1000) + '"',
    '\\{'.repeat(1000),
    '[' + '{'.repeat(1000) + ']',
  ]) {
    assert.doesNotThrow(() => braces.compile(literal));
  }
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    const nested = open.repeat(4500) + 'a,b' + close.repeat(4500);
    for (const run of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => run(nested), /braces nesting exceeds supported depth/);
    }
  }
  // Public AST APIs and direct lib imports cannot bypass the parser's guard.
  const deepAst = () => {
    const root = { type: 'root', nodes: [] };
    let parent = root;
    for (let i = 0; i < 10000; i++) {
      const child = { type: 'paren', nodes: [], parent };
      parent.nodes.push(child);
      parent = child;
    }
    parent.nodes.push({ type: 'text', value: 'synthetic' });
    return root;
  };
  for (const name of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[name](deepAst()), /braces nesting exceeds supported depth/);
    assert.throws(
      () => require(path.join(dir, 'lib', name + '.js'))(deepAst()),
      /braces nesting exceeds supported depth/,
    );
  }
  assert.deepEqual(braces.expand('{good,bad}', { nodupes: true }), ['good', 'bad']);
}

function checkPatch() {
  for (const dir of installations()) {
    for (const patch of patches) {
      assert.equal(
        hash(fs.readFileSync(path.join(dir, patch.file))),
        patch.patched,
        'braces patch missing or changed',
      );
    }
    // Isolate malicious nesting from the caller and bound runtime if a future patch regresses.
    const result = spawnSync(process.execPath, [__filename, '--verify', dir], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.error, undefined, 'braces regression process failed or timed out');
    assert.equal(result.status, 0, result.stderr || 'braces nesting regression failed');
  }
}
function applyPatch() {
  for (const dir of installations()) {
    for (const patch of patches) {
      const file = path.join(dir, patch.file);
      const source = fs.readFileSync(file, 'utf8');
      if (hash(source) === patch.patched) continue;
      assert.equal(hash(source), patch.original, 'Unexpected braces source; refusing to patch');
      let modified = source;
      for (const [before, after] of patch.changes) modified = modified.replace(before, after);
      assert.equal(hash(modified), patch.patched);
      fs.writeFileSync(file, modified);
    }
  }
  checkPatch();
}
module.exports = { checkPatch };
if (require.main === module) {
  if (process.argv[2] === '--verify') verifyDepth(require(process.argv[3]), process.argv[3]);
  else applyPatch();
}
