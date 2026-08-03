/**
 * Side-effect CSS imports (web only).
 *
 * `PlatformMap.web.tsx` does `import 'leaflet/dist/leaflet.css'` — Metro bundles
 * it into a real stylesheet for the web build, but TypeScript needs to be told
 * such a module exists or it raises TS2882.
 *
 * This is declared explicitly rather than relying on Expo's generated
 * `.expo/types`, which is gitignored: it exists on a machine that has run
 * `expo start` and is absent in CI, so leaning on it makes typecheck pass
 * locally and fail on the runner.
 */
declare module '*.css';
