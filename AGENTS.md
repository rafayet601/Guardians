# Working in this repo

## ⚠️ Expo SDK 56 has changed

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before
writing native/Expo code. Several `app.json`/config fields were removed
(`splash`, `newArchEnabled`, `android.edgeToEdgeEnabled`); New Architecture is on
by default; Reanimated 4 needs `react-native-worklets` (the worklets babel plugin
is auto-added by `babel-preset-expo`).

## What this app is

**Guardians** — a cross-platform (iOS/Android) community app for rescuing feral &
lost cats: report sightings on a live Google Map, Guardians claim & complete
rescues, Adopters give cats forever homes. Gamified (points/levels/badges).

## Stack

Expo Router (file-based, typed routes) · React Query · Supabase (Postgres +
PostGIS, Auth, Storage) · `react-native-maps` (Google) · React Hook Form + Zod.

## Conventions

- Path alias `@/*` → `src/*`.
- UI primitives live in `src/components/ui` (import via the barrel `@/components/ui`).
- Design tokens in `src/theme` — never hardcode colors/spacing.
- Data access goes through `src/api/*`, consumed via `src/hooks/*` (React Query).
- Sensitive DB writes (points, status) happen ONLY via SECURITY DEFINER RPCs in
  `supabase/migrations/0002_functions.sql` — never write those columns from the client.
- For dialogs use `@/lib/dialog` (`confirmAsync`, `notify`, `choosePhotoSource`) — NOT
  React Native's `Alert`, which is a no-op on web. Maps are imported from
  `@/components/PlatformMap` (native map + web placeholder), never `react-native-maps` directly.
- Run `npm run typecheck` before considering a change done.

See README.md, PRODUCTION.md, and supabase/README.md for the full picture.
