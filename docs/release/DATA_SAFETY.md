# Google Play Console Data Safety Reference Guide

**App Name:** Guardians  
**Package Identifier:** `com.guardians.app`  
**Document Purpose:** Definitive reference and questionnaire submission guide for the Google Play Console **Data Safety** section in compliance with Google Play Developer Program Policies.

---

## 1. Executive Summary & Security Practices

Google Play requires developers to disclose data collection, sharing, handling practices, and security mechanisms. The table below summarizes the top-level security and policy declarations for Guardians:

| Play Console Question                                                                                    | Response | Technical Implementation / Details                                                                                                                                                        |
| :------------------------------------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does your app collect or share any of the required user data types?**                                  | **Yes**  | The app collects data required for core community cat rescue, location-based reporting, gamification, and diagnostics.                                                                    |
| **Is all user data collected by your app encrypted in transit?**                                         | **Yes**  | All network communication between the client, backend APIs (Supabase), and third-party sub-processors is enforced over **HTTPS / TLS 1.3** with modern cipher suites.                     |
| **Do you provide a way for users to request that their data be deleted?**                                | **Yes**  | Users can delete their account directly within the app via **Settings → Delete account** or via the public web deletion request endpoint (`https://guardians-rescue.app/delete-account`). |
| **Does your app provide a way for users to request data deletion without deleting their whole account?** | **No**   | Account deletion removes all personal data; individual sightings or comments can be deleted or edited directly within the app.                                                            |
| **Is this app targeted at children under 13?**                                                           | **No**   | Target audience is 13 years and older (configured in Play Console Target Audience & Content section).                                                                                     |

---

## 2. Master Data Safety Declaration Table

Use the exact values below when completing the Google Play Console **Data Safety** questionnaire:

| Data Type Category         | Specific Data Type                                                                            | Collected?                          | Shared?                                                                                                           | Ephemeral?                          | Required / Optional                                                               | Stated Purposes                                                 |
| :------------------------- | :-------------------------------------------------------------------------------------------- | :---------------------------------- | :---------------------------------------------------------------------------------------------------------------- | :---------------------------------- | :-------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **Location**               | **Approximate location** (coordinates rounded to ~110m resolution)                            | **Yes**                             | **Yes** (Shared with community on public map & push notifications)                                                | No (Stored in Postgres)             | **Optional** (Users can browse the map and search manually without GPS)           | • App functionality<br>• Developer communications (Push alerts) |
| **Location**               | **Precise location** (exact GPS pin of cat sighting)                                          | **Yes**                             | **No** (Restricted via PostgreSQL PostGIS RPC `get_sighting_detail` to the original reporter & assigned guardian) | No (Stored in PostGIS)              | **Optional** (Users can adjust pin manually)                                      | • App functionality                                             |
| **Personal info**          | **Name / Username** (`username`, optional `full_name`)                                        | **Yes**                             | **Yes** (Publicly displayed on cat sightings, comments, and leaderboard)                                          | No (Stored in Postgres)             | **Username:** Required<br>**Full name:** Optional                                 | • App functionality<br>• Account management                     |
| **Personal info**          | **Email address**                                                                             | **Yes**                             | **No** (Stored securely in `auth.users`; never exposed in client APIs)                                            | No (Stored in Supabase Auth)        | **Required** (For authentication and password reset)                              | • Account management<br>• Developer communications              |
| **Personal info**          | **User IDs** (Supabase Auth UUIDs)                                                            | **Yes**                             | **No** (Internal relational identifier)                                                                           | No (Stored in DB)                   | **Required**                                                                      | • App functionality<br>• Account management                     |
| **Photos and videos**      | **Photos** (Cat sighting pictures, rescue progress photos, profile avatars)                   | **Yes**                             | **Yes** (Publicly displayed in rescue listings and user profiles via Supabase Storage CDN)                        | No (Stored in Supabase Storage)     | **Optional** (Sightings can be submitted with basic details, photos are optional) | • App functionality<br>• Community sharing                      |
| **Messages**               | **In-app updates / comments** (Rescue timeline updates, community comments)                   | **Yes**                             | **Yes** (Visible to all registered users on sighting timeline)                                                    | No (Stored in Postgres)             | **Optional**                                                                      | • App functionality<br>• Community communication                |
| **App activity**           | **App interactions** (Cat rescues claimed, sightings created, points earned, badges unlocked) | **Yes**                             | **Yes** (Displayed on public user profile and leaderboard)                                                        | No (Stored in Postgres)             | **Required** (Inherent to core gamification mechanics)                            | • App functionality<br>• Analytics                              |
| **App info & performance** | **Crash logs & Diagnostics** (Stack traces, device model, OS version via Sentry)              | **Yes** (When Sentry is configured) | **Yes** (Transmitted to Sentry.io sub-processor)                                                                  | No (Stored for 90 days in Sentry)   | **Optional** (Crash reporting runs automatically to diagnose bugs)                | • Analytics<br>• App functionality<br>• Developer diagnostics   |
| **Device or other IDs**    | **Device Push Token** (Expo Push Notification Token)                                          | **Yes**                             | **Yes** (Sent to Expo push notification gateway for delivery)                                                     | No (Stored in `device_push_tokens`) | **Optional** (Opt-in toggle in app settings)                                      | • App functionality<br>• Push notifications                     |

