# Google Play Store Policy, Runtime Permissions & UGC Compliance Guide

**App Name:** Guardians  
**Package Identifier:** `com.guardians.app`  
**Document Purpose:** Complete compliance reference covering Android Runtime Permissions justification, User-Generated Content (UGC) safety, Account Deletion mandates, and Legal disclosures for Google Play Store review.

---

## 1. Android Runtime Permissions & Scoping Matrix

Google Play policies mandate that apps request only the minimum necessary permissions required to implement user-facing features, with clear rationales presented before OS prompt invocation.

### 1.1 Permission Justification Table

| Permission               | Declared In                                                           | Purpose / User-Facing Feature                                                                                                                    | Priming UI / Fallback Behavior                                                                                                                                                                                    |
| :----------------------- | :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_FINE_LOCATION`   | `app.config.ts` (`permissions` array & `expo-location` plugin)        | • Centers the rescue map on the user's immediate neighborhood<br>• Pinpoints exact coordinates when reporting a cat sighting                     | **Primed**: Educational primer modal (`📍 Find cats near you`) explains purpose before OS dialog.<br>**Fallback**: If denied, app falls back to manual map navigation and manual pin dropping without disruption. |
| `ACCESS_COARSE_LOCATION` | `app.config.ts` (`permissions` array & `expo-location` plugin)        | • Coarse neighborhood area matching for urgent rescue alerts<br>• Stored at rounded ~110m PostGIS resolution for push notification routing       | **Primed**: Grouped with location primer.<br>**Privacy**: Coarsened to 3 decimal places (~110m) in PostgreSQL database; exact home address is never collected or stored.                                          |
| `CAMERA`                 | `app.config.ts` (`permissions` array & `expo-image-picker` plugin)    | • Capturing live photos of spotted feral or lost cats for rescue reports<br>• Taking profile pictures                                            | **Primed**: Action-triggered modal (`📷 Snap the cat you spotted`) shown only after tapping "Take photo".<br>**Fallback**: Users can choose an existing photo from library or submit text details.                |
| `READ_MEDIA_IMAGES`      | `app.config.ts` (`permissions` array & `expo-image-picker` plugin)    | • Selecting existing cat photos from device media gallery<br>• Selecting avatar pictures                                                         | **Primed**: Scoped system photo picker modal (`🖼️ Add a photo of the cat`) displayed before system picker.<br>**Scoped**: Modern Android 13+ granular media permission; broad storage access is NOT requested.    |
| `POST_NOTIFICATIONS`     | `expo-notifications` plugin (injected during Android native prebuild) | • Delivering time-critical notifications when a cat near the user requires urgent rescue<br>• Notifying owner when a sighting matches a lost cat | **Primed**: Opt-in modal (`🔔 Urgent rescue alerts`) shown in Settings or upon toggling notification preferences.<br>**Controlled**: Fully toggleable by user at any time in Settings.                            |

### 1.2 Permission Priming Architecture (`src/components/PermissionPrimer.tsx`)

Guardians utilizes an explicit pre-permission educational modal pattern:

1. When a user triggers an action requiring permissions, `PermissionPrimer` renders an accessible, themed dialog detailing _why_ the permission is needed and _how_ data is handled.
2. The OS dialog is invoked **only** if the user presses "Continue".
3. If the user presses "Not now", the OS dialog is skipped, preventing system permission denial counters from being exhausted.
4. Supports `useReducedMotion()` to respect accessibility settings.

### 1.3 Audit of High-Risk & Unnecessary Permissions

Guardians enforces strict permission minimization. The following high-risk or invasive permissions are **NOT requested or present** anywhere in the codebase:

- ❌ `ACCESS_BACKGROUND_LOCATION`: No background location tracking. Location is accessed strictly in the foreground during active app use (`Location.requestForegroundPermissionsAsync()`).
- ❌ `RECORD_AUDIO`: No microphone access.
- ❌ `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`: Deprecated broad storage permissions are completely omitted in favor of modern `READ_MEDIA_IMAGES`.
- ❌ `READ_CONTACTS`, `READ_PHONE_STATE`, `ACCESS_MEDIA_LOCATION`, `BLUETOOTH`: Completely omitted.

---

## 2. Google Play Account Deletion Policy Compliance

Google Play requires apps that allow account creation to provide both an **in-app deletion mechanism** and a **web-based deletion URL**.

### 2.1 In-App Deletion Mechanism

- **Entry Point:** In-app Settings screen (`app/settings.tsx`).
- **Confirmation Dialog:** A destructive confirmation modal informs the user:  
  _"This permanently deletes your profile, reports, points, and rewards. This cannot be undone."_
- **Execution Pipeline:**
  1. Calls `useAuth().deleteAccount()`.
  2. Invokes Supabase Edge Function `delete-account` with the authenticated session Bearer token.
  3. The Edge Function verifies the JWT, instantiates the Supabase admin client using `SUPABASE_SERVICE_ROLE_KEY`, and executes `admin.auth.admin.deleteUser(user.id)`.
  4. Client session is cleared and the app automatically redirects to the onboarding welcome screen.

### 2.2 Database Cascading & Anonymization Architecture

Account deletion triggers automated cascading in PostgreSQL:

| Database Entity                               | Action on User Deletion | Rationale                                                                                                                                                                                                    |
| :-------------------------------------------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.profiles`                             | `ON DELETE CASCADE`     | User identity, username, full name, avatar URL, points, level, and stats are permanently deleted.                                                                                                            |
| `public.device_push_tokens`                   | `ON DELETE CASCADE`     | Push tokens and coarse geo-coordinates are purged immediately.                                                                                                                                               |
| `public.adoption_interest`                    | `ON DELETE CASCADE`     | Adoption applications and inquiry messages are deleted.                                                                                                                                                      |
| `public.point_events` & `public.user_badges`  | `ON DELETE CASCADE`     | Entire gamification points and reward ledger is destroyed.                                                                                                                                                   |
| `public.user_blocks` & `public.abuse_reports` | `ON DELETE CASCADE`     | User block relations and filed abuse reports are removed.                                                                                                                                                    |
| `public.sightings`                            | `ON DELETE SET NULL`    | `reporter_id` and `claimed_by` fields are set to `NULL`. The cat sighting record remains on the map so active community rescue operations are not lost, but all personal attribution is permanently severed. |
| `public.sighting_updates`                     | `ON DELETE SET NULL`    | `author_id` is set to `NULL` to retain rescue chronological timeline while removing author identity.                                                                                                         |

