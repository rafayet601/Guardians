# Design and usability review — October 1, 2026

This pass reviewed the main browsing screens, shared UI primitives, location handling, query recovery, report/adoption flows, account cache boundaries, and the ID verification endpoint. It builds on main at `9a9c7a7` and preserves the green, cream, and honey identity. It is a focused code and usability review, not a complete security audit or a production deployment certification.

## Findings addressed

| Finding                                                                                                                  | Change                                                                                                                                                                                       | Evidence                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuring a Veriff/Onfido secret created a pending provider session without creating an actual verification flow.      | Unintegrated providers always use the manual review queue; no invented external session is recorded.                                                                                         | Mocked Deno endpoint test exercises manual, Veriff, and Onfido with configured secrets, verifies stored/returned provider and retained document paths, and checks unauthenticated requests cannot update screening. |
| A transient GPS failure was classified as permission denial, disabling the native user-location layer.                   | Separate permission from position status; preserve a last known position during GPS failure and clear it when permission is revoked.                                                         | Hook tests cover initial failure, overlapping requests, retry, revoked permission, and failed refresh after a successful position.                                                                                  |
| Cached feed, reward, and ranking results remained visible after a failed refresh without explaining they could be stale. | Add a nonblocking notice with an explicit retry while retaining the loaded content.                                                                                                          | Browser checks simulate failure and successful recovery on all three screens.                                                                                                                                       |
| Feed pagination failure had no retry control and could be triggered again by reaching the end.                           | Show a page-specific retry and suppress automatic requests while the query is fetching or has failed.                                                                                        | Browser check verifies the configured retry count, no further automatic requests, and recovery of the missing page.                                                                                                 |
| A filtered empty feed always asked for another report.                                                                   | Explain the selected stage and offer a working reset to all sightings.                                                                                                                       | Browser check verifies filtering is sent to the backend, empty/reset behavior, and map navigation.                                                                                                                  |
| Selected feed filters were not exposed to browser accessibility APIs.                                                    | Use checked radio semantics and support arrows, Home/End, Space, and a single tab stop for the filter group. Shared buttons expose busy/disabled states and have at least a 44-point height. | Browser checks assert checked state and keyboard focus/selection.                                                                                                                                                   |
| Several status labels and the urgent badge had low text contrast.                                                        | Add darker status text tokens and use the existing deeper urgent orange for white badge text.                                                                                                | Calculated foreground/background contrast for all seven status labels and the urgent badge exceeds 4.5:1. This is not a full accessibility audit.                                                                   |

## Design changes

The community screen now has a compact page title, an illustrated route to the nearby map, clear stage descriptions, a web-accessible refresh action, and a scrollable header. Photo cards have smaller landscape images, readable status labels below the image, and an explicit details affordance. At 800 pixels and wider, sightings use two columns within a 1120-pixel content area. Smaller screens retain one column, and lists remain virtualized.

The existing compressed WebP garden artwork is reused instead of adding an asset or loading the 2.7 MB source PNG. The rewards page has a shorter title and a static wallet motif instead of continuous shimmer/bobbing animation. Rewards and rankings both expose refresh/retry controls. Real sighting photos, unavailable-photo states, and clearly labeled demo photos remain distinct.

## Validation

- App and test TypeScript checks, ESLint, Prettier, and `git diff --check`: passed.
- Jest: 36 suites, 344 tests passed.
- Browser suite: all 30 tests passed; the final design suite passed all 9 tests, including two additional rewards/rankings recovery cases (32 unique browser cases overall).
- Browser coverage includes 320/390/1440-pixel feed layouts, backend filters, filtered empty recovery, map navigation, keyboard selection, cached refresh recovery, pagination recovery, and existing report/rescue/adoption/moderation/public-account flows.
- Expo export succeeded for iOS, Android, and web. This verifies bundling, not native device behavior.
- Deno: all Edge Functions type-check and lint; all 4 shared/endpoint tests pass.
- Screenshots use mocked Supabase responses and bundled labeled demo photographs. No real user, report, verification record, or production configuration was changed.

## Screenshots

- [Community — 320 px](community-320.png)
- [Community — 390 px](community-390.png)
- [Community — 1440 px](community-1440.png)
- [Rewards — 320 px](rewards-320.png)
- [Rankings — 320 px](leaderboard-320.png)

## Deployment boundary

Native iOS/Android devices, Google Maps credentials/tiles, live authentication and backend operations, production migrations, and store submission were not validated in this pass. The screening endpoint correction must be deployed before production receives it. Third-party ID providers remain unintegrated; the supported path is manual review by the application's moderators.
