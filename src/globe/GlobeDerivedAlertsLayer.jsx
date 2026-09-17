/**
 * GlobeDerivedAlertsLayer.jsx — PARALLAX addendum §A8/§A9.
 *
 * Draws the two findings the backend computes but nothing has been showing:
 * surges (§A5) and fusion points (§A6). "Derived marks have to out-read the
 * confirmations they are made of, or the analyst never finds them."
 *
 * §A7 — DETECTION IS EVALUATED AT THE PLAYHEAD. Moving the archive scrub is an
 * input to detection, not a filter over a fixed answer, so this re-queries
 * with `at` and debounces at the spec's 180ms.
 *
 * THE THREADS (§A9.1). A fusion point sits at a cell centroid, which is
 * nowhere in particular. Dashed leaders drawn to the actual records on hover
 * are what turn an abstract mark into a legible claim: you can see the spread,
 * and you can see immediately if all the "independent" sources are in fact one
 * incident reported four times. They are transient by design — permanent, they
 * would be a cobweb over the geography they exist to explain.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian3, Color, CallbackProperty, HeightReference,
    DistanceDisplayCondition, LabelStyle, VerticalOrigin,
    CustomDataSource, PolylineDashMaterialProperty,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { showTip, hideTip } from "./mapTip.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { SurgeTip, FusionTip } from "./DerivedTips.jsx"
import {
    SURGE_HALO_M, SURGE_INNER_M, FUSION_RING_M, FUSION_OUTER_M,
    TICK_OUTER_M, TICK_INNER_M, LABEL_MAX_DISTANCE_M,
    tickBearings, offset, pulseAlpha, prefersReducedMotion,
} from "./derivedMarkGeometry.js"

const AMBER = Color.fromCssColorString("#b7822c")
const RED = Color.fromCssColorString("#c4453c")
const BG0 = Color.fromCssColorString("#171b20")

const labelCond = new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE_M)

/** §A8's pulse, on outlineColor alpha — never on `material`; see geometry. */
function pulsingOutline(base, periodMs, min, max) {
    if (prefersReducedMotion()) return base.withAlpha(max)
    return new CallbackProperty(() => base.withAlpha(pulseAlpha(Date.now(), periodMs, min, max)), false)
}

function labelOpts(text, color) {
    return {
        text,
        font: "600 10px ui-monospace, SF Mono, Menlo, monospace",
        fillColor: color,
        // paint-order:stroke in SVG; Cesium's equivalent is an outline in the
        // page ground colour so the label survives over a bright basemap.
        outlineColor: BG0,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: { x: 0, y: -14 },
        // §A8: "Keep the label pixel-sized, not ground-sized."
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: labelCond,
        heightReference: HeightReference.CLAMP_TO_GROUND,
    }
}

