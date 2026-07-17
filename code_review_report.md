# Guardians Code Review & Remediation Report

**Date**: 2026-07-13  
**Auditor Archetype**: teamwork_preview_orchestrator  
**Target Codebase**: `/Users/rivu/guardians/guardians-app`  
**Integrity Mode**: development

---

## 1. Executive Summary

This report presents a comprehensive codebase audit of the **Guardians** mobile application. Guardians is an Expo-based cross-platform community app for rescuing cats, utilizing React Query, Supabase (with PostGIS), React Hook Form, and Zod.

The audit evaluated the project on:

1. TypeScript compilation and type-checking soundness.
2. Compliance with architectural conventions defined in `AGENTS.md`.
3. Logic bugs, edge cases, crashes, and error handling in core UI, Map, and Auth components.

The codebase displays strong modular structure and architectural compliance (utilizing SECURITY DEFINER RPCs for database writes, platform-abstracted Map wrappers, and unified dialog helper interfaces). However, several critical logical bugs were identified that can lead to startup freezes, deep-link authentication screen hangs, map crashes on iOS, and database query amplification.

---

## 2. R1: Compiler & Type-checking Verification

### TypeScript Compiler Status

We executed the project's typecheck command:

```bash
npm run typecheck
```

Which calls `tsc --noEmit`. The command completed successfully with exit code `0` and printed zero errors:

```
> guardians-app@1.0.0 typecheck
> tsc --noEmit
```

This confirms that the codebase compiles successfully under the current TypeScript configuration.

### Coordinates Runtime Type Discrepancy (Severity: Medium)

- **Location**: `src/types/models.ts` (lines 54-55) & `src/api/sightings.ts` (lines 12-23)
- **Description**: The `Sighting` model interface defines coordinates (`lat`, `lng`) and `address` as required fields:
  ```typescript
  export interface Sighting {
    id: string;
    lat: number;
    lng: number;
    address: string | null;
    ...
  }
  ```
  However, in `src/api/sightings.ts`, the default `SIGHTING_SELECT` query intentionally filters coordinates out for privacy reasons:
  ```typescript
  const SIGHTING_SELECT = `
    id, reporter_id, title, description, status, temperament, color,
    is_injured, needs_urgent_help, claimed_by, claimed_at, rescued_at,
    created_at, updated_at, ...
  `;
  ```
  Because the API casts these query results directly to `Sighting` objects, there is a mismatch where TypeScript believes `lat` and `lng` are guaranteed to exist, but they are actually `undefined` at runtime when fetched from lists or feed endpoints. Detail queries fetch privacy-safe/coarsened coordinates via `get_sighting_detail` RPC, but list queries return `undefined` coordinates.
- **Proposed Fix**: Make `lat` and `lng` optional on the `Sighting` interface to match runtime behavior:
  ```typescript
  export interface Sighting {
    id: string;
    reporter_id: string | null;
    title: string | null;
    description: string | null;
    lat?: number;
    lng?: number;
    address: string | null;
    ...
  }
  ```

---

## 3. R2: Architectural Rules Alignment Audit

As required, we manually audited at least three codebase files for compliance with each architectural guideline in `AGENTS.md`.

### Guideline A: Component Barrel Imports and Theme Design Tokens

_Rule: UI primitives must live in `src/components/ui` (imported via `@/components/ui`) and use design tokens in `src/theme` (no hardcoded colors/spacing)._

- **Files Audited**:
  1. `src/components/SponsoredCard.tsx`
     - **Compliance**: Imports primitive components via `@/components/ui` barrel import.
     - **Violations**:
       - Line 14: `const AD_GRADIENT = [palette.amber100, '#FFF6E9'] as const;` uses hardcoded hex color `'#FFF6E9'`.
       - Lines 116-117: Uses raw pixel spacing values `gap: 4` and `gap: 5`.
  2. `app/(tabs)/profile.tsx`
     - **Compliance**: Imports primitives via `@/components/ui` barrel import.
     - **Violations**:
       - Line 342: `roleDot: { ..., backgroundColor: '#BFE0CD' }` uses hardcoded hex `'#BFE0CD'`.
       - Line 329: `backgroundColor: 'rgba(255,255,255,0.28)'`, Line 337: `backgroundColor: 'rgba(255,255,255,0.18)'`, Line 349: `color: 'rgba(255,255,255,0.9)'` (violates theme color opacity standards).
       - Lines 327-351: Uses raw pixel dimensions `padding: 3`, `gap: 6`, `paddingVertical: 4`, `borderRadius: 999`, `height: 10`.
  3. `app/sighting/[id].tsx`
     - **Compliance**: Imports primitives via `@/components/ui` barrel import.
     - **Violations**:
       - Line 656: `borderColor: '#F6E2BC'` uses hardcoded hex color.
       - Line 666: `marginTop: 1` uses raw pixel spacing.
