# Handoff Spec: Live Map / Home (`app/(tabs)/index.tsx`)

Source design: **`Guardians App UI.dc.html`** → "Live map / sightings" screen.
Stack: **Expo SDK 56 · Expo Router · react-native-maps · Reanimated 4**. Tokens in
`src/theme/index.ts`; never hardcode values — reference token names below.

> **Map scope:** The map surface itself stays as the **native map (Apple Maps on
> iOS via `PROVIDER_DEFAULT`, Google on Android)** through `@/components/PlatformMap`.
> Do **not** restyle map tiles or apply a custom map JSON. Everything specced here is
> the _chrome over_ the map — search, chips, pins/overlays, the Report action, and the
> "Sightings nearby" sheet.

---

## Overview

The home screen is a full-bleed map a Guardian opens to see cats needing help nearby.
Over the map sit: a search affordance, status filter chips, custom sighting pins, a
primary **Report** action, and a **persistent bottom sheet** listing nearby sightings.
Tapping a pin or a row opens the rescue detail (`/sighting/[id]`).

Current code already implements the map, clustering, filter chips, recenter button,
and a _transient_ selected-sighting card. The design adds a **search bar** and a
**persistent "Sightings nearby" sheet**, and restyles pins, chips, and the Report
button. Deltas are flagged with **▲ NEW** / **△ CHANGE** throughout.

---

## Layout

Vertical stack over `MapView` (`StyleSheet.absoluteFill`), inside a safe-area-aware root:

| Zone                           | Anchor                                       | Notes                                         |
| ------------------------------ | -------------------------------------------- | --------------------------------------------- |
| Search bar ▲ NEW               | Top, `insets.top + spacing.sm`               | Full-width minus `spacing.lg` gutters         |
| Filter chips                   | Below search, `spacing.sm` gap               | Horizontal scroll, no scrollbar               |
| Map (native)                   | Fills remaining space                        | Apple Maps; pins + user location overlay only |
| Recenter button                | Right gutter, above sheet                    | `48×48`, floats                               |
| Report button △ CHANGE         | Right gutter, sits just above the sheet peek | Green pill, `+ Report`                        |
| "Sightings nearby" sheet ▲ NEW | Bottom, draggable                            | Peek height ≈ 30% screen, expands to ≈ 80%    |

Gutters: `spacing.lg` (16) left/right. Respect `useSafeAreaInsets()` top and bottom
(home indicator). The sheet's bottom content padding = `insets.bottom + spacing.sm`.

---

## Design Tokens Used

| Token                                  | Value              | Usage                                                                   |
| -------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `colors.primary`                       | `#1FA463`          | Active chip, Report button, pin (default), distance text, recenter icon |
| `colors.primaryDark`                   | `#15784A`          | Report button pressed                                                   |
| `colors.urgent`                        | `#E0653B`          | Urgent pin, "Urgent" tag                                                |
| `colors.urgentSoft`                    | `#FBE3DA`          | "Urgent"/"Injured" tag background                                       |
| `colors.accent`                        | `#F4A93C`          | "Watching"/secondary status accent                                      |
| `colors.surface`                       | `#FFFFFF`          | Search bar, chips (resting), sheet, cards, pin center dot               |
| `colors.background`                    | `#FBF9F4`          | Root fallback behind map                                                |
| `colors.border`                        | `#E3DDD1`          | Chip/sheet hairline, search bar border                                  |
| `colors.text`                          | `#241F1A`          | Chip label (resting), row title                                         |
| `colors.textMuted`                     | `#857E70`          | Search placeholder, meta, timestamps                                    |
| `radius.pill`                          | `999`              | Chips, Report button, search bar, recenter                              |
| `radius.sheet`                         | `28`               | Sheet top corners (`borderTopLeftRadius`/`Right`)                       |
| `radius.lg`                            | `18`               | Sighting row cards                                                      |
| `typography.subheading`                | 15 / Jakarta 700   | Row title, "Sightings nearby"                                           |
| `typography.smallStrong`               | 12.5 / Jakarta 600 | Chip labels                                                             |
| `typography.small`                     | 12.5 / Jakarta 400 | Row meta line                                                           |
| `typography.mono`                      | 12 / Space Mono    | Distance + age ("0.3 mi", "8m")                                         |
| `typography.caption`                   | 10.5 / Jakarta 700 | "3 active" badge, pin labels                                            |
| `shadow.card`                          | soft warm          | Chips, search bar, pins, rows                                           |
| `shadow.floating`                      | stronger           | Recenter, Report button, sheet                                          |
| `motion.enter` / `stagger` / `damping` | 300 / 40 / 19      | Entrances, sheet spring                                                 |

---

