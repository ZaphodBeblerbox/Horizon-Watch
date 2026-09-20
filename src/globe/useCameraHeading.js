/**
 * useCameraHeading.js — the camera's compass heading, read once a frame.
 *
 * Markers need this to keep their nose on a true bearing (see
 * markerOrientation.js). The obvious way — camera heading in React
 * state — re-renders every marker in the layer on every frame of a
 * globe rotation, which is thousands of React elements rebuilt while
 * the user is dragging. This instead keeps the value in a ref that one
 * per-frame listener updates, so each marker's rotation callback reads
 * a number and nothing re-renders at all.
 */
import { useEffect, useRef } from "react"
import { useCesium } from "resium"

export default function useCameraHeading() {
    const ctx = useCesium()
    const ref = useRef(0)

    useEffect(() => {
        const scene = ctx?.scene || ctx?.viewer?.scene
        const camera = ctx?.camera || ctx?.viewer?.camera || scene?.camera
        if (!scene || !camera) return
        const update = () => {
            const h = camera.heading
            // Degrades to north-up rather than to NaN, which would put
            // every marker at an undefined rotation.
            ref.current = Number.isFinite(h) ? h : 0
        }
        update()
        scene.preRender.addEventListener(update)
        return () => { scene.preRender.removeEventListener(update) }
    }, [ctx?.scene, ctx?.camera, ctx?.viewer])

    return ref
}