- **Audit Verdict**: **Non-compliant** (minor styling token violations found in all three audited files).

### Guideline B: Sensitive DB Writes via SECURITY DEFINER RPCs Only

_Rule: Sensitive writes (points, status, rewards) must happen ONLY via SECURITY DEFINER RPCs (migration `0002_functions.sql`) and never from the client directly._

- **Files Audited**:
  1. `src/api/profiles.ts`
     - **Compliance**: Confirmed. `updateMyProfile` restricts input to `ProfilePatch` containing only non-sensitive columns (`username`, `full_name`, `avatar_url`, `bio`, `is_guardian`, `wants_to_adopt`). Row Level Security (RLS) blocks client writes to sensitive fields (`points`, `level`).
  2. `src/api/sightings.ts`
     - **Compliance**: Confirmed. Sighting state changes are securely routed via database RPC functions: `update_sighting_status`, `claim_sighting`, `create_sighting`, and `approve_adoption`. Only the description is allowed as a direct client write under strict RLS policies.
  3. `src/api/rewards.ts`
     - **Compliance**: Confirmed. Reward redemptions and kibble deductions are locked and processed on the database side via the `redeem_reward` RPC.
- **Audit Verdict**: **Compliant**.

### Guideline C: Map Imports from `@/components/PlatformMap`

_Rule: Maps must be imported from `@/components/PlatformMap` (native map + web placeholder) and never `react-native-maps` directly._

- **Files Audited**:
  1. `app/(tabs)/index.tsx` — Compliant. Imports from `@/components/PlatformMap`.
  2. `app/report.tsx` — Compliant. Imports from `@/components/PlatformMap`.
  3. `app/sighting/[id].tsx` — Compliant. Imports from `@/components/PlatformMap`.
  4. `src/components/JourneyTimeline.tsx` — Compliant. Imports from `@/components/PlatformMap`.
  5. `src/utils/geo.ts`
     - **Violation**: Line 1: `import type { Region } from 'react-native-maps';` imports type definitions directly from `react-native-maps`. Since `Region` is already re-exported by `@/components/PlatformMap`, this violates the directive.
- **Audit Verdict**: **Non-compliant** (single import type violation in `geo.ts`).

### Guideline D: Dialogs using `@/lib/dialog`

_Rule: For dialogs, use `@/lib/dialog` (`confirmAsync`, `notify`, `choosePhotoSource`) rather than React Native's `Alert` (which no-ops on web)._

- **Files Audited**:
  1. `app/settings.tsx` — Compliant. Uses `confirmAsync` and `notify`.
  2. `app/lost-cat.tsx` — Compliant. Uses `choosePhotoSource`, `confirmAsync`, and `notify`.
  3. `src/components/ReidSuggestions.tsx` — Compliant. Uses `confirmAsync`.
- **Audit Verdict**: **Compliant** (no raw `Alert` calls found).

### Guideline E: Expo SDK 56 Configuration

_Rule: app.json configuration must not contain deprecated fields (`splash`, `newArchEnabled`, `android.edgeToEdgeEnabled`)._

- **Files Audited**:
  1. `app.config.ts` — Compliant. No legacy configurations or deprecated fields.
  2. `package.json` — Compliant. Pairs `"expo": "~56.0.12"` with `"react-native": "0.85.3"`, `"react-native-reanimated": "4.3.1"`, and `"react-native-worklets": "0.8.3"`.
  3. `babel.config.js` — Compliant. Uses `babel-preset-expo` without legacy worklet plugin configurations.
- **Audit Verdict**: **Compliant**.

---

## 4. R3: Logical Bugs & Code Quality Check

Here is a detailed breakdown of identified logical, safety, and performance bugs in the core functionality.

### Bug 1: Startup Hang on Uncaught `getSession` Rejection (Severity: High)

