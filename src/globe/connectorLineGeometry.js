/**
 * connectorLineGeometry.js — pure coordinate-validation logic extracted out
 * of GlobeConnectorLinesLayer.jsx so it's testable without mounting Cesium/
 * resium (matches this repo's existing convention of pure-logic .js modules
 * — e.g. mapReadout.js — imported by both a .jsx component and a
 * plain vitest .test.js file).
 *
 * Real, confirmed root cause this exists to prevent regressing: the global
 * `isFinite()` coerces its argument with ToNumber before testing —
 * `isFinite(null)` is `true` (because `Number(null) === 0`, and 0 is
 * finite). A real connection with no map position (e.g. an abstract
 * Country/Faction node — routers/forge.py's `_real_node_attributes`) has
 * `lat: null, lng: null` in the real JSON the backend returns. The old
 * `isFinite(c.lat) && isFinite(c.lng)` filter let that straight through,
 * and `null` was then passed to Cesium's Cartesian3.fromDegrees(), which
 * throws "Expected longitude to be typeof number, actual typeof was
 * object" — `typeof null === "object"` in JS, matching that error exactly.
 */

/** `Number.isFinite` never coerces (`Number.isFinite(null) === false`,
 * unlike bare `isFinite`), so this is the real fix — not stricter than
 * needed: a genuinely numeric 0 (equator/prime meridian) still passes. */
export function isRealFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v)
}

/**
 * Real connections filtered down to only those with a real, drawable map
 * position — per the connector-lines spec's own rule ("an entity without
 * map coordinates should still be listed... just without a drawn line to
 * nowhere"), never a fabricated fallback coordinate for the rest.
 */
export function selectRealConnectorTargets(connections) {
    return (connections || []).filter(c => isRealFiniteNumber(c.lat) && isRealFiniteNumber(c.lng))
}