---

## 3. Data Retention & Deletion Cascading Architecture

### 3.1 Account Deletion Flow (Play Store Account Deletion Requirement)

Guardians fully complies with Google Play's May 2024 Account Deletion Policy by providing both an **in-app deletion mechanism** and a **public web deletion request URL**:

1. **In-App Deletion:**
   - Location: `app/settings.tsx` (`Delete account` destructive button).
   - Confirmation: User is presented with a clear warning explaining permanent loss of points, badges, and account history.
   - Execution: Invokes the Supabase Edge Function `delete-account` with the user's authenticated JWT.
   - Backend Handler (`supabase/functions/delete-account/index.ts`): Uses `SUPABASE_SERVICE_ROLE_KEY` to execute `admin.auth.admin.deleteUser(user.id)`.

2. **Database Cascade Policy:**
   - **Hard Delete (`ON DELETE CASCADE`):**
     - `public.profiles` — Username, avatar URL, points, level, and metadata are permanently erased.
     - `public.device_push_tokens` — Push tokens and associated coarse coordinates are deleted immediately.
     - `public.adoption_interest` — Adoption applications and user messages are purged.
     - `public.user_badges` & `public.point_events` — Gamification ledger is permanently purged.
     - `public.user_blocks` — Block relationships are removed.
     - `public.abuse_reports` — User-filed reports are removed.
   - **Anonymized Retention (`ON DELETE SET NULL`):**
     - `public.sightings` (`reporter_id` → `NULL`, `claimed_by` → `NULL`) — Rescue records remain on the community map to protect stray cats from duplicated rescue operations, but all attribution and link to the deleted user are permanently severed.
     - `public.sighting_updates` (`author_id` → `NULL`) — Rescue progress comments remain anonymized.

3. **Storage Cleanup:**
   - User avatars in `avatars/<user_id>/*` are deleted upon account removal.
   - Uploaded cat photos remain attached to anonymized sighting records to maintain community rescue integrity.

4. **Web Account Deletion Endpoint:**
   - Web URL for Play Console: `https://guardians-rescue.app/delete-account` (or `https://guardians-rescue.app/privacy#account-deletion`).
   - Enables users who have uninstalled the app to submit an account deletion request via email or web form.

---

## 4. Third-Party Sub-Processors & Data Sharing

Data shared with third-party service providers is limited strictly to operating core app features. No personal data is sold or shared with third parties for marketing or advertising purposes.

| Service Provider                      | Entity / Location | Purpose                                                                           | Data Transmitted                                                           | Compliance & Terms                                                                                        |
| :------------------------------------ | :---------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Supabase Inc.**                     | USA / Global AWS  | Cloud backend, Postgres database, Authentication, File storage, Edge Functions    | Auth credentials, profiles, sightings, coordinates, photos                 | SOC 2 Type II, GDPR, HIPAA compliant; TLS 1.3 encryption at rest and in transit                           |
| **Google LLC (Google Maps Platform)** | USA               | Map rendering and geospatial viewport visualization                               | Map viewport bounding box, approximate user coordinates                    | Google Cloud Privacy Policy, SDK terms                                                                    |
| **650 Industries Inc. (Expo)**        | USA               | Push notification relay to Apple APNs and Google FCM                              | Expo Push Token, coarse notification payloads                              | Expo Privacy Policy, TLS 1.3 transmission                                                                 |
| **Functional Software Inc. (Sentry)** | USA               | Application monitoring, error tracking, crash diagnostics                         | Unhandled exceptions, stack traces, device OS/version, app release version | SOC 2 Type II, zero personally identifiable information (PII) scrubbed by default                         |
| **Anthropic PBC (Claude API)**        | USA               | AI photo autofill (cat color/markings) and automated content moderation screening | Sighting photos and description text                                       | Commercial Terms with **Zero Data Retention (ZDR)**; requests are not retained or used for model training |
| **Voyage AI Inc.**                    | USA               | Vector embeddings for cat Re-Identification and knowledge search                  | Cat image crops and textual descriptions                                   | Zero data retention commercial API                                                                        |