- **Location**: `src/providers/AuthProvider.tsx` (lines 32-38)
- **Code Snippet**:
  ```typescript
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    });
    ...
  ```
- **Root Cause**: If `getSession()` throws or rejects (due to temporary Supabase API downtime, local storage corruption, or network timeout), the promise rejection is uncaught. The `.then()` block is bypassed, meaning `setInitializing(false)` is never called. The root navigation layout keeps the splash screen visible as long as `initializing` is true, locking users out of the app.
- **Step-by-Step Proposed Fix**:
  1. Append a `.catch()` block to log the session initialization error.
  2. Append a `.finally()` block (or ensure `setInitializing(false)` is called in both success and error handlers) so the app can load regardless.
  ```typescript
  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (!active) return;
      setSession(data.session);
    })
    .catch((err) => {
      console.error('Failed to resolve session on mount:', err);
    })
    .finally(() => {
      if (active) {
        setInitializing(false);
      }
    });
  ```

### Bug 2: Deep-link Verification Screen Hang on Exception (Severity: High)

- **Location**: `app/reset.tsx` (lines 44-54) and `app/confirm.tsx` (lines 17-27)
- **Code Snippet** (from `app/reset.tsx`):
  ```typescript
  useEffect(() => {
    let active = true;
    (async () => {
      const ok = url ? await sessionFromUrl(url) : false;
      if (!active) return;
      setStatus(ok || session ? 'ready' : 'invalid');
    })();
    ...
  ```
- **Root Cause**: The function `sessionFromUrl` parses URLs and communicates with Supabase. If the deep-link URL is malformed, or if the server returns a network error, `sessionFromUrl` throws an exception. Because the IIFE does not wrap the invocation in a try-catch block, the uncaught exception terminates the execution. The screen state is left in the `'loading'` state indefinitely, causing a permanent loading spinner.
- **Step-by-Step Proposed Fix**:
  1. Wrap the async call inside the IIFE with a `try-catch` block.
  2. In the `catch` block, set the status to `'invalid'` in `reset.tsx` or redirect to `/welcome` in `confirm.tsx`.
  ```typescript
  // app/reset.tsx fix:
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ok = url ? await sessionFromUrl(url) : false;
        if (!active) return;
        setStatus(ok || session ? 'ready' : 'invalid');
      } catch (err) {
        console.error('Failed to parse reset URL:', err);
        if (!active) return;
        setStatus('invalid');
      }
    })();
    return () => {
      active = false;
    };
  }, [url, session]);
  ```

### Bug 3: Google Maps Provider Forced iOS Crash/Blank Screen (Severity: High)

- **Location**: `src/components/PlatformMap.tsx` (lines 18-19)
- **Code Snippet**:
  ```typescript
  export const MAP_PROVIDER =
    env.googleMapsAndroidKey || env.googleMapsIosKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;
  ```
- **Root Cause**: If `googleMapsAndroidKey` is configured but `googleMapsIosKey` is left blank, the expression evaluates to `true` on iOS. The app will attempt to initialize `PROVIDER_GOOGLE` on iOS. Google Maps on iOS requires specific native libraries to be compiled and initialized with an API key. Forcing it without key configuration results in a rendering crash or a blank view.
- **Step-by-Step Proposed Fix**:
  1. Import `Platform` from `react-native`.
  2. Set `MAP_PROVIDER` based on `Platform.OS`, checking ONLY the key applicable for the active platform.
  ```typescript
  import { Platform } from 'react-native';
  ...
  export const MAP_PROVIDER =
    Platform.OS === 'android'
      ? (env.googleMapsAndroidKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT)
      : (env.googleMapsIosKey ? PROVIDER_GOOGLE : PROVIDER_DEFAULT);
  ```

### Bug 4: Zod Email Validation Trailing Space Rejection (Severity: High)

- **Location**: `app/(auth)/sign-in.tsx` (line 15), `app/(auth)/sign-up.tsx` (line 21), and `app/(auth)/forgot-password.tsx` (line 15)
- **Code Snippet**:
  ```typescript
  const schema = z.object({
    email: z.string().email('Enter a valid email'),
    ...
  });
  ```
