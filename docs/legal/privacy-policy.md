# Guardians Privacy Policy

**Effective date:** July 3, 2026 · **Last updated:** July 3, 2026

> **Draft for founder review** — replace the contact address if desired and have a
> qualified person review before store submission.

Guardians ("we", "us") is a community app for reporting and rescuing cats in need.
This policy explains what we collect, why, and the choices you have.

## What we collect

| Data                                                                               | Why we collect it                                       | Where it lives                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| **Account** — email, username, optional name/bio/avatar                            | Sign-in, your public profile                            | Supabase (Postgres, encrypted at rest) |
| **Precise location** — when you report a sighting or opt in as a Guardian          | Placing sightings on the map; alerting nearby Guardians | Supabase                               |
| **Photos** you attach to reports or your profile                                   | Showing the community which cat needs help              | Supabase Storage                       |
| **Activity** — reports, claims, rescues, adoptions, points, rewards                | Running the rescue lifecycle and gamification           | Supabase                               |
| **Push token + coarse home area** (only if you enable notifications)               | Sending urgent "cat nearby" alerts                      | Supabase                               |
| **Product analytics** — in-app events (e.g. "report created") tied to your account | Understanding and improving the core rescue flow        | Our own database; never sold or shared |
| **Crash diagnostics** — stack traces and device info on errors                     | Fixing bugs                                             | Sentry (our error-tracking processor)  |

We do **not** sell your data, show third-party ads, or use third-party advertising SDKs.

## How location is protected

- Sighting coordinates shown to other users are **coarsened to roughly 110 m**. Exact
  coordinates are visible only to you (the reporter) and the Guardian assigned to the rescue.
- Your "home area" for alerts is stored **only coarsened**, never as an exact point.
- Location is collected only while you use the app (no background tracking).

## Sharing

Your username, avatar, level, and the reports you make are visible to other signed-in
users — that is how the community coordinates rescues. We share data with no one else
except our processors (Supabase for hosting, Expo for push delivery, Sentry for crash
reports), who act only on our instructions.

## Retention & deletion

Your data is kept while your account exists. **You can delete your account in
Settings → Delete account**; this permanently removes your profile, reports, photos,
points, and rewards. Anonymized event rows may be retained without any link to you.

## Your rights

Depending on where you live, you may have rights to access, correct, export, or erase
your data. For any request, contact us and we will respond within 30 days.

## Children

Guardians is not directed at children under 13 (or the minimum age in your region),
and we do not knowingly collect their data.

## Changes

We will update this page and the "Last updated" date when the policy changes;
material changes will be announced in-app.

## Contact

**rafayetquader@gmail.com**