### 2.3 Public Web Account Deletion URL

For users who have uninstalled the application:

- **Web Deletion URL:** `https://guardians-rescue.app/delete-account` (or `https://guardians-rescue.app/privacy#account-deletion`).
- Users can submit their registered email address to receive an automated account deletion verification link or contact support at `rafayetquader@gmail.com`.

---

## 3. User-Generated Content (UGC) Safety Policy Compliance

As an app featuring community cat sightings, photo uploads, and comments, Guardians complies with all Google Play UGC safety requirements.

### 3.1 Zero-Tolerance Terms & 24-Hour SLA

- **Terms of Service:** Embedded in-app at `app/terms.tsx` and in `docs/legal/terms.md` (Section 3).
- **Prohibited Content:** Strict zero tolerance for unlawful content, harassment, hate speech, sexually explicit material, violence, animal cruelty, false reports, or scraping.
- **Enforcement SLA:**  
  _"We review reports and act on violations — including removing content and terminating accounts — within 24 hours of a report. Repeated or serious violations result in a permanent ban."_

### 3.2 In-App Content Reporting

- **User Interface:** Every sighting detail screen (`app/sighting/[id].tsx`) features a visible **"⚠️ Report this listing"** action.
- **Reporting RPC:** Invokes `report_content(p_type, p_id, p_reason)` PostgreSQL stored procedure.
- **Supported Targets:** `'sighting'`, `'comment'`, `'profile'`, `'photo'`.
- **Abuse Prevention:** Rate-limited by the `abuse_reports_rate` PostgreSQL trigger (maximum 10 reports per 60 seconds per user).

### 3.3 Automated Community Auto-Hide (3-Report Threshold)