## Components

| Component                     | Source                                | Variant / Props                                | Notes                                                                                 |
| ----------------------------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MapView`, `Marker`, `Circle` | `@/components/PlatformMap`            | `provider={MAP_PROVIDER}`                      | Keep. On iOS, set provider to Apple (`PROVIDER_DEFAULT` / undefined) — **not** Google |
| **SearchBar** ▲ NEW           | new `src/components/MapSearchBar.tsx` | `value, onChangeText, onSubmit, onFilterPress` | "Search this area"; search icon left, list/filter icon right                          |
| **FilterChips** △ CHANGE      | inline (exists)                       | `active: Filter`                               | Restyle to design; see States                                                         |
| **MapPin** △ CHANGE           | inline `MapPin`                       | `sighting, active`                             | Teardrop + white center dot; color by status; urgent = `colors.urgent`                |
| `ClusterBubble`               | inline (exists)                       | `count`                                        | Keep; recolor to `colors.primary` (already)                                           |
| **ReportButton** △ CHANGE     | move from `(tabs)/_layout.tsx`        | label `+ Report`                               | Green pill `48` tall, label `caption`/`smallStrong`, white text; `shadow.floating`    |
| **NearbySheet** ▲ NEW         | new `src/components/NearbySheet.tsx`  | `sightings, activeCount, onSelect`             | Draggable; header "Sightings nearby" + "N active" pill                                |
| `SightingCard`                | `@/components/SightingCard`           | existing props                                 | Reuse for sheet rows (compact). Already token-driven                                  |
| `RecenterButton`              | inline (exists)                       | —                                              | Keep; `colors.primary` icon on `surface`                                              |

**SightingCard props** (already implemented, reuse as-is): `title, status,
temperament, color, isInjured, needsUrgentHelp, thumbnailUrl, distanceM, createdAt,
onPress`.

---

## States and Interactions

No hover on touch — every interactive element uses a press/scale state via
`PressableScale` (`motion.pressScale` 0.97; cards 0.985).

| Element       | State    | Behavior                                                               |
| ------------- | -------- | ---------------------------------------------------------------------- |
| Filter chip   | Resting  | `surface` bg, `text` label, `border` hairline, `shadow.card`           |
| Filter chip   | Active   | `colors.primary` bg, white label, no border                            |
| Filter chip   | Press    | Scale `0.97`, 120ms spring                                             |
| Filter chip   | Change   | Refetch nearby sightings for new `statuses`; announce selection (a11y) |
| Search bar    | Focus    | Border eases `border → primary` (160ms); keyboard avoids sheet         |
| Search bar    | Submit   | Geocode/recenter to query area (or no-op stub if search not wired yet) |
| Map pin       | Default  | Status color, white center dot, `shadow.card`                          |
| Map pin       | Urgent   | `colors.urgent` body + 🚨 glyph                                        |
| Map pin       | Selected | Scale `1.25`, border `colors.accent`; row in sheet highlights          |
| Cluster       | Press    | Zoom to expansion zoom (400ms `animateToRegion`), repaint pins ~600ms  |
| Report button | Default  | `colors.primary` pill, white `+ Report`, `shadow.floating`             |
| Report button | Press    | Scale `0.9`; navigate `/report` (modal)                                |
| Recenter      | Press    | `animateToRegion` to user @3km (500ms); disabled-look if no location   |
| Sheet row     | Press    | Scale `0.985`; navigate `/sighting/[id]`                               |
| Sheet         | Drag     | Spring between peek and expanded; respects velocity                    |
| Data          | Fetching | "Updating…" pill, top-center, `FadeIn` (`motion.enter`), non-blocking  |

---

## Device / Responsive Behavior

React Native — no web breakpoints. Define by device class & accessibility:

| Class                                | Changes                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Small phones (< 360pt wide, e.g. SE) | Chips stay single-row scroll; sheet peek shows 2 rows; titles `numberOfLines={1}`                  |
| Standard phones                      | Default; sheet peek shows ~3 rows                                                                  |
| Large phones / Max                   | More peek rows; Report button & recenter keep `spacing.lg` inset                                   |
| Tablet (≥ 768pt)                     | Cap sheet width at 480pt, center it; map full-bleed behind                                         |
| Landscape                            | Sheet max height 60%; search + chips stay pinned top; respect left/right safe-area insets (notch)  |
| Dynamic Type (large)                 | All `Text` allows scaling; rows grow vertically, never clip — switch row meta to 2 lines if needed |

---

## Edge Cases

- **Location permission denied / unknown** — Map opens at `DEFAULT_REGION`; recenter
  renders disabled-look and shows a one-line `notify`/toast prompting to enable
  location. Sheet still lists sightings around the visible region (distance hidden when
  `coords` is null — `distanceM` omitted).
- **No sightings in view** — Sheet shows `EmptyState`: 🐾 "No cats spotted here yet" /
  "Pan the map or be the first to report one." with a "Report a cat" action.
- **Many sightings (100s)** — Supercluster already clusters (`radius 60, maxZoom 18`);
  sheet lists the nearest N (recommend ≤ 25, sorted by `distance_m`) with the active
  count badge reflecting the visible set.
- **Long title** — `numberOfLines={1}` + tail truncation on row title (exists in
  `SightingCard`). "Sightings nearby" header never truncates.
- **Long meta (international / long street names)** — meta line `numberOfLines={1}`,
  truncate; distance/age (`mono`) never truncate (fixed right column).
- **Slow / offline** — Show last cached results (React Query cache) under a top
  "Updating…" pill; never block the map. On hard error, sheet shows a retry row.
- **Stale region** — Markers settle to `tracksViewChanges=false` after first paint to
  save battery; re-enable briefly (`pulseTracks`) on region change / selection.

---

## Animation / Motion

| Element            | Trigger             | Animation                                        | Duration             | Easing              |
| ------------------ | ------------------- | ------------------------------------------------ | -------------------- | ------------------- |
| Sheet (initial)    | Mount               | Rise from bottom                                 | `motion.enter` 300ms | spring `damping 19` |
| Sheet rows         | Mount / data change | `FadeInDown`, `motion.stagger` 40ms between rows | 300ms                | spring              |
| Report button      | Mount               | `FadeInDown.delay(180)`                          | 520ms                | spring `damping 12` |
| Selected pin       | Select              | Scale → `1.25`                                   | ~150ms               | spring              |
| "Updating…" pill   | Fetch start/stop    | `FadeIn` / `FadeOut`                             | 300ms                | default             |
| Recenter / cluster | Press               | `animateToRegion`                                | 400–600ms            | native              |
| Sheet drag         | Pan release         | Snap to peek/expanded                            | velocity-based       | spring              |

Respect **Reduce Motion**: when enabled, swap spring entrances for instant/`FadeIn`
and disable the pin pulse-scale.

---

## Accessibility Notes

- **Focus / reading order:** Search bar → filter chips (l→r) → Report button →
  "Sightings nearby" header → rows (top→down). Map pins are reachable but secondary;
  give each a meaningful label.
- **Labels & roles:**
  - Search: `accessibilityRole="search"`, label "Search this area".
  - Chip: `accessibilityRole="button"`, `accessibilityState={{ selected: active }}`,
    label e.g. "Filter: Urgent".
  - Pin: label "`{title}`, {status}, {distance} away" so VoiceOver reads context.
  - Report: `accessibilityRole="button"`, label "Report a cat".
  - Recenter: label "Recenter map on my location".
  - Sheet handle: label "Sightings list, drag to expand".
- **Announcements:** On filter change, announce "Showing {label}, {count} sightings".
  On fetch complete with empty result, announce the empty state.
- **Touch targets:** ≥ `44×44pt`. Chips meet via `spacing.sm`+ vertical padding;
  Report `48`+; recenter `48`.
- **Dynamic Type:** Keep `allowFontScaling` on; cap pin label scaling so pins don't
  overflow. Ensure contrast: white-on-`primary` ✓, `text`-on-`surface` ✓,
  `urgent`-on-`urgentSoft` ✓ (all ≥ 4.5:1).

---

## Implementation Notes (for the dev picking this up)

1. **Keep the native map** — confirm `MAP_PROVIDER` resolves to Apple on iOS
   (`PROVIDER_DEFAULT`/undefined). Don't add a Google map style.
2. **New work:** `MapSearchBar`, `NearbySheet` (wrap a draggable sheet — e.g. a
   Reanimated-driven view or `@gorhom/bottom-sheet` if added), and moving the Report
   action out of `(tabs)/_layout.tsx` into the map screen as a green pill above the
   sheet. (If Report stays a global FAB, skip the move and note it.)
3. **Reuse** `SightingCard` for sheet rows; it's already token-driven and matches the
   design row (thumbnail · title · status pill · meta · distance/age).
4. **Filter labels:** design shows "All sightings / Urgent / Kittens". Current code uses
   "All cats / Needs help / Adoptable" mapped to `CatStatus[]`. Product decision —
   either relabel chips or keep current semantics; the visual spec is identical.
5. **Data:** `useNearbySightings({ lat, lng, radiusM, statuses })` already returns the
   list; feed the same data into the sheet (sorted by `distance_m`) and the pins.
6. Run `npm run typecheck` before done (per `AGENTS.md`).
