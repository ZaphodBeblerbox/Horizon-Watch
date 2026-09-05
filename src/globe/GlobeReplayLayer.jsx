import { useEffect, useRef } from "react"
import {
    Cartesian3, Color, CallbackProperty, PolylineDashMaterialProperty,
} from "cesium"

// GlobeReplayLayer.jsx — draws the "Replay on map" walk (see
// src/services/replayOnMap.js) on the one real globe. Plain component
// reading `viewerRef` directly, mirroring GlobePopup.jsx/
// GlobeAnnotationLayer.jsx's real architecture — this needs raw Cesium
// entities with hand-driven, wall-clock-timed CallbackProperty animations
// (grow/fade a ring, draw a dashed line), not a resium declarative tree.
//
// Every animated value here is driven by real elapsed wall time
// (performance.now() read inside a viewer.scene.postRender listener),
// deliberately NOT Cesium's own viewer.clock (whose multiplier/pause state
// a caller could have left in an unexpected state) and NOT a d3 transition
// — matching the build spec's own caution that time-based UI here must stay
// independent of both.

const SEV_COLOR = {
    critical: Color.fromCssColorString("#ef4444"),
    significant: Color.fromCssColorString("#f59e0b"),
    high: Color.fromCssColorString("#f59e0b"),
    elevated: Color.fromCssColorString("#f59e0b"),
    medium: Color.fromCssColorString("#f59e0b"),
    low: Color.fromCssColorString("#22c55e"),
}
function severityColor(sig) {
    return SEV_COLOR[sig?.severity_tier || sig?.severity] || Color.fromCssColorString("#60a5fa")
}

const PING_MS = 700
const STEP_MS = 420

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

export default function GlobeReplayLayer({ viewerRef, isVisible }) {
    const runRef = useRef(null) // { entities: Set, timers: Set, cancelled }

    function clearRun() {
        const run = runRef.current
        if (!run) return
        const viewer = viewerRef.current?.cesiumElement
        run.cancelled = true
        for (const t of run.timers) clearTimeout(t)
        if (viewer) for (const ent of run.entities) viewer.entities.remove(ent)
        runRef.current = null
    }

    // A pulse — grows a point from ~6px to ~46px while fading out, over
    // PING_MS, then removes itself. Used for the target's single "ping once"
    // and for each walked context signal's own expanding ring.
    function addPulse(viewer, run, cartesian, color) {
        const start = performance.now()
        const ent = viewer.entities.add({
            position: cartesian,
            point: {
                pixelSize: new CallbackProperty(() => {
                    const t = Math.min(1, (performance.now() - start) / PING_MS)
                    return 6 + easeOutCubic(t) * 40
                }, false),
                color: new CallbackProperty(() => {
                    const t = Math.min(1, (performance.now() - start) / PING_MS)
                    return color.withAlpha(1 - easeOutCubic(t))
                }, false),
                outlineWidth: 0,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
        run.entities.add(ent)
        const t = setTimeout(() => {
            if (run.cancelled) return
            viewer.entities.remove(ent)
            run.entities.delete(ent)
        }, PING_MS + 30)
        run.timers.add(t)
    }

    function addConvergingLine(viewer, run, fromCartesian, toCartesian, color) {
        const ent = viewer.entities.add({
            polyline: {
                positions: [fromCartesian, toCartesian],
                width: 1.5,
                material: new PolylineDashMaterialProperty({ color, dashLength: 12 }),
                clampToGround: false,
            },
        })
        run.entities.add(ent)
    }

    useEffect(() => {
        function handler(e) {
            const viewer = viewerRef.current?.cesiumElement
            if (!viewer) return
            clearRun() // a new walk always supersedes whatever's still playing

            const { target, context = [] } = e.detail || {}
            if (target?.lat == null || target?.lon == null) return
            const run = { entities: new Set(), timers: new Set(), cancelled: false }
            runRef.current = run

            const targetCartesian = Cartesian3.fromDegrees(Number(target.lon), Number(target.lat))
            const targetColor = severityColor(target)

            // Ping once on the target itself.
            addPulse(viewer, run, targetCartesian, targetColor)

            // Then walk the real chronological context, 420ms apart —
            // each step draws a converging dashed line plus its own pulse.
            context.forEach((sig, i) => {
                const t = setTimeout(() => {
                    if (run.cancelled) return
                    if (sig.lat == null || sig.lon == null) return
                    const cartesian = Cartesian3.fromDegrees(Number(sig.lon), Number(sig.lat))
                    const color = severityColor(sig)
                    addConvergingLine(viewer, run, cartesian, targetCartesian, color)
                    addPulse(viewer, run, cartesian, color)
                }, (i + 1) * STEP_MS)
                run.timers.add(t)
            })

            // "...then clear" — once the walk finishes, drop everything
            // (converging lines included) after one more beat.
            const clearAt = (context.length + 1) * STEP_MS + PING_MS + 400
            const finalTimer = setTimeout(() => {
                if (runRef.current === run) clearRun()
            }, clearAt)
            run.timers.add(finalTimer)
        }
        window.addEventListener("akili:replay-on-map", handler)
        return () => { window.removeEventListener("akili:replay-on-map", handler); clearRun() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewerRef])

    // Navigating away mid-walk clears it immediately rather than leaving
    // orphaned entities animating on a hidden globe.
    useEffect(() => {
        if (!isVisible) clearRun()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible])

    useEffect(() => () => clearRun(), [])

    return null
}
