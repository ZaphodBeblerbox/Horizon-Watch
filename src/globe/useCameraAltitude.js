/**
 * useCameraAltitude.js — how high the camera is, as React state.
 *
 * State and not a ref, because this decides WHICH markers are drawn as
 * 3D models and that has to go through a render.
 *
 * POLLED, NOT EVENT-DRIVEN AND NOT PER FRAME. Two earlier versions were
 * wrong in opposite ways:
 *
 *   - camera.moveEnd / camera.changed miss a programmatic setView, so
 *     the camera sat at 120,000m while this still reported 4,750,000m
 *     and the models never appeared.
 *   - reading it in scene.preRender fixed that but puts a setState
 *     inside the render loop. Re-rendering thousands of entities from
 *     within a frame can re-enter rendering, and it did: "RangeError:
 *     Maximum call stack size exceeded", which kills the render loop
 *     and freezes the globe.
 *
 * A timer is outside the render loop, cannot be re-entered by it, and
 * cannot go stale. Twice a second is far faster than anyone changes
 * zoom, and the quantisation means most polls change nothing at all.
 */
import { useEffect, useState } from "react"
import { useCesium } from "resium"

/** Altitude granularity. Below this, nothing re-renders. */
const STEP = 5000

/** Slow enough to be free, faster than a human can change zoom. */
const POLL_MS = 500

export default function useCameraAltitude() {
    const ctx = useCesium()
    const [alt, setAlt] = useState(Infinity)

    useEffect(() => {
        const scene = ctx?.scene || ctx?.viewer?.scene
        const camera = ctx?.camera || ctx?.viewer?.camera || scene?.camera
        if (!camera) return
        const read = () => {
            const h = camera.positionCartographic?.height
            if (!Number.isFinite(h)) return
            const q = Math.round(h / STEP) * STEP
            setAlt((prev) => (q === prev ? prev : q))
        }
        read()
        const iv = setInterval(read, POLL_MS)
        return () => clearInterval(iv)
    }, [ctx?.scene, ctx?.camera, ctx?.viewer])

    return alt
}
