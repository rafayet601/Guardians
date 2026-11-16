# Temporary dependency mitigations

## node-forge (resolved upstream)

From October 2 to November 15, 2026 this repository carried a checksum-verified
backport for GHSA-86w9-cpqp-85rv, because node-forge 1.4.0 was the latest
release and had no fix. node-forge 1.4.3 fixes that advisory and the later ones
affecting 1.4.2 and earlier, and it sits inside the `^1.3.3` range Expo SDK 57
asks for. The lockfile now resolves 1.4.3, and the backport, its postinstall
step and its audit exception have been removed.

`scripts/check-node-forge.cjs` keeps the regression without patching anything.
It fails if any installed copy is older than 1.4.3, and it still signs and
verifies valid signatures (with and without the optional NULL parameters) and
requires signed DigestInfo structures with extra nested elements to be
rejected. `npm run audit:production` runs it before the npm audit, so a
downgrade fails CI. A node-forge advisory is no longer excused by the gate.

The same update moved `shell-quote` to 1.12.0 (GHSA-pqg4-j6r4-53mv), `zod` to
4.6.7 (GHSA-mrhx-c7xc-m3w5), `@expo/cli` to 57.0.34, which no longer ships its
own zod 3, and the `decode-uri-component` override to 0.5.1
(GHSA-qr28-fpjm-wq7f). All are in-range updates; `npm audit fix --force` was
not used.

## braces nesting denial of service

As of October 5, 2026, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects braces through 3.0.3 and has no upstream patched release. The installed
copy is used by Metro and Jest through micromatch. Application user data is not
passed to braces by the inspected client; untrusted glob/AST input can still
exhaust a Node build or test process. The npm fix proposals downgrade Expo or
move the test toolchain to another major version and are unsuitable for SDK 57.

`scripts/patch-braces.cjs` applies a local depth guard to the parser and the
compile, expand and stringify walkers. Parsed brace/parenthesis nesting is
limited to 128 levels; walkers allow the corresponding root/leaf overhead and
also defend direct AST APIs and direct library imports. It hashes the full
original/patched files, pins braces 3.0.3, checks every lockfile installation,
and refuses unexpected source or versions. Installing twice is idempotent.
This is a scoped local mitigation, not an upstream release or a claim that the
advisory is eliminated.

A bounded child process verifies 4,500-level brace/parenthesis strings below
the existing character limit and 10,000-level synthetic ASTs reject with a
controlled error. Normal globs, numeric ranges, boundary depth, quoted strings,
escaped braces and bracket literals continue to work. The audit gate checks
these regressions and hashes before accepting this exact advisory and its
transitive findings. Dependency cycles qualify only when every reachable leaf
is an exact mitigated advisory; unknown/missing leaves, incomplete audit counts,
new findings and absent patches fail closed. Raw npm counts remain visible.

Reassess the remaining exception at each release. Adopt a compatible reviewed
upstream fix when available, then remove the patch, postinstall command and
exception and repeat exports/tests. Do not use `npm audit fix --force` or widen
the exception to unrelated findings.
