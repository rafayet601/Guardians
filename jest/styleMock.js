/**
 * Stub for side-effect CSS imports under Jest.
 *
 * `PlatformMap.web.tsx` does `import 'leaflet/dist/leaflet.css'`. Metro turns
 * that into a real stylesheet for the web build, but Jest would try to parse it
 * as JavaScript, so it is mapped here (see `moduleNameMapper` in jest.config.js).
 */
module.exports = {};
