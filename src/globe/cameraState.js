// cameraState.js — the real, live Cesium camera position + orientation
// (V3 Phase 1, §5.1). GlobeView.jsx publishes here on every real camera
// move (extending its existing camera.moveEnd listener, not a second one);
// anything that needs "what is the camera looking at right now" (a
// session-save action) reads it directly — no event round-trip needed,
// matching the plain-pub/sub idiom already established by
// annotationStore.js/briefingBasket.js.
//
// This is a real position+orientation snapshot (lon/lat/height/heading/
// pitch/roll) — not the much narrower lat/lon+discrete-zoom-level the old
// client-only "Workspace" concept captured, and not Cesium's own disabled
// home-button feature (homeButton={false} in GlobeView.jsx, confirmed via
// audit to be deliberately off, not accidentally unused).

let current = null
const listeners = new Set()

export function publishCameraState(state) {
    current = state
    listeners.forEach((fn) => fn(current))
}

export function getCameraState() {
    return current
}

export function subscribeCameraState(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/** Real restore — dispatched to GlobeView.jsx's own akili:set-camera
 * listener, which owns the actual viewer.camera.setView() call (this
 * module never touches Cesium directly, matching the existing
 * akili:fly-to integration pattern for code outside GlobeView). Restore is
 * instantaneous (setView, not flyTo) — switching sessions is meant to feel
 * like resuming a desk, not an animated tour. */
export function restoreCameraState(state) {
    if (!state) return
    window.dispatchEvent(new CustomEvent("akili:set-camera", { detail: state }))
}
