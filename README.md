<div align="center">
  <h1>Guardians</h1>
  <p><strong>A community-driven platform for rescuing feral and lost cats.</strong></p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white" alt="Expo" />
  <img src="https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React Native" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
</p>

## The Vision

Every day, countless cats find themselves lost, injured, or abandoned. **Guardians** bridges the gap between those who spot cats in need and those who have the resources to help. 

- **Spot a cat in need?** Report it on our live, interactive map.
- **Ready to answer the call?** Step up as a **Guardian** to claim the rescue.
- **Looking for a furry friend?** Become an **Adopter** and offer a forever home.

By gamifying the rescue process with points, levels, and badges, we're building a network of heroes where doing good feels incredibly rewarding.

---

## Key Features

- **Live Sighting Map:** PostGIS-powered geospatial search to discover cats needing help within your radius. Filter by "needs help" or "adoptable".
- **Instant Reporting:** Drop an exact map-pin, snap photos, and flag urgency, temperament, and injuries.
- **Rescue Lifecycle:** Secure, server-side state transitions tracking a cat's journey: `Spotted` → `Claimed` → `In Rescue` → `Safe` → `Available` → `Adopted`.
- **Gamification Engine:** Earn points for every good deed. Level up, climb the leaderboard, and unlock exclusive community badges.
- **Community Timeline:** Real-time activity feeds and comments on every rescue mission.
- **Adoption Flow:** Streamlined matching between rescuers and prospective adopters.
- **Secure Auth:** Email/password authentication with persisted sessions and rigorous Row Level Security.

## Tech Stack

| Layer | Choice |
|------|--------|
| **App** | Expo SDK 56, React Native 0.85, React 19, TypeScript |
| **Navigation** | Expo Router (file-based, typed routes) |
| **Server State** | TanStack Query |
| **Backend** | Supabase — Postgres + PostGIS, Auth, Storage, Edge Functions |
| **Maps** | `react-native-maps` (Google provider) |
| **Forms** | React Hook Form + Zod |

## Prerequisites

- Node 18+ and npm
- A [Supabase](https://app.supabase.com) project
- A Google Maps API key (Maps SDK for Android & iOS) from the [Google Cloud Console](https://console.cloud.google.com)
- For full native Google Maps / camera capabilities: an **EAS dev build** (Expo Go works for standard UI iteration)

## Setup & Local Development

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Open .env and fill in EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, and your Google Maps keys.

# 3. Set up the database
# Run the SQL migrations in supabase/migrations/ (0001 → 0011) in order.
# Optionally run supabase/seed.sql for demo data. See supabase/README.md for details.

# 4. Start the development server
npx expo start
```

> **Note:** If the app opens to a "finish your setup" screen, your `.env` variables have not been configured properly.

### Expo Go vs. Development Build

- **Expo Go** is excellent for iterating on UI, auth, and data logic. Note that Google Maps on iOS and native camera integrations require a development build.
- **Development Build** (Recommended once you have your API keys):
  ```bash
  npm install -g eas-cli
  eas login
  eas init  # Generates an EAS_PROJECT_ID — add it to your .env
  eas build --profile development --platform ios  # or android
  ```

## Gamification & Rewards

Doing good earns you points. Here is the current reward structure:

| Action | Points Earned |
|--------|-------:|
| Report a cat | **+10** |
| Claim a rescue | **+15** |
| Complete a rescue (mark as "safe") | **+50** |
| Adopt a cat | **+25** |
| Place a cat in a forever home (Lister) | **+30** |

**Levels:** Automatically scale based on the formula: `level = floor(sqrt(points / 50)) + 1`
**Badges:** Awarded automatically by the database upon hitting milestones (e.g. `Rescue Hero`, `Matchmaker`, `Legend`).

## Security Model

- Strict **Row Level Security (RLS)** is enabled on every table.
- Score columns (`points`, `level`, `kibble_balance`, etc.) and `status` fields are **never** client-writable. They mutate exclusively through tested `SECURITY DEFINER` remote procedure calls (RPCs) to prevent cheating.
- Storage bucket uploads are strictly scoped to user-owned folders.

## Scripts

```bash
npm start          # Starts the Expo bundler
npm run ios        # Launches the iOS simulator
npm run android    # Launches the Android emulator
npm run typecheck  # Runs TypeScript compiler for error checking
```

## Production Checklist

Preparing for the App Store / Play Store? Review the [`PRODUCTION.md`](./PRODUCTION.md) guide for deployment steps.
