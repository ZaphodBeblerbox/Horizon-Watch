/**
 * GlobeFollowLayer.jsx — double-click a contact to lock onto it.
 *
 * Zooms in, follows it, and orbits slowly at a shallow angle so the
 * thing is shown from every side while it keeps moving. Reading a 3D
 * model from directly overhead tells you very little; a slow orbit at
 * 25° is what makes it legible as a widebody rather than a regional jet.
 *
 * DRIVES THE CAMERA DIRECTLY rather than using viewer.trackedEntity.
 * Tracking plus flyTo looked like the obvious route and did not work:
 * flyTo resolves against a bounding sphere, and these entities carry a
 * callback position that is re-evaluated every frame, so the flight
 * never settled and tracking was never armed. Computing the camera
 * position each frame from the entity's current position has no such
 * dependency, and it puts the orbit rate and angle under our control
 * instead of Cesium's.
 */
import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType,
    HeadingPitchRange, Matrix4, Math as CesiumMath,
} from "cesium"

/** Close enough to read the airframe, far enough to keep context. */
const AIRCRAFT_RANGE_M = 1500
const VESSEL_RANGE_M   = 2200

/** Shallow enough to see the plan shape, steep enough to see the side. */
const PITCH_DEG = -25

/** A full turn in roughly two minutes: present, not distracting. */
const ORBIT_RAD_PER_SEC = 0.05

/**
 * How long after locking on to ignore release input.
 *
 * The double-click that takes the lock is itself made of presses, and
 * relying on Cesium to deliver LEFT_DOUBLE_CLICK after the last
 * LEFT_DOWN does not hold — wiring the press as a release silently
 * stopped the lock from ever engaging. A grace window does not care
 * what order the events arrive in.
 */
const RELEASE_GRACE_MS = 500

const FOLLOWABLE = /^(adsb|ais)-/

export default function GlobeFollowLayer({ enabled = true }) {
    const ctx = useCesium()
    const followRef = useRef(null)   // { entity, range, heading, last }

    useEffect(() => {
        const viewer = ctx?.viewer
        const scene = ctx?.scene || viewer?.scene
        if (!viewer || !scene || !enabled) return

        const handler = new ScreenSpaceEventHandler(scene.canvas)

        const stop = () => {
            if (!followRef.current) return
            // Ignore the tail of the gesture that started the lock.
            if (performance.now() - followRef.current.startedAt < RELEASE_GRACE_MS) return
            followRef.current = null
            if (!viewer.isDestroyed?.()) {
                // Release the reference frame, or every later camera move
                // stays relative to a contact that is no longer followed.
                viewer.camera.lookAtTransform(Matrix4.IDENTITY)
            }
        }

        handler.setInputAction((movement) => {
            const picked = scene.pick(movement.position)
            const entity = picked?.id
            const id = entity && String(entity.id || "")
            if (!id || !FOLLOWABLE.test(id)) return
            followRef.current = {
                entity,
                range: id.startsWith("adsb-") ? AIRCRAFT_RANGE_M : VESSEL_RANGE_M,
                heading: viewer.camera.heading,
                last: performance.now(),
                // Eased in, so locking on is a move rather than a jump.
                startedAt: performance.now(),
                fromRange: Math.max(2000, viewer.camera.positionCartographic?.height || 2000),
            }
        }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

        // ANY DELIBERATE CAMERA INPUT RELEASES THE LOCK. Escape and a
        // right-click were the only ways out, which meant the obvious
        // instincts — scroll to zoom out, drag to look elsewhere — did
        // nothing at all and the camera appeared stuck. Wheel, drag and
        // pinch all mean "I want to drive now", so they all release.
        handler.setInputAction(stop, ScreenSpaceEventType.RIGHT_CLICK)
        handler.setInputAction(stop, ScreenSpaceEventType.WHEEL)
        handler.setInputAction(stop, ScreenSpaceEventType.LEFT_DOWN)
        handler.setInputAction(stop, ScreenSpaceEventType.MIDDLE_DOWN)
        handler.setInputAction(stop, ScreenSpaceEventType.PINCH_START)

        const follow = () => {
            const f = followRef.current
            if (!f) return
            const now = performance.now()
            const dt = Math.min(0.25, (now - f.last) / 1000)
            f.last = now

            const pos = f.entity.position?.getValue(viewer.clock.currentTime)
            if (!pos || f.entity.isDestroyed?.()) { stop(); return }

            f.heading += ORBIT_RAD_PER_SEC * dt

            // Ease the range over the first second and a half.
            const t = Math.min(1, (now - f.startedAt) / 1500)
            const eased = t * t * (3 - 2 * t)
            const range = f.fromRange + (f.range - f.fromRange) * eased

            viewer.camera.lookAt(pos, new HeadingPitchRange(
                f.heading, CesiumMath.toRadians(PITCH_DEG), range))
            scene.requestRender?.()
        }
        scene.postUpdate.addEventListener(follow)

        const onKey = (e) => { if (e.key === "Escape") stop() }
        window.addEventListener("keydown", onKey)

        return () => {
            window.removeEventListener("keydown", onKey)
            scene.postUpdate.removeEventListener(follow)
            if (!handler.isDestroyed()) handler.destroy()
            if (followRef.current && !viewer.isDestroyed?.()) {
                viewer.camera.lookAtTransform(Matrix4.IDENTITY)
            }
            followRef.current = null
        }
    }, [ctx?.viewer, ctx?.scene, enabled])

    return null
}
