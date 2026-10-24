/**
 * GlobePulseLayer.jsx — a new item on the globe pulses (owner, 2026-10-24): one ring in its priority colour
 * (lib/mapIcons.js pulseRingIcon), growing from the marker's size and fading, PULSE.iterations times over
 * PULSE.ms; then it goes and the marker rests at its constant size. Which items are new: lib/newOnMap.js, fed
 * by every event layer through globe/screenDeclutter.js. The viewer renders on demand: frames are asked for
 * while a ring is up.
 */
import { useEffect } from "react"
import { useCesium } from "resium"
import { CallbackProperty, Cartesian3, Color, HeightReference } from "cesium"
import { PULSE, pulseFrame, pulseRingIcon } from "../lib/mapIcons.js"
import { subscribePulses, getPulses } from "../lib/newOnMap.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

export default function GlobePulseLayer() {
    const { viewer } = useCesium() || {}
    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return undefined
        const ents = new Map()           // pulse id → { ent, start }
        let raf = 0
        const loop = () => {
            raf = 0
            if (viewer.isDestroyed?.()) return
            const now = Date.now()
            for (const [id, x] of ents) {
                if (now - x.start >= PULSE.ms) { try { viewer.entities.remove(x.ent) } catch { /* gone */ } ents.delete(id) }
            }
            viewer.scene.requestRender?.()
            if (ents.size) raf = requestAnimationFrame(loop)
        }
        const draw = (list) => {
            if (viewer.isDestroyed?.()) return
            for (const p of list) {
                const prev = ents.get(p.id)
                if (prev && prev.start === p.start) continue
                if (prev) { try { viewer.entities.remove(prev.ent) } catch { /* gone */ } }
                const icon = pulseRingIcon(p.pri)
                const start = p.start
                const frame = () => pulseFrame(Date.now() - start) || { scale: PULSE.to, alpha: 0 }
                const ent = viewer.entities.add({
                    id: `pulse-${p.id}-${start}`,
                    position: Cartesian3.fromDegrees(p.lon, p.lat),
                    billboard: {
                        image: icon.uri, width: p.size, height: p.size,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                        eyeOffset: new Cartesian3(0, 0, -60),
                        scale: new CallbackProperty(() => frame().scale, false),
                        color: new CallbackProperty(() => Color.WHITE.withAlpha(frame().alpha), false),
                    },
                })
                ents.set(p.id, { ent, start })
            }
            if (ents.size && !raf) raf = requestAnimationFrame(loop)
        }
        draw(getPulses())
        const off = subscribePulses(draw)
        if (typeof window !== "undefined") window.__plxPulses = () => [...ents.keys()]
        return () => {
            off()
            if (raf) cancelAnimationFrame(raf)
            if (!viewer.isDestroyed?.()) for (const x of ents.values()) { try { viewer.entities.remove(x.ent) } catch { /* gone */ } }
            ents.clear()
        }
    }, [viewer])
    return null
}