- **Root Cause**: Mobile keyboard autocomplete and copy-paste inputs frequently append a trailing space (e.g. `"user@example.com "`). Zod's `.email()` validator performs strict pattern matching. If a trailing space is present, it fails validation immediately and triggers an error overlay in the form, preventing form submission.
- **Step-by-Step Proposed Fix**:
  1. Apply Zod's `.trim()` validator to the email fields _before_ running the `.email()` check.
  ```typescript
  const schema = z.object({
    email: z.string().trim().email('Enter a valid email'),
    ...
  });
  ```

### Bug 5: Device Rotation Sheet Position Desync (Severity: Medium)

- **Location**: `src/components/NearbySheet.tsx` (lines 35-58)
- **Code Snippet**:
  ```typescript
  const { height } = useWindowDimensions();
  ...
  const collapsedY = Math.max(0, expandedH - peekH);
  const translateY = useSharedValue(collapsedY);
  ```
- **Root Cause**: `useWindowDimensions()` updates during device rotation, changing `expandedH` and `collapsedY`. However, `translateY` is a Reanimated shared value initialized once on mount. When the screen rotates, `translateY.value` is not updated, keeping the sheet anchored to coordinates calculated for the previous orientation, resulting in the sheet going off-screen or covering too much space.
- **Step-by-Step Proposed Fix**:
  1. Add a `useEffect` that listens to updates on `collapsedY` or `minimizedY`.
  2. Clamp or animate `translateY.value` to the new boundaries when these layout variables change.
  ```typescript
  useEffect(() => {
    translateY.value = Math.min(minimizedY, Math.max(0, translateY.value));
  }, [collapsedY, minimizedY, translateY]);
  ```

### Bug 6: Sighting Creation Mutation Photo Upload Failure Rollback (Severity: Medium)

- **Location**: `src/hooks/useSightings.ts` (lines 88-94)
- **Code Snippet**:
  ```typescript
  mutationFn: async (input: CreateSightingInput & { photoUrls?: string[] }) => {
    const sighting = await createSighting(input);
    if (input.photoUrls?.length && user) {
      await Promise.all(input.photoUrls.map((url) => addPhoto(sighting.id, url, user.id)));
    }
    return sighting;
  },
  ```
- **Root Cause**: The mutation creates the database row for the sighting first. If the subsequent parallel photo uploads via `Promise.all` fail (due to network timeout, storage rate limits, or file errors), the mutation fails and propagates the exception to the UI. However, the database record is already committed. This creates an orphaned sighting listing that has no associated photos in the database.
- **Step-by-Step Proposed Fix**:
  1. Propose wrapping the photo upload step in a `try-catch` block.
  2. If the photo uploads throw an error, delete the newly created sighting row to rollback the transaction before rethrowing the error.
  ```typescript
  mutationFn: async (input: CreateSightingInput & { photoUrls?: string[] }) => {
    const sighting = await createSighting(input);
    try {
      if (input.photoUrls?.length && user) {
        await Promise.all(input.photoUrls.map((url) => addPhoto(sighting.id, url, user.id)));
      }
      return sighting;
    } catch (err) {
      // Rollback sighting creation on photo upload failure
      try {
        await deleteSighting(sighting.id);
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw err;
    }
  },
  ```

### Bug 7: Excessive Database Read Spam on Map Gestures (Severity: Medium)

- **Location**: `app/(tabs)/index.tsx` (lines 74-84)
- **Code Snippet**:
  ```typescript
  const params = useMemo(
    () => ({
      lat: region.latitude,
      lng: region.longitude,
      radiusM: radiusFromRegion(region),
      statuses: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
    [region, filter],
  );
  const { data: sightings = [], isFetching } = useNearbySightings(params);
  ```
- **Root Cause**: Panning gestures trigger `onRegionChangeComplete`, updating the `region` state with high-precision floats (e.g. `37.7749283727`). Since the query parameters `lat` and `lng` are directly derived from these raw floats, every micro-movement constructs a new React Query key, bypassing cache hits and launching unnecessary network requests to query nearby sightings from Supabase.
- **Step-by-Step Proposed Fix**:
  1. Quantize coordinates in the parameters to restrict updates. Rounding coordinates to 3 decimal places (approx. 110-meter resolution) or 4 decimal places (approx. 11-meter resolution) will allow React Query to hit cached results for minor pans.
  ```typescript
  const params = useMemo(
    () => ({
      // Round to 3 decimal places (~110m grid) to stabilize React Query keys
      lat: Math.round(region.latitude * 1000) / 1000,
      lng: Math.round(region.longitude * 1000) / 1000,
      radiusM: radiusFromRegion(region),
      statuses: FILTERS.find((f) => f.key === filter)?.statuses,
    }),
    [region, filter],
  );
  ```

