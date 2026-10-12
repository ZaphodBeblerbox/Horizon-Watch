/**
 * useGlidingPosition.js — a Cesium position that glides between live fixes
 * (location/glide.js), for an entity on the globe that a phone moves.
 *
 * The globe renders only when asked (scene.requestRenderMode), so every
 * frame of a glide asks for one; standing still costs nothing.
 */
import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import { CallbackProperty, Cartesian3 } from "cesium"
import { createGlide } from "../location/glide.js"

export function useGlidingPosition(lat, lon, gapMs) {
    const { viewer } = useCesium() || {}
    const viewerRef = useRef(viewer)
    viewerRef.current = viewer
    const ref = useRef(null)
    if (!ref.current) {
        const glide = createGlide({ onFrame: () => { const v = viewerRef.current; if (v && !v.isDestroyed?.()) v.scene?.requestRender?.() } })
        glide.set({ lat, lon })
        const prop = new CallbackProperty(() => {
            const p = glide.position()
            return p ? Cartesian3.fromDegrees(p.lon, p.lat, 0) : undefined
        }, false)
        ref.current = { glide, prop }
    }
    useEffect(() => { ref.current.glide.set({ lat, lon }, gapMs) }, [lat, lon]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => ref.current?.glide.stop(), [])
    return ref.current.prop
}

/** Ask the globe for a frame every `everyMs` while `on` (a label that counts). */
export function useRenderTick(on, everyMs = 1000) {
    const { viewer } = useCesium() || {}
    useEffect(() => {
        if (!on || !viewer) return undefined
        const id = setInterval(() => { if (!viewer.isDestroyed?.()) viewer.scene?.requestRender?.() }, everyMs)
        return () => clearInterval(id)
    }, [on, viewer, everyMs])
}
