/**
 * flightRender.js — keep the globe rendering while a camera flight runs.
 *
 * The viewer renders on demand (requestRenderMode, GlobeView.jsx); a
 * flyTo is tick-driven and never moves while nothing renders — opened from
 * a notification, the camera stayed where it was and the finding's boxes
 * and image (or the vessel's rings) were never seen. GlobeView's
 * akili:fly-to does the same for its own flights.
 *
 * Counted, so overlapping flights (a vessel framed, then its simulated
 * flight) put on-demand rendering back only when the last one ends.
 * Returns the function to call on complete / cancel.
 */
export function renderDuringFlight(viewer) {
    if (!viewer || viewer.isDestroyed()) return () => {}
    const n = viewer.__plxFlights || 0
    // what to put back: on demand, as the viewer is set up (a flight of
    // GlobeView's own may have turned it off for a moment)
    if (n === 0) viewer.__plxRmWas = viewer.scene.requestRenderMode || true
    viewer.__plxFlights = n + 1
    viewer.scene.requestRenderMode = false
    let done = false
    return () => {
        if (done || viewer.isDestroyed()) return
        done = true
        viewer.__plxFlights = Math.max(0, (viewer.__plxFlights || 1) - 1)
        if (viewer.__plxFlights === 0) {
            viewer.scene.requestRenderMode = viewer.__plxRmWas
            viewer.scene.requestRender?.()
        }
    }
}
