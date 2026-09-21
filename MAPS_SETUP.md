# Live maps setup

Guardians uses Google Maps on Android, Google Maps on iOS when an iOS key is
configured (otherwise Apple Maps), and Leaflet/OpenStreetMap on web. Sightings
come from the Supabase `nearby_sightings` RPC, not from Google. They refresh every
30 seconds while the map is focused and the app is active. This is periodic
refresh, not instantaneous tracking. Exact-coordinate access remains enforced by
the backend. No background user tracking is added.

## Google Cloud account setup

Use the existing Guardians project with billing enabled. Enable **Maps SDK for
Android** and, if using Google Maps on iOS, **Maps SDK for iOS**. The current
standard mobile Maps SDK SKU has unlimited no-charge map loads. Billing must
still be enabled. Places, Routes, Geocoding API and Street View have separate
billing; none is needed to display this native map and its cat markers.

Create separate keys:

| Key     | Application restriction                                                      | API restriction      |
| ------- | ---------------------------------------------------------------------------- | -------------------- |
| Android | Android apps: package `com.guardians.app` plus the signing certificate SHA-1 | Maps SDK for Android |
| iOS     | iOS apps: bundle ID `com.guardians.app`                                      | Maps SDK for iOS     |

For Android, register each certificate used to sign an installed build. The EAS
build certificate and Google Play **app signing** certificate can differ. The
upload certificate alone does not authorize Google Play installations. Find the
Play certificate under App integrity / App signing, and the EAS certificate in
its project credentials. Prefer separate development and production keys.

Do not share an unrestricted key between platforms. Do not commit API keys or
paste them into issue/PR bodies. Native client keys are extractable from builds;
application and API restrictions are what protect them.

## Build configuration

Add these values to your ignored local `.env`, and to the matching EAS
environment (development, preview or production) for cloud builds:

```dotenv
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=<restricted Android key>
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=<restricted iOS key, or leave blank for Apple Maps>
```

`app.config.ts` passes these values to the `react-native-maps` config plugin,
which injects Android manifest metadata and the iOS Google Maps pod and SDK
initialization. Example placeholder keys are ignored. Changing a key or enabling
Google Maps on iOS requires a **new native binary**, not only an OTA update or
Metro restart. Use the same environment values when exporting OTA updates.

Run `npm run release:check -- android` with production variables available, then
build using the production EAS profile. The check validates required values; it
cannot prove Google API enablement, billing or certificate restrictions. An Expo
Go map is not evidence that a standalone build's keys are correct.

## Acceptance on real devices

1. Install a signed Android build and confirm street tiles render. Repeat with a
   Play internal-test installation to verify the Play signing restriction.
2. Install an iOS build with its restricted key and confirm Google tiles render.
3. Allow foreground location. Confirm the blue dot and recenter control use your
   current location; deny permission and confirm manual browsing still works.
4. Report a cat from another account. Leave the first device on the map and
   confirm the sighting appears within the next refresh after the write completes.
5. Claim/update the sighting, check status filters, and verify an unauthorized
   account sees only the permitted approximate location.
6. Disconnect networking: confirm refresh errors appear and retry after reconnect.
7. Confirm Google Cloud usage shows the expected Maps SDK SKU. Set billing alerts
   for the project; alerts notify rather than impose a hard spending limit. Leave
   unused paid APIs disabled and restrict quotas when adding paid features.

Web still uses OpenStreetMap and requires HTTPS for browser location outside
localhost. Its public tile service has a usage policy and no availability SLA;
review the policy before scaling. Web address search via expo-location is not
supported; users can pan/zoom to an area. A Google web map/search integration
would require a separate website-restricted key and a usage budget.

## References

- [Expo SDK 57 native Maps setup](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/)
- [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Android credentials](https://developers.google.com/maps/documentation/android-sdk/get-api-key)
- [iOS credentials](https://developers.google.com/maps/documentation/ios-sdk/get-api-key)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