---

## 5. Play Console Form Filling Cheat Sheet

When entering data in the Google Play Console UI under **App Content → Data safety**, follow this step-by-step decision tree:

### Step 1: Data Collection and Security

- **Does your app collect or share any of the required user data types?** → Select **Yes**.
- **Is all of the user data collected by your app encrypted in transit?** → Select **Yes**.
- **Do you provide a way for users to request that their data be deleted?** → Select **Yes**.
- **Add your account deletion URL:** → Enter `https://guardians-rescue.app/delete-account` (or public privacy URL).

### Step 2: Data Types Selection

Check the following checkboxes:

1. **Location**:
   - Approximate location
   - Precise location
2. **Personal info**:
   - Name
   - Email address
   - User IDs
3. **Photos and videos**:
   - Photos
4. **Messages**:
   - Other in-app messages (rescue updates/comments)
5. **App activity**:
   - App interactions
6. **App info and performance**:
   - Crash logs
   - Diagnostics
7. **Device or other IDs**:
   - Device or other IDs (push notification token)

### Step 3: Specific Data Type Details

For each selected data type, answer the sub-questions as follows:

#### Approximate Location:

- Collected? **Yes**
- Shared? **Yes**
- Processed ephemerally? **No**
- Is this data required for your app, or can users choose whether it's collected? **Data collection is optional**
- Why is this user data collected? Check **App functionality**, **Developer communications**.
- Why is this user data shared? Check **App functionality**.

#### Precise Location:

- Collected? **Yes**
- Shared? **No**
- Processed ephemerally? **No**
- Is this data required? **Data collection is optional**
- Why is this user data collected? Check **App functionality**.

#### Name / Username:

- Collected? **Yes**
- Shared? **Yes**
- Processed ephemerally? **No**
- Is this data required? **Data collection is required** (Username)
- Why is this user data collected? Check **App functionality**, **Account management**.
- Why is this user data shared? Check **App functionality**.

#### Email Address:

- Collected? **Yes**
- Shared? **No**
- Processed ephemerally? **No**
- Is this data required? **Data collection is required**
- Why is this user data collected? Check **App functionality**, **Account management**, **Developer communications**.

#### User IDs:

- Collected? **Yes**
- Shared? **No**
- Processed ephemerally? **No**
- Is this data required? **Data collection is required**
- Why is this user data collected? Check **App functionality**, **Account management**.

#### Photos:

- Collected? **Yes**
- Shared? **Yes**
- Processed ephemerally? **No**
- Is this data required? **Data collection is optional**
- Why is this user data collected? Check **App functionality**.
- Why is this user data shared? Check **App functionality**.

#### Messages (In-App Comments & Updates):

- Collected? **Yes**
- Shared? **Yes**
- Processed ephemerally? **No**
- Is this data required? **Data collection is optional**
- Why is this user data collected? Check **App functionality**.
- Why is this user data shared? Check **App functionality**.

#### App Activity (Interactions):

- Collected? **Yes**
- Shared? **Yes**
- Processed ephemerally? **No**
- Is this data required? **Data collection is required**
- Why is this user data collected? Check **App functionality**, **Analytics**.
- Why is this user data shared? Check **App functionality**.

#### Crash Logs & Diagnostics:

- Collected? **Yes**
- Shared? **Yes** (To Sentry)
- Processed ephemerally? **No**
- Is this data required? **Data collection is optional**
- Why is this user data collected? Check **App functionality**, **Analytics**.
- Why is this user data shared? Check **App functionality**, **Analytics**.

#### Device or Other IDs (Push Tokens):

- Collected? **Yes**
- Shared? **Yes** (To Expo)
- Processed ephemerally? **No**
- Is this data required? **Data collection is optional**
- Why is this user data collected? Check **App functionality**, **Developer communications**.
- Why is this user data shared? Check **App functionality**.