---

## 5. R4: Step-by-Step Remediation Plan

We propose the following ordered sequence of tasks to remediate all identified codebase issues.

```
+---------------------------------------------------------------------------------+
|                               REMEDIATION PATH                                  |
+---------------------------------------------------------------------------------+
|                                                                                 |
|  [PHASE 1: CRITICAL STABILITY & AUTH HANGS]                                     |
|  1. Patch AuthProvider.tsx to catch getSession rejections                       |
|  2. Patch app/reset.tsx & app/confirm.tsx to handle deep-link exceptions        |
|  3. Patch sign-in.tsx, sign-up.tsx, & forgot-password.tsx to include .trim()    |
|                                                                                 |
|  [PHASE 2: RENDERING & CRASH PREVENTION]                                        |
|  4. Patch PlatformMap.tsx to conditionally assign PROVIDER_GOOGLE based on OS   |
|  5. Patch NearbySheet.tsx layout position sync on orientation change            |
|                                                                                 |
|  [PHASE 3: BACKEND/DATA EFFICIENCY]                                             |
|  6. Patch app/(tabs)/index.tsx query params to quantize lat/lng floats         |
|  7. Patch useCreateSighting in useSightings.ts to rollback on photo errors      |
|                                                                                 |
|  [PHASE 4: CLEANUP & AUDIT COMPLIANCE]                                          |
|  8. Patch models.ts Sighting interface (make lat/lng optional)                  |
|  9. Modify src/utils/geo.ts to import Region from PlatformMap                   |
|  10. Refactor SponsoredCard.tsx & app/(tabs)/profile.tsx to use theme tokens    |
|                                                                                 |
+---------------------------------------------------------------------------------+
```

### Phase 1: Critical Stability & Auth Hangs

1. **Task 1: Auth Initialization Safety**
   - **Action**: Update `src/providers/AuthProvider.tsx` to handle promise rejections on `getSession()`, preventing startup splash screens from freezing.
2. **Task 2: Deep Link Failure Isolation**
   - **Action**: Update `app/reset.tsx` and `app/confirm.tsx` to wrap `sessionFromUrl` inside try-catch blocks to prevent uncaught exceptions from stalling the verification screens.
3. **Task 3: Validation Inputs Trimming**
   - **Action**: Update `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`, and `app/(auth)/forgot-password.tsx` schemas to add `.trim()` to the email validators to prevent autofill trailing spaces from failing validation.

### Phase 2: Native Rendering & Layout Crash Prevention

4. **Task 4: Cross-platform Map Configuration**
   - **Action**: Update `src/components/PlatformMap.tsx` to set `MAP_PROVIDER` checking the OS platform so Google Maps is only initialized on iOS if `googleMapsIosKey` is explicitly present.
5. **Task 5: Sheet Rotation Responsiveness**
   - **Action**: Update `src/components/NearbySheet.tsx` to sync the `translateY` shared value on dimensions changes.

### Phase 3: Data Integrity & Backend Efficiency

6. **Task 6: Query Parameter Quantization**
   - **Action**: Update `app/(tabs)/index.tsx` to round lat/lng parameters to 3 decimal places to prevent map panning from spamming the Supabase database.
7. **Task 7: Sighting Creation Rollback**
   - **Action**: Implement transactional rollback in `useCreateSighting` (`src/hooks/useSightings.ts`) to delete the database row if photo uploads fail, avoiding orphaned entries.

### Phase 4: TypeScript Soundness & Guideline Compliance

8. **Task 8: Sighting Interface Optimization**
   - **Action**: Update `Sighting` model in `src/types/models.ts` to make coordinates `lat` and `lng` optional, resolving the runtime type mismatch with selective select queries.
9. **Task 9: Map Import Resolution**
   - **Action**: Change the `Region` import in `src/utils/geo.ts` to reference `@/components/PlatformMap` rather than `react-native-maps`.
10. **Task 10: Styling Tokens Refactoring**
    - **Action**: Replace hardcoded hex values and raw pixel paddings/margins in `SponsoredCard.tsx` and `app/(tabs)/profile.tsx` with spacing and color tokens imported from `@/theme`.
