// Side-effect asset imports (CSS in particular). expo-env.d.ts normally
// provides these declarations via expo/types, but that file is gitignored and
// generated only in local dev — CI typechecks without it, so the Leaflet CSS
// import in PlatformMap.web.tsx would otherwise fail as TS2882.
declare module '*.css';
