# Temporary node-forge mitigation

As of October 2, 2026, node-forge 1.4.0 is the latest published release and
GHSA-86w9-cpqp-85rv has no patched release. Expo SDK 57 pulls it through its CLI
and code-signing tools. `npm audit fix --force` proposes an incompatible
expo-updates downgrade and must not be used for this finding.

The postinstall script backports the nested DigestAlgorithm element-count check
proposed in [upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152).
It pins the expected version and verifies SHA-256 of the entire original and
patched rsa.js before writing. Unexpected versions or source changes fail the
install. Repeated installation is idempotent. Every lockfile installation of
node-forge is checked, including nested copies.

`npm run audit:production` verifies the patch and exercises valid signatures
(with and without optional NULL parameters), then rejects signed DigestInfo
structures containing extra nested elements. It runs the real npm production
audit and prints its raw counts. Only
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) and its
transitive dependency findings qualify as locally mitigated. Other high/critical
advisories, incomplete reports, network failures, and missing patches fail CI.
This is not a claim that the upstream npm advisory has disappeared.

When a reviewed upstream release fixes the advisory, adopt it within Expo's
compatible dependency range, remove the patch/postinstall hook and audit
exception, restore the standard audit command, and rerun signing and bundle
checks. Do not widen this exception to cover unrelated advisories.
