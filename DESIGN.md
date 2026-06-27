# Guardians — UI design system

Implemented from the Claude Design source **`Guardians App UI.dc.html`**
(project `75445258-ec17-4ce7-b642-6a180c152f5c`). A warm & friendly cat-rescue
language: a saturated rescue-green on a soft cream canvas, warm-ink text, a honey
accent, friendly orange for urgency, and rounded-everything geometry.

All values live in **`src/theme/index.ts`** — never hardcode colours/spacing in
screens or components.

## Palette

| Token                    | Hex       | Use                                          |
| ------------------------ | --------- | -------------------------------------------- |
| `primary` (green500)     | `#1FA463` | Primary actions, active states, rescue green |
| `primaryDark` (green700) | `#15784A` | Pressed / deep green, gradients              |
| `primaryDeep` (green900) | `#0B3D28` | Darkest green, shadows on green              |
| `primarySoft` (green100) | `#D7EEDF` | Soft green chip / tag backgrounds            |
| `primaryTint` (green50)  | `#E8F4EC` | Faint green surfaces                         |
| `accent` (amber500)      | `#F4A93C` | Honey accent (points, badges)                |
| `accentDark` (amber600)  | `#8A5A12` | Honey text on soft amber                     |
| `accentSoft` (amber100)  | `#FCEFD6` | Reward / points card background              |
| `urgent`                 | `#E0653B` | Friendly urgent orange                       |
| `urgentSoft`             | `#FBE3DA` | Urgent tag background                        |
| `background`             | `#FBF9F4` | App canvas (warm off-white)                  |
| `cream`                  | `#ECE7DD` | Grouped / sand sections                      |
| `surface` / `card`       | `#FFFFFF` | Cards & sheets                               |
| `border`                 | `#E3DDD1` | Warm hairline borders                        |
| `text`                   | `#241F1A` | Warm near-black ink                          |
| `textSecondary`          | `#5F5949` | Secondary copy                               |
| `textMuted`              | `#857E70` | Muted / captions                             |

Status hues (claimed / in-rescue / adopt / archived) are warmed variants in
`palette` and consumed via `src/constants/status.ts` — unchanged in structure.

## Typography

Three families, loaded at runtime via `expo-font` in `app/_layout.tsx`:

- **Nunito** (`700/800/900`) — rounded display & headings (`display`, `title`, `heading`).
- **Plus Jakarta Sans** (`400/500/600/700`) — body copy, labels, buttons-adjacent text.
- **Space Mono** (`400/700`) — micro-data: distances, XP, counters (`mono` variant).

Variants: `display, title, heading, subheading, body, bodyStrong, small,
smallStrong, caption, overline` (uppercase tracked label), `mono`.

## Geometry & elevation

- `radius`: `sm 10 · md 14 · lg 18 · xl 24 · sheet 28 · pill 999`. Buttons are fully
  pill-shaped; cards use `lg`; the profile banner uses `xl`.
- `shadow`: `card` (soft warm), `floating` (FAB/sheets), `glow` (green halo under the
  primary CTA).

## Screen mapping (design → app)

| Design screen                                | App route                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Onboarding / "Every cat deserves a Guardian" | `app/(auth)/welcome.tsx` — green flowing hero + emblem                                 |
| Live map / sightings                         | `app/(tabs)/index.tsx`                                                                 |
| Report a sighting                            | `app/report.tsx`                                                                       |
| Rescue detail / claim & complete             | `app/sighting/[id].tsx` — added honey "Earn points" card                               |
| Profile (points / level / badges)            | `app/(tabs)/profile.tsx` — green identity banner + XP bar                              |
| Adoptable gallery / Cat profile              | _design includes these; no routes exist yet — candidates for a future `adopt` feature_ |

## Notes

- Custom fonts are loaded at runtime; for production native builds, consider the
  `expo-font` config plugin to embed them.
- The onboarding hero approximates the design's WebGL shader with a layered
  gradient + drifting translucent blobs (no WebGL dependency in React Native).
