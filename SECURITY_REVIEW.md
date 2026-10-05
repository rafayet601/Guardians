# Security review — 2026-10-01

Reviewed current `main` at `7ce32b94c01666c63eb765dd7b8c51b0f26a8ed5`.
Changes are on `fix/security-hardening` in this checkout. This review covers
repository code, dependency advisories, and local regression tests. It is not
a certification that the app has no vulnerabilities, or proof of hosted deployment.

## Confirmed issues addressed

| Area                | Finding and change                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database writes     | Direct inserts could supply protected sighting/lost-cat lifecycle fields and timestamps. Migration `0039_database_security.sql` restricts creation to the existing RPCs and limits direct comment/photo inserts to client-owned columns.                                                                                                            |
| Rate limits         | Counting existing rows allowed deletion and concurrent requests to evade quotas. AI requests consumed quota only after provider responses. Private, locked quota reservations now survive domain-row deletion and reserve AI capacity before provider work.                                                                                         |
| Location privacy    | Detail and claim RPCs did not consistently enforce block/hidden-report visibility. The migration checks visibility before returning records or assigning a claim that reveals precise coordinates.                                                                                                                                                  |
| ID evidence         | Screening could reference another applicant's document paths, and uploaded evidence could change without invalidating an approval. SQL and Edge validation bind paths to the applicant; referenced uploads cannot be overwritten/deleted by clients. Verification starts only for submitted evidence and conditionally updates the version it read. |
| Push abuse          | The deprecated client path allowed a sighting owner to replay broadcasts. `send-push` now requires the server webhook secret; existing database lifecycle triggers remain the source of delivery.                                                                                                                                                   |
| Account privacy     | Delayed profile/screening mutation results could repopulate another account's cache. Account-generation checks discard stale results, reset the screening form on identity changes, and stop stale screening/report submission steps after a switch.                                                                                                |
| Telemetry and links | Automatically collected URLs could include callback or signed-document credentials. Telemetry redaction removes sensitive fields and URL parameters. Sponsored links accept only ordinary HTTP(S) URLs without embedded credentials.                                                                                                                |
| Request size        | Image endpoints parsed unbounded request bodies before validation. Bounded streaming JSON reads reject oversized bodies, including requests without a trustworthy Content-Length.                                                                                                                                                                   |

The storage photo parser also accepted doubly encoded traversal segments. The
Storage SDK could normalize these into a different bucket while using its
service-role client. The shared parser now rejects encoded traversal and URL
delimiters before any download; regression tests cover private-bucket escapes.

## Additional hardening

- Production configuration rejects secret/service-role Supabase keys, malformed
  public keys, and credentials embedded in public URLs. This is a configuration
  check, not verification of a JWT signature or the hosted backend.
- CI explicitly uses read-only repository permissions and does not persist its
  checkout credential for subsequent dependency/test commands.
- `public/_headers` disables framing, sends no referrer, disables MIME sniffing,
  restricts camera/location to the same origin, and disables microphone access.
  The CSP limits framing, base URLs, and embedded objects; it is not a complete
  script-source policy. The file is included in the web export.

## Validation

- `npm ci`: clean lockfile installation succeeded.
- `npm audit --json`: **0 known vulnerabilities** across production and development dependencies on 2026-10-01; no forced dependency upgrades were needed.
- Tracked-text-file pattern scan: no matching private-key, GitHub token, Supabase secret, provider secret, AWS access-key, or non-anon JWT values. This was not a full Git-history or external-secret-store audit.
- App and test TypeScript checks, ESLint, Prettier, and `git diff --check`: passed.
- Jest: **373 tests across 40 suites passed**.
- Deno: **12 tests passed**; all **15 Edge Function entrypoints** type-check and lint passes.
- Playwright: **32 browser tests passed** with a mocked backend. All **5 affected reporting/photo cases** passed again after the final account-switch guard.
- Database: **254 assertions across 15 pgTAP suites passed** in a disposable schema-only clone of the local database through migration `0038`, with repository seed rows and the new migration applied. This was not a fresh replay of every historical migration or a production database test.
- Migration rollout: pre-existing foreign-owner, query-alias, and trailing-space document references were cleared and their approvals/sessions reset; a valid approval remained unchanged.
- Actual concurrency: **24 parallel requests against a limit of 5 yielded exactly 5 allowed, 19 denied, and 5 stored reservations**. The reproducible `supabase/tests/check_rate_limit_concurrency.py` harness now runs in database CI.
- Web, iOS, and Android bundle exports passed. The exported web `_headers` file matches the source. Native binaries and physical-device behavior were not tested.
- The disposable database was removed after validation; the original local database and hosted services were not modified.

## Hosted rollout and remaining verification

These changes have **not** been applied to hosted Supabase or a released app.

1. Reconcile the hosted migration history with the repository. Existing hosted
   migrations may use timestamps instead of the local numeric prefixes. Apply
   only the missing `0039_database_security.sql` after migrations through `0038`;
   do not replay base migrations or blindly run `supabase db push`. The migration
   clears previously stored invalid document references and resets their approval
   and verification session so those applicants must resubmit valid evidence;
   valid evidence and approvals are preserved.
2. Deploy the changed Edge Functions: `send-push`, `screening-verify`,
   `screening-webhook`, `ai-embed`, `ai-moderate-photo`, `ai-report-autofill`,
   `ai-reid`, and `ai-lost-match`. The last two import the fixed storage helper.
   Keep `verify_jwt = false` for the two webhook endpoints and their in-handler
   shared-secret checks. Verify the push secret matches the private database
   configuration; do not log or bundle either secret.
3. Release the app/web changes. Cloudflare Pages and Netlify consume `_headers`;
   configure equivalent response headers on other hosts and check actual responses.
4. Test two real accounts against staging: switching accounts during screening,
   moderator review of ID photos, blocked/hidden sightings, legitimate rescue
   creation, webhook push delivery, rate limiting, and deletion with ID uploads.
5. Independently verify production email confirmation/SMTP, exact redirect
   allowlists, provider credentials, restricted Maps keys, storage policies,
   backups, and signed-device behavior. Local tests do not establish those settings.

If credential exposure is discovered outside this tracked-file review, rotate
the affected credential; removing it from a file alone does not revoke it.

## Reference guidance

- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase database function security](https://supabase.com/docs/guides/database/functions)
- [Supabase public and secret API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Cloudflare Pages response headers](https://developers.cloudflare.com/pages/configuration/headers/)

## October 2 CI follow-up

The October 1 zero-advisory result above was time-specific. GitHub's October 2
run flags GHSA-86w9-cpqp-85rv in node-forge and its Expo dependency chain. There
is no published patched release. A checksum-verified local backport now rejects
the malformed signatures; CI verifies that mitigation before allowing only
that exact advisory. Raw audit findings remain visible. See
[dependency mitigation details](docs/DEPENDENCY_SECURITY.md).
