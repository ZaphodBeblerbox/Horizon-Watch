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
import { safeDegreesArray } from "./trackPoints.js"
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
import { getShapeMarkerDataUri, MARK_SIZE , MARKER_DEPTH_TEST_M } from "./entityIcons.js"
import { SurgeTip, FusionTip } from "./DerivedTips.jsx"
import { CAT } from "../components/timeStripMath.js"
import {
    SURGE_HALO_M, SURGE_INNER_M, FUSION_RING_M, FUSION_OUTER_M,
    TICK_OUTER_M, TICK_INNER_M, LABEL_MAX_DISTANCE_M,
    tickBearings, offset, pulseAlpha, prefersReducedMotion,
} from "./derivedMarkGeometry.js"

const AMBER = Color.fromCssColorString("#f5d98f")   // --sev-high
const RED = Color.fromCssColorString("#f46043")     // --sev-critical
const BG0 = Color.fromCssColorString("#14161f")     // --bg-0

const labelCond = new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE_M)

/**
 * The region rings are honest and they are large, and both facts matter.
 *
 * A surge halo is §A4's 2.5° cell — ~278km across — and a fusion point sits
 * at a cell CENTROID, which is nowhere in particular. Shrinking the rings to
 * look tidier would claim a precision the finding does not have, so they
 * keep their real ground radius.
 *
 * What they cannot do is stay on screen at street zoom, where an 85km circle
 * stops reading as "about this region" and becomes a wall across the map with
 * the mark it describes lost inside it. Reported as the marks being "too big",
 * and that is what it looks like. Beyond this camera distance the ring is
 * information; closer in, the shape marker alone carries the finding.
 */
const REGION_RING_MIN_CAMERA_M = 120_000
const regionRingCond = new DistanceDisplayCondition(REGION_RING_MIN_CAMERA_M, Number.MAX_VALUE)

/**
 * The mark itself: a triangle, the universal caution form, matching
 * SHAPE_FOR_SOURCE.alert and every other point layer on this globe.
 *
 * It was a raw Cesium `point` at pixelSize 6 — a flat GPU disc with no shape
 * language and a 1px outline, which next to the supersampled shape markers
 * everywhere else is exactly what "low res" looks like. Drawn through the
 * shared marker path so it is rendered at MARKER_SUPERSAMPLE and downsampled.
 */
function markBillboard(color, size = MARK_SIZE.alert) {
    return {
        image: getShapeMarkerDataUri({ shape: "triangle", color, size, strokeWidth: 1.5 }),
        width: size, height: size,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: MARKER_DEPTH_TEST_M,
    }
}

/** §A8's pulse, on outlineColor alpha — never on `material`; see geometry. */
function pulsingOutline(base, periodMs, min, max) {
    if (prefersReducedMotion()) return base.withAlpha(max)
    return new CallbackProperty(() => base.withAlpha(pulseAlpha(Date.now(), periodMs, min, max)), false)
}

/** What surged, and by how much against its own baseline. */
export function surgeLabel(s) {
    const topic = (CAT[s.cat]?.name || s.cat || "activity")
        .split(" / ")[0].split(" ")[0].toUpperCase()
    const mult = Number(s.mult)
    // The multiple is the finding. Without a baseline to compare against,
    // fall back to the raw count rather than inventing a ratio.
    if (Number.isFinite(mult) && mult >= 2) return `${topic} ×${Math.round(mult)}`
    return `${topic} · ${s.n}`
}

/** Which independent modalities agreed, not how many. */
export function fusionLabel(f) {
    const mods = (f.mods || []).map((m) => String(m).toUpperCase())
    if (!mods.length) return "FUSION"
    if (mods.length <= 2) return mods.join("+")
    return `${mods.slice(0, 2).join("+")}+${mods.length - 2}`
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
        disableDepthTestDistance: MARKER_DEPTH_TEST_M,
        distanceDisplayCondition: labelCond,
        heightReference: HeightReference.CLAMP_TO_GROUND,
    }
}

