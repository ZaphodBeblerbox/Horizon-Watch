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
import { nextRange, pitchForRange } from "./followZoom.js"
import {
    ScreenSpaceEventHandler, ScreenSpaceEventType,
    HeadingPitchRange, Matrix4, Math as CesiumMath, Cartographic, Cartesian3,
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
// How long a followed contact may be missing before the lock gives up.
const LOST_GRACE_MS = 8000

const FOLLOWABLE = /^(adsb|ais)-/


export default function GlobeFollowLayer({ enabled = true }) {
    const ctx = useCesium()
    const followRef = useRef(null)   // { entity, range, heading, last }

    useEffect(() => {
        const viewer = ctx?.viewer
        const scene = ctx?.scene || viewer?.scene
        if (!viewer || !scene || !enabled) return

        const handler = new ScreenSpaceEventHandler(scene.canvas)

        // CESIUM'S OWN ZOOM HAS TO BE TURNED OFF, NOT JUST INTERCEPTED.
        //
        // Registering a WHEEL action here does not stop
        // ScreenSpaceCameraController from handling the same wheel — both
        // run. And while camera.lookAt is active the camera sits in a
        // LOCAL reference frame, so camera.positionCartographic.height is
        // not a height above the ground at all. Cesium scales each zoom
        // step by exactly that value, so one notch became an astronomical
        // step and the view ended up in space. That is the reported bug.
        const ssc = scene.screenSpaceCameraController
        const zoomWasEnabled = ssc ? ssc.enableZoom : true
        // ALL of Cesium's camera inputs are off while locked, not just
        // zoom: its rotate/tilt/translate ran alongside the lock and the
        // two fought, which is what made moving around a followed contact
        // jump. The lock now owns the camera; it gives it back on release.
        const SSC_KEYS = ["enableZoom", "enableRotate", "enableTilt", "enableTranslate", "enableLook"]
        let saved = null
        const takeCamera = () => {
            if (!ssc || saved) return
            saved = Object.fromEntries(SSC_KEYS.map((k) => [k, ssc[k]]))
            SSC_KEYS.forEach((k) => { ssc[k] = false })
        }
        const giveCamera = () => {
            if (ssc && saved) SSC_KEYS.forEach((k) => { ssc[k] = saved[k] })
            saved = null
        }

        // A hint while locked: how to look around and how to leave.
        const hint = document.createElement("div")
        Object.assign(hint.style, {
            position: "absolute", left: "50%", bottom: "64px", transform: "translateX(-50%)", zIndex: 5,
            padding: "7px 14px", borderRadius: "16px", background: "rgba(11,18,32,.82)", color: "#e8ecf1",
            font: "500 12.5px system-ui, sans-serif", pointerEvents: "none", display: "none", whiteSpace: "nowrap",
        })
        viewer.container?.appendChild(hint)
        const showHint = (label) => {
            hint.textContent = `Following ${label} · drag to look around · scroll to zoom · right-drag, Esc or a click to leave`
            hint.style.display = "block"
        }

        const stop = (force = false) => {
            if (!followRef.current) return
            // Ignore the tail of the gesture that started the lock.
            if (!force && performance.now() - followRef.current.startedAt < RELEASE_GRACE_MS) return
            followRef.current = null
            hint.style.display = "none"
            giveCamera()
            if (ssc) ssc.enableZoom = zoomWasEnabled
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
            takeCamera()
            const label = (entity.label?.text?.getValue?.(viewer.clock.currentTime) || entity.name || id.replace(/^(adsb|ais)-/, "")).trim()
            showHint(label || "contact")
            followRef.current = {
                id,
                pitch: CesiumMath.toRadians(PITCH_DEG),
                orbiting: true,
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
        handler.setInputAction(() => stop(), ScreenSpaceEventType.RIGHT_CLICK)

        // THE WHEEL ZOOMS THE CONTACT, IT DOES NOT FLEE IT. Scrolling
        // used to release the lock, which was right when the lock
        // ignored the wheel entirely and left people feeling trapped.
        // Now that it can be zoomed, the obvious reading of a scroll is
        // "get closer to this", so that is what it does — and pulling
        // back past MAX_RANGE_M still releases, which is the same
        // escape by a gesture that means it.
        handler.setInputAction((delta) => {
            const f = followRef.current
            if (!f) return
            const next = nextRange(f.range, delta)
            if (next === null) {
                // Pulled back far enough to mean "done": let go looking
                // straight down at the contact from that height, so the
                // map is where you left it — not the horizon, not space.
                const ent = viewer.entities.getById(f.id)
                const pos = ent?.position?.getValue(viewer.clock.currentTime)
                const heading = f.heading
                stop(true)
                if (pos && !viewer.isDestroyed?.()) {
                    const c = Cartographic.fromCartesian(pos)
                    viewer.camera.setView({
                        destination: Cartesian3.fromRadians(c.longitude, c.latitude, f.range * 1.15),
                        orientation: { heading, pitch: CesiumMath.toRadians(-90), roll: 0 },
                    })
                    scene.requestRender?.()
                }
                return
            }
            f.range = next
            // The ease targets this too, or an early scroll is undone by
            // the lock-on animation still running.
            f.fromRange = f.range
            f.startedAt = 0
            scene.requestRender?.()
        }, ScreenSpaceEventType.WHEEL)
        // LEFT-DRAG LOOKS AROUND THE CONTACT; a left click without a drag
        // leaves. Dragging used to release the lock, so the obvious way to
        // see the other side of a ship ended the follow.
        let drag = null
        handler.setInputAction((e) => {
            if (!followRef.current) return
            drag = { x: e.position.x, y: e.position.y, moved: false }
        }, ScreenSpaceEventType.LEFT_DOWN)
        handler.setInputAction((m) => {
            const f = followRef.current
            if (!f || !drag) return
            const dx = m.endPosition.x - m.startPosition.x, dy = m.endPosition.y - m.startPosition.y
            if (Math.abs(m.endPosition.x - drag.x) + Math.abs(m.endPosition.y - drag.y) > 4) drag.moved = true
            f.orbiting = false                              // the user is driving: no auto-orbit
            f.heading -= dx * 0.006
            f.pitch = Math.max(CesiumMath.toRadians(-88), Math.min(CesiumMath.toRadians(-4), f.pitch - dy * 0.005))
            scene.requestRender?.()
        }, ScreenSpaceEventType.MOUSE_MOVE)
        handler.setInputAction(() => {
            const wasClick = drag && !drag.moved
            drag = null
            if (wasClick) stop()
        }, ScreenSpaceEventType.LEFT_UP)
        // PANNING AWAY LEAVES: right- or middle-drag and a two-finger pan
        // release the lock and hand the camera back mid-gesture.
        handler.setInputAction(() => stop(true), ScreenSpaceEventType.RIGHT_DOWN)
        handler.setInputAction(() => stop(true), ScreenSpaceEventType.MIDDLE_DOWN)
        handler.setInputAction(() => stop(true), ScreenSpaceEventType.PINCH_START)

        const follow = () => {
            const f = followRef.current
            if (!f) return
            const now = performance.now()
            const dt = Math.min(0.25, (now - f.last) / 1000)
            f.last = now

            // LOOKED UP BY ID EVERY FRAME, NOT HELD AS A REFERENCE. Resium
            // rebuilds these entities whenever the layer re-renders, so a
            // captured object goes stale within a refresh or two: the lock
            // then released itself for no visible reason, and the contact
            // appeared to vanish. The id is stable; the object is not.
            const ent = viewer.entities.getById(f.id)
            const pos = ent && !ent.isDestroyed?.()
                ? ent.position?.getValue(viewer.clock.currentTime) : null
            if (!pos) {
                // A contact can be missing for a refresh without being
                // gone. Coast briefly rather than dropping the lock.
                if (!f.lostAt) f.lostAt = now
                if (now - f.lostAt > LOST_GRACE_MS) stop(true)
                return
            }
            f.lostAt = 0

            if (f.orbiting) f.heading += ORBIT_RAD_PER_SEC * dt

            // Ease the range over the first second and a half.
            const t = Math.min(1, (now - f.startedAt) / 1500)
            const eased = t * t * (3 - 2 * t)
            const range = f.fromRange + (f.range - f.fromRange) * eased

            viewer.camera.lookAt(pos, new HeadingPitchRange(f.heading, pitchForRange(f.pitch, range), range))
            scene.requestRender?.()
        }
        scene.postUpdate.addEventListener(follow)

        const onKey = (e) => { if (e.key === "Escape") stop(true) }
        window.addEventListener("keydown", onKey)

        return () => {
            window.removeEventListener("keydown", onKey)
            scene.postUpdate.removeEventListener(follow)
            if (!handler.isDestroyed()) handler.destroy()
            if (followRef.current && !viewer.isDestroyed?.()) {
                viewer.camera.lookAtTransform(Matrix4.IDENTITY)
            }
            // Or unmounting while locked leaves the globe permanently
            // unzoomable, which is a far worse bug than the one this
            // whole block exists to fix.
            if (!viewer.isDestroyed?.()) giveCamera()
            if (ssc && !viewer.isDestroyed?.()) ssc.enableZoom = zoomWasEnabled
            hint.remove()
            followRef.current = null
        }
    }, [ctx?.viewer, ctx?.scene, enabled])

    return null
}