export default function GlobeDerivedAlertsLayer({ enabled = false, at = null, theatres = null }) {
    const { viewer } = useCesium()
    const [surges, setSurges] = useState([])
    const [fusions, setFusions] = useState([])
    const threadsRef = useRef(null)
    const theatreKey = theatres && theatres.length ? theatres.join(",") : ""

    // §A7 — the playhead is an input to detection. Debounced at the spec's
    // 180ms so a drag across eighteen months fires one query, not two hundred.
    useEffect(() => {
        if (!enabled) { setSurges([]); setFusions([]); return }
        let cancelled = false
        const t = setTimeout(() => {
            const q = new URLSearchParams()
            if (at) q.set("at", at)
            if (theatreKey) q.set("theatre", theatreKey)
            const qs = q.toString() ? `?${q}` : ""
            fetch(`${API_BASE}/api/alerts/surges${qs}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setSurges(safeArray(d?.surges)) })
                .catch(() => {})
            fetch(`${API_BASE}/api/alerts/fusions${qs}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!cancelled) setFusions(safeArray(d?.fusions)) })
                .catch(() => {})
        }, 180)
        return () => { cancelled = true; clearTimeout(t) }
    }, [enabled, at, theatreKey])

    // The evaluation moment, so "3h ago" in a tooltip means 3h before the
    // PLAYHEAD and not 3h before now — otherwise scrubbing to August shows
    // records "1200h ago" and the finding reads as stale rather than historic.
    const nowMs = useMemo(() => (at ? Date.parse(`${at}T00:00:00Z`) : Date.now()), [at])

    // Register for the click-through inspector, same as every other layer.
    useEffect(() => {
        const ids = []
        for (const s of surges) { const id = `surge-${s.id}`; setEntity(id, "surge", s); ids.push(id) }
        for (const f of fusions) { const id = `fusion-${f.id}`; setEntity(id, "fusion", f); ids.push(id) }
        return () => ids.forEach(deleteEntity)
    }, [surges, fusions])

    // ── §A9.1 the threads ────────────────────────────────────────────────
    useEffect(() => {
        if (!viewer) return
        const ds = new CustomDataSource("fusionthreads")
        viewer.dataSources.add(ds)
        threadsRef.current = ds
        return () => {
            try { viewer.dataSources.remove(ds, true) } catch { /* viewer already torn down */ }
            threadsRef.current = null
        }
    }, [viewer])

    const drawThreads = (f) => {
        const ds = threadsRef.current
        if (!ds) return
        ds.entities.removeAll()
        for (const i of f.items || []) {
            if (!Number.isFinite(i.lat) || !Number.isFinite(i.lon)) continue
            ds.entities.add({
                polyline: {
                    positions: Cartesian3.fromDegreesArray([f.lon, f.lat, i.lon, i.lat]),
                    width: 1.5,
                    material: new PolylineDashMaterialProperty({ color: RED.withAlpha(0.75), dashLength: 6 }),
                    clampToGround: true,
                },
            })
            ds.entities.add({
                position: Cartesian3.fromDegrees(i.lon, i.lat, 0),
                point: {
                    pixelSize: 6, color: Color.TRANSPARENT,
                    outlineColor: RED.withAlpha(0.85), outlineWidth: 1.5,
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            })
        }
    }
    const clearThreads = () => { threadsRef.current?.entities.removeAll() }

    // Cesium reports canvas-relative coordinates; the shared #maptip places
    // against the viewport.
    const tipAt = (content, movement) => {
        const rect = viewer?.scene?.canvas?.getBoundingClientRect?.()
        if (!rect || !movement?.endPosition) return
        showTip(content, rect.left + movement.endPosition.x, rect.top + movement.endPosition.y)
    }

    if (!enabled) return null

    return (
        <>
            {surges.map((s) => (
                <Entity
                    key={s.id}
                    id={`surge-${s.id}`}
                    position={Cartesian3.fromDegrees(s.lon, s.lat, 0)}
                    onMouseMove={(_m, mv) => tipAt(<SurgeTip surge={s} nowMs={nowMs} />, mv)}
                    onMouseLeave={hideTip}
                    ellipse={{
                        semiMajorAxis: SURGE_HALO_M, semiMinorAxis: SURGE_HALO_M,
                        material: AMBER.withAlpha(0.10),
                        outline: true,
                        outlineColor: pulsingOutline(AMBER, 3400, 0.45, 0.9),
                        outlineWidth: 1.2,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    }}
                    point={{
                        pixelSize: 6, color: AMBER,
                        outlineColor: BG0, outlineWidth: 1,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    }}
                    label={labelOpts(`SURGE · ${s.n}`, AMBER)}
                />
            ))}
            {/* The inner ring is its own entity: one Cesium entity carries at
                most one ellipse, and §A8's mark is two concentric rings. */}
            {surges.map((s) => (
                <Entity
                    key={`${s.id}-inner`}
                    position={Cartesian3.fromDegrees(s.lon, s.lat, 0)}
                    ellipse={{
                        semiMajorAxis: SURGE_INNER_M, semiMinorAxis: SURGE_INNER_M,
                        material: Color.TRANSPARENT,
                        outline: true, outlineColor: AMBER.withAlpha(0.5), outlineWidth: 1,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    }}
                />
            ))}

            {fusions.map((f) => (
                <Entity
                    key={f.id}
                    id={`fusion-${f.id}`}
                    position={Cartesian3.fromDegrees(f.lon, f.lat, 0)}
                    onMouseMove={(_m, mv) => { drawThreads(f); tipAt(<FusionTip fusion={f} nowMs={nowMs} />, mv) }}
                    onMouseLeave={() => { clearThreads(); hideTip() }}
                    ellipse={{
                        semiMajorAxis: FUSION_RING_M, semiMinorAxis: FUSION_RING_M,
                        material: RED.withAlpha(0.12),
                        outline: true, outlineColor: RED.withAlpha(0.9), outlineWidth: 1.6,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    }}
                    point={{
                        pixelSize: 6, color: RED,
                        outlineColor: BG0, outlineWidth: 1,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    }}
                    label={labelOpts(`FUSION · ${f.mods.length}`, RED)}
                />
            ))}
            {fusions.map((f) => (
                <Entity
                    key={`${f.id}-outer`}
                    position={Cartesian3.fromDegrees(f.lon, f.lat, 0)}
                    ellipse={{
                        semiMajorAxis: FUSION_OUTER_M, semiMinorAxis: FUSION_OUTER_M,
                        material: Color.TRANSPARENT,
                        outline: true,
                        outlineColor: pulsingOutline(RED, 2800, 0.3, 0.6),
                        outlineWidth: 1,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    }}
                />
            ))}
            {/* §A8 — ONE RADIAL TICK PER MODALITY. "The tick count is the
                finding, rendered." */}
            {fusions.flatMap((f) =>
                tickBearings(f.mods.length).map((b, i) => {
                    const a = offset(f.lat, f.lon, b, TICK_OUTER_M)
                    const z = offset(f.lat, f.lon, b, TICK_INNER_M)
                    return (
                        <Entity
                            key={`${f.id}-tick-${i}`}
                            polyline={{
                                positions: Cartesian3.fromDegreesArray([a.lon, a.lat, z.lon, z.lat]),
                                width: 2, material: RED, clampToGround: true,
                            }}
                        />
                    )
                }),
            )}
        </>
    )
}