export default function GlobeDerivedAlertsLayer({ enabled = false, at = null, theatres = null }) {
    const { viewer } = useCesium()
    const [surges, setSurges] = useState([])
    const [fusions, setFusions] = useState([])
    const threadsRef = useRef(null)
    const threadIdsRef = useRef([])
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

    // A THREAD ENDPOINT HAS TO SAY WHAT IT IS. Reported: "they connect to
    // some random dots with no explanations, clicking on them gives no
    // context either" — which was exactly right. Each endpoint was an
    // anonymous 6px ring with no label, no id and no entityStore record,
    // so there was nothing for a tooltip or the inspector to show. Every
    // one of these carries a label, a modality and a source ref from the
    // backend; none of it was ever put on screen.
    const drawThreads = (f) => {
        const ds = threadsRef.current
        if (!ds) return
        clearThreads()
        // AT MOST THIS MANY THREADS. Live fusions here carry 51, 38 and 33
        // contributing records, and fifty-one dashed leaders to fifty-one
        // labelled dots is not an explanation, it is the cobweb §A9.1 warns
        // about — and it is what the reader was actually looking at when
        // they called them "random dots with no explanations".
        //
        // The threads exist to answer one question: is this several
        // independent observations, or one incident reported forty times?
        // That is a question about SPREAD, so the ones worth drawing are
        // the farthest from the centroid. The tooltip states the true
        // total, so the cap never hides the denominator.
        const MAX_THREADS = 12
        const all = (f.items || []).filter(i => Number.isFinite(i.lat) && Number.isFinite(i.lon))
        const byDistance = [...all].sort((a, c) =>
            ((c.lat - f.lat) ** 2 + (c.lon - f.lon) ** 2)
            - ((a.lat - f.lat) ** 2 + (a.lon - f.lon) ** 2))
        const shown = byDistance.slice(0, MAX_THREADS)

        const ids = []
        for (const [n, i] of shown.entries()) {
            const id = `fusion-${f.id}-item-${i.ref || n}`
            ids.push(id)
            // Registered so a click opens the inspector on the RECORD, not
            // on nothing. The line explains the mark; this explains the line.
            setEntity(id, "fusion_member", {
                id, name: i.label, lat: i.lat, lon: i.lon,
                meta: {
                    modality: i.mod, reference: i.ref, place: i.place,
                    observed_at: Number.isFinite(i.ts)
                        ? new Date(i.ts * 1000).toISOString() : null,
                    belongs_to: f.headline,
                    why_linked: `one of ${all.length} records that put `
                              + `${f.mods.length} independent modalities in this cell`
                              + (all.length > MAX_THREADS
                                  ? ` — the ${MAX_THREADS} most spread out are drawn`
                                  : ""),
                },
            })
            // A ground-clamped line built from an unchecked coordinate is
            // how the whole globe stops rendering: NaN in, and Cesium
            // throws out of extractHeights inside the render loop.
            const threadCoords = safeDegreesArray([[f.lon, f.lat], [i.lon, i.lat]])
            if (threadCoords) ds.entities.add({
                polyline: {
                    positions: Cartesian3.fromDegreesArray(threadCoords),
                    width: 1.5,
                    material: new PolylineDashMaterialProperty({ color: RED.withAlpha(0.75), dashLength: 6 }),
                    clampToGround: true,
                },
            })
            ds.entities.add({
                id,
                position: Cartesian3.fromDegrees(i.lon, i.lat, 0),
                billboard: {
                    image: getShapeMarkerDataUri({
                        shape: "circle", color: "#c4453c",
                        size: MARK_SIZE.alert - 4, invert: true, strokeWidth: 1.5,
                    }),
                    width: MARK_SIZE.alert - 4, height: MARK_SIZE.alert - 4,
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                },
                // The modality, at the end of the line. This is the whole
                // point of the threads: seeing at a glance whether the
                // "independent" sources are in fact one incident reported
                // four times.
                label: labelOpts((i.mod || "").toUpperCase(), RED),
            })
        }
        threadIdsRef.current = ids
    }

    const clearThreads = () => {
        threadsRef.current?.entities.removeAll()
        threadIdsRef.current.forEach(deleteEntity)
        threadIdsRef.current = []
    }

    // Cesium reports canvas-relative coordinates; the shared #maptip places
    // against the viewport.
    // THREADS MUST NOT SURVIVE THE HOVER THAT DREW THEM. Cesium fires no
    // mouse-leave when the pointer exits the canvas, when the camera moves
    // the entity out from under a stationary cursor, or when a refresh
    // replaces the marks — and a stranded thread is precisely the reported
    // "random dots with no explanation", because the tooltip that explained
    // it is long gone. Cleared on every one of those, not just on leave.
    useEffect(() => {
        if (!viewer) return
        const canvas = viewer.scene?.canvas
        const clear = () => clearThreads()
        canvas?.addEventListener("pointerleave", clear)
        viewer.camera.moveStart.addEventListener(clear)
        return () => {
            canvas?.removeEventListener("pointerleave", clear)
            if (!viewer.isDestroyed?.()) viewer.camera.moveStart.removeEventListener(clear)
            clear()
        }
    }, [viewer])

    // A refresh replaces the fusion marks; any thread still on screen now
    // belongs to a mark that no longer exists.
    useEffect(() => { clearThreads() }, [surges, fusions])

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
                        distanceDisplayCondition: regionRingCond,
                    }}
                    billboard={markBillboard("#b7822c")}
                    /* "SURGE · 5" named neither the subject nor the size,
                       which is the whole finding. The payload already
                       carries the category and the multiple against this
                       cell's own baseline; the label just never used them.
                       "AIR ×13" reads at a glance and is falsifiable. */
                    label={labelOpts(surgeLabel(s), AMBER)}
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
                        distanceDisplayCondition: regionRingCond,
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
                        distanceDisplayCondition: regionRingCond,
                    }}
                    billboard={markBillboard("#c4453c")}
                    /* The count of INDEPENDENT ways of looking is the
                       finding, so name them rather than counting them:
                       "AIS+ADSB" says why it is worth believing. */
                    label={labelOpts(fusionLabel(f), RED)}
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
                        distanceDisplayCondition: regionRingCond,
                    }}
                />
            ))}
            {/* §A8 — ONE RADIAL TICK PER MODALITY. "The tick count is the
                finding, rendered." */}
            {fusions.flatMap((f) =>
                tickBearings(f.mods.length).map((b, i) => {
                    const a = offset(f.lat, f.lon, b, TICK_OUTER_M)
                    const z = offset(f.lat, f.lon, b, TICK_INNER_M)
                    const tick = safeDegreesArray([[a.lon, a.lat], [z.lon, z.lat]])
                    if (!tick) return null
                    return (
                        <Entity
                            key={`${f.id}-tick-${i}`}
                            polyline={{
                                positions: Cartesian3.fromDegreesArray(tick),
                                width: 2, material: RED, clampToGround: true,
                                // The ticks are drawn on the region ring, so
                                // they vanish with it rather than hanging in
                                // space around a mark at street zoom.
                                distanceDisplayCondition: regionRingCond,
                            }}
                        />
                    )
                }),
            )}
        </>
    )
}