- Implemented in `supabase/migrations/0012_moderation.sql`:
  ```sql
  -- Community auto-hide: 3+ distinct reporters hides a sighting/comment pending review.
  select count(distinct reporter_id) into v_count
  from public.abuse_reports where target_type = p_type and target_id = p_id;
  if v_count >= 3 then
    if p_type = 'sighting' then
      update public.sightings set is_hidden = true where id = p_id;
    elsif p_type = 'comment' then
      update public.sighting_updates set is_hidden = true where id = p_id;
    end if;
  end if;
  ```
- Any listing or comment reported by 3 distinct users is immediately hidden (`is_hidden = true`) from all public map views and search queries, preventing community exposure while awaiting moderator review.

### 3.4 In-App User Blocking & Suppression

- **Blocking Action:** Sighting screens provide a **"🚫 Block this user"** button.
- **Database Storage:** Stored in `public.user_blocks` (`blocker_id`, `blocked_id`).
- **RLS Query Filtering:** PostgreSQL Row-Level Security policies on `sighting_updates` automatically filter out comments posted by blocked users:
  ```sql
  create policy "updates are viewable by authenticated"
    on public.sighting_updates for select to authenticated
    using (
      (not is_hidden or author_id = auth.uid() or public.is_moderator())
      and not exists (
        select 1 from public.user_blocks b
        where b.blocker_id = auth.uid() and b.blocked_id = author_id
      )
    );
  ```
- **Block Management:** Dedicated screen at `app/blocked-users.tsx` enables users to view and unblock accounts at any time.

### 3.5 Moderator Dashboard & AI Copilot

- **Moderator Dashboard (`app/moderation.tsx`):**
  - Accessible only to authorized moderators verified via `is_moderator()` RPC.
  - Lists open abuse reports with target preview, report count, reason, and timestamps.
  - Provides one-tap **"Hide"** (takedown) and **"Dismiss"** actions powered by `moderate_content` RPC.
- **AI Moderation Screening:**
  - Background edge functions (`ai-moderate-photo`, `ai-moderate-text`) screen new uploads for cruelty, NSFW, or abusive text.
  - `ai-mod-copilot` provides advisory summaries in the moderator dashboard.
  - **Human-in-the-Loop Governance:** AI screening only flags or hides content into the moderation queue; final account termination and moderation decisions are made by human operators.

---

## 4. Legal Disclosures & Registration Flow Mapping

| Requirement                | In-App Screen                  | Document Path                  | Entry Points                                                                                                                                                    |
| :------------------------- | :----------------------------- | :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy Policy**         | `app/privacy.tsx` (`/privacy`) | `docs/legal/privacy-policy.md` | • Settings screen (`app/settings.tsx`)<br>• Sign-up screen consent notice (`app/(auth)/sign-up.tsx`)                                                            |
| **Terms of Service**       | `app/terms.tsx` (`/terms`)     | `docs/legal/terms.md`          | • Settings screen (`app/settings.tsx`)<br>• Sign-up screen consent notice (`app/(auth)/sign-up.tsx`)                                                            |
| **Sign-Up Consent Notice** | `app/(auth)/sign-up.tsx`       | N/A                            | Prominent text below account creation button: _"By creating an account, you agree to our Terms of Service and Privacy Policy."_ with direct navigational links. |
| **Support Contact**        | In-app legal screens           | `docs/legal/terms.md`          | `rafayetquader@gmail.com`                                                                                                                                       |

---

## 5. Google Play Console Submission Checklist

- [x] **Data Safety Form**: Completed matching `docs/release/DATA_SAFETY.md`.
- [x] **App Access**: No restricted features requiring review credentials beyond standard test user.
- [x] **Ads**: Declared as **No** (App does not contain ads).
- [x] **Content Rating**: Complete questionnaire with UGC and social features declared.
- [x] **Target Audience**: Configured for **13+** (No children under 13).
- [x] **Account Deletion URL**: Configured with `https://guardians-rescue.app/delete-account`.
- [x] **Privacy Policy URL**: Configured with public HTTPS link to Privacy Policy.
