# Guardians: founder review and pilot plan

Review date: 2026-09-16. Based on the repository, not production traffic, customer interviews, or verified backend configuration. Proposed targets below are experiments, not industry benchmarks or traction claims.

## The business thesis

Guardians should first prove that a cat sighting leads to a responsible human response in one small service area. The product already offers reporting, rescue status changes, adoption interest, moderation, rewards, and AI assistance. More feature breadth is unlikely to resolve the central uncertainty: are enough capable responders available when someone reports a cat?

Positioning to test: “Help your neighbourhood turn cat sightings into coordinated care.” Reporters supply observations; guardians supply response capacity; rescue organisations provide continuity. Those groups have different needs. An install or a reward redemption is not a successful rescue.

Start with one neighbourhood and one or two rescue partners. Recruit responders before encouraging public reports. Document coverage hours, escalation contacts, and who owns unanswered cases. Do not promise immediate response or guaranteed rescue. Community cats are not automatically lost or suitable for adoption; partners must determine the appropriate outcome.

## Repository findings and changes

| Finding                                                         | Business consequence                                                 | This pass                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Map defaults failed/pending requests to an empty list           | A first-time user cannot distinguish no activity from an outage      | Loading, retry, stale-data notice, and filter-specific empty text                 |
| Search silently ignores failure and missing results             | People cannot tell whether their area was searched                   | Actionable feedback while preserving the current map                              |
| Legal routes are behind the root authentication redirect        | People cannot read policies before joining; public policy links fail | Allow privacy and terms independently of auth/backend setup                       |
| Welcome has duplicate sign-in actions and fixed screen sections | Unclear value and potential overflow on small screens                | Clear participation explanation, legal links, scrollable layout                   |
| Report success returns to the previous screen                   | Reporter lacks an immediate place to follow their case               | Open the newly created sighting                                                   |
| Analytics discards a lazy Supabase RPC builder                  | Funnel data may never arrive                                         | Consume the request and swallow asynchronous transport failures; regression tests |
| Reward request failures appear empty                            | Partner catalogue looks nonexistent during outages                   | Error and retry state                                                             |

Existing positives: server-owned sensitive state changes, location-gated detail RPC, moderation/blocking, redemption checks, and database tests are meaningful foundations. Presence in code does not establish deployment or operating effectiveness.

## Launch blockers still requiring evidence

1. **Rescue coverage:** a named operator and backup for the pilot; a daily queue review; a plan for stale claims and requests with no response. The current UI is not evidence of staffed dispatch.
2. **Lifecycle rehearsal:** two independent test users complete report → claim → status updates → adoption interest → handoff, including denial, duplicate taps, offline retry, and interrupted photo upload. Verify notifications on actual iOS and Android devices.
3. **Trust review:** reconcile policy copy with actual data access. For example, `app/privacy.tsx` says precise coordinates are never shown to other users, while the documented detail RPC allows the assigned guardian access. Review AI vendors/retention, support contact, deletion, and public policy URLs before launch. This review does not certify legal compliance.
4. **Deployment verification:** confirm migrations, private storage access, SMTP/email confirmation, backup restore, moderation staffing, real crash reporting, and push webhook configuration. Run pgTAP against an isolated backend; do not assume checklist checkmarks describe production.
5. **Location usability:** test denied location, manual map selection, web search support, and the default region outside the pilot city. Existing web code uses Leaflet, despite older README/production wording calling it a placeholder.
6. **Measurement quality:** client events can be missed or duplicated and are not authoritative rescue counts. Reconcile outcomes with database lifecycle history. `track_event` requires authentication, so signed-out landing views and confirmation-pending signup events cannot form a complete acquisition funnel.

## A four-week pilot

| Period | Work                                                                                                 | Evidence to keep                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Week 1 | Interview 5 rescue operators and 10 reporters/adopters; select one coverage area; rehearse incidents | Workflow pain, current alternatives, hours of coverage, named case owners             |
| Week 2 | Invite a small responder cohort; observe 5 complete reporting/rescue sessions                        | Task completion, failed steps, response delay, unanswered cases                       |
| Week 3 | Invite local reporters through partner channels; review every case daily                             | Verified outcomes, response-time distribution, safety incidents, repeat participation |
| Week 4 | Review cohorts with partners; test one paid sponsor proposal                                         | Partner renewal intent, actual fulfilment cost, paid commitment or rejection reasons  |

Pause acquisition if responders cannot keep up. Expand only when existing coverage is reliable. Do not seed public production with fictional rescues or invented testimonials.

## Weekly operating scorecard

North-star candidate: **verified cats reaching an appropriate care outcome per week**, with partner confirmation. Track return-to-owner, rescue care, adoption, and partner-managed community-cat outcomes separately; do not count lifecycle updates as additional cats.

- Response coverage: eligible reports receiving a human response within the pilot's stated service window / eligible reports. Include unresolved reports in the denominator.
- Time to response: median and 90th percentile from report to first human response; show unresolved count and age alongside percentiles to avoid survivorship bias.
- Activation: new confirmed accounts completing their first useful action within seven days / new confirmed accounts old enough to have had seven days. Separate reporter, guardian, and adopter cohorts.
- Retention: guardians completing a useful action in week four / activated guardians with four weeks of observation. Reporting itself is episodic; daily active users is a poor sole target.
- Quality: duplicate reports, withdrawn claims, flagged content, and overturned outcomes; reward activity should not improve these metrics artificially.
- Economics: realised sponsor revenue minus reward fulfilment, moderation/support labour, backend/maps/AI, and payment costs. Track cost per verified outcome and per active responder.

Initial discussion targets: 80% response within the locally agreed service window, no unattended urgent case at the daily operating review, and at least one partner willing to continue after four weeks. Adjust to partner capacity before invitations. These are proposed operating gates, not promises to users.

## Revenue hypothesis

Keep reporting and essential coordination free. Test a local pet-business sponsorship with a clear sponsored label, capped duration, fixed fulfilment budget, and aggregate reporting. Existing placements/rewards are a starting point, not evidence of advertiser demand. Sell only inventory and outcomes you can measure; never expose individual locations or imply sponsorship buys rescue priority.

Before adding subscriptions, ask rescue organisations whether shared case assignment, exports, and coordination save enough staff time to pay for. Build those tools only after repeated demand and a credible paid pilot. Avoid consumer paywalls on urgent reporting and avoid subsidising open-ended rewards without a budget.

A useful pricing worksheet is: committed revenue − direct fulfilment − service cost − allocated operating time = contribution. Leave price blank until customer conversations; downloads do not establish willingness to pay.

## Scope discipline

Defer additional AI features, broader reward catalogues, paid acquisition, and expansion into multiple cities until response coverage, verified outcomes, and partner continuation are demonstrated. Next engineering priorities are reliable case ownership/stale-claim recovery, lifecycle E2E tests, and a simple operator scorecard. Success depends on operating the local network as well as polishing software.
