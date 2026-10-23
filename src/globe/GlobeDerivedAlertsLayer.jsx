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
    Cartesian3, Color, HeightReference,
    DistanceDisplayCondition, LabelStyle, VerticalOrigin,
    CustomDataSource, PolylineDashMaterialProperty,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { showTip, hideTip } from "./mapTip.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"
import { SurgeTip, FusionTip } from "./DerivedTips.jsx"
import { CAT } from "../components/timeStripMath.js"
import { LABEL_MAX_DISTANCE_M } from "./derivedMarkGeometry.js"
import { markerIcon, dotIcon, PRIORITY, ICON_PX } from "../lib/mapIcons.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"

const BG0 = Color.fromCssColorString("#14161f")     // --bg-0

const labelCond = new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE_M)

/**
 * THE MARK, in the one typology (lib/mapIcons.js): a triangle, a warning we derived, with the surge's or the
 * fusion's glyph, coloured by priority for you (the server's when it sends one, else urgent; red only for flash),
 * drawn in the DEVELOPING state: the ring in the same colour that used to be a separate, larger ring image (RING
 * images swelled the mark to 30-34 px next to 16; they are gone). One constant size at every zoom. How many kinds
 * of evidence agree is in the label and the tip, not in tick marks.
 */
export const derivedPriority = (x) => (x?.priority && PRIORITY[x.priority] ? x.priority : "urgent")
function markBillboard(kind, x) {
    const ic = markerIcon({ kind: "derived", glyph: kind, priority: derivedPriority(x), state: "developing" })
    return {
        image: ic.uri, width: ic.w, height: ic.h,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: MARKER_DEPTH_TEST_M,
    }
}
const labelColor = (x) => Color.fromCssColorString(PRIORITY[derivedPriority(x)])

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

/** The event the fusion is about, short, and how many kinds of evidence
 *  agree on it — never feed codes ("CONFIRMATION+TELEGRAM"). */
export function fusionLabel(f) {
    const head = String(f.headline || "Converging evidence").replace(/\s+—.*$/, "")
    const short = head.length > 38 ? `${head.slice(0, 36).trim()}…` : head
    const n = (f.mods || []).length
    return n ? `${short} · ${n} kinds agree` : short
}

function labelOpts(text, color) {
    return {
        text,
        font: "600 10px -apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif",
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
                    why_linked: (i.km != null ? `${i.km} km and ${Math.abs(i.dt_h)} h ${i.dt_h > 0 ? "after" : "before"} the event` : "")
                              + ` — one of ${all.length} records, ${f.mods.length} kinds of evidence`
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
                    material: new PolylineDashMaterialProperty({ color: labelColor(f).withAlpha(0.75), dashLength: 6 }),
                    clampToGround: true,
                },
            })
            ds.entities.add({
                id,
                position: Cartesian3.fromDegrees(i.lon, i.lat, 0),
                // a thread's end: a 10 px hollow circle (lib/mapIcons.js dotIcon endpoint), the fusion's priority
                billboard: (() => {
                    const ic = dotIcon({ role: "endpoint", priority: derivedPriority(f) })
                    return { image: ic.uri, width: ic.w, height: ic.h, heightReference: HeightReference.CLAMP_TO_GROUND,
                             disableDepthTestDistance: MARKER_DEPTH_TEST_M }
                })(),
                // The modality, at the end of the line. This is the whole
                // point of the threads: seeing at a glance whether the
                // "independent" sources are in fact one incident reported
                // four times.
                label: labelOpts(i.kind_label || i.mod || "", labelColor(f)),
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

    const marks = useMemo(() => [
        ...surges.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({
            id: `surge-${x.id}`, lat: x.lat, lon: x.lon, size: ICON_PX, pri: derivedPriority(x), kind: "surge", x,
            title: `${String(CAT[x.cat]?.name || x.cat || "activity").toLowerCase()} reporting surging around ${x.place || "this area"}`, line: surgeLabel(x) })),
        ...fusions.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).map((x) => ({
            id: `fusion-${x.id}`, lat: x.lat, lon: x.lon, size: ICON_PX, pri: derivedPriority(x), kind: "fusion", x,
            title: x.headline || "Converging evidence", line: fusionLabel(x) })),
    ], [surges, fusions])
    const layout = useDeclutter("derivedAlerts", marks, enabled)
    useClusterRecords(layout)

    if (!enabled) return null

    return (
        <>
            {layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const { kind, x } = g.item
                if (kind === "surge") return (
                    <Entity
                        key={x.id}
                        id={`surge-${x.id}`}
                        position={Cartesian3.fromDegrees(x.lon, x.lat, 0)}
                        onMouseMove={(_m, mv) => tipAt(<SurgeTip surge={x} nowMs={nowMs} />, mv)}
                        onMouseLeave={hideTip}
                        billboard={markBillboard("surge", x)}
                        /* "AIR ×13": the subject and the multiple against this cell's own baseline */
                        label={labelOpts(surgeLabel(x), labelColor(x))}
                    />
                )
                return (
                    <Entity
                        key={x.id}
                        id={`fusion-${x.id}`}
                        position={Cartesian3.fromDegrees(x.lon, x.lat, 0)}
                        onMouseMove={(_m, mv) => { drawThreads(x); tipAt(<FusionTip fusion={x} nowMs={nowMs} />, mv) }}
                        onMouseLeave={() => { clearThreads(); hideTip() }}
                        billboard={markBillboard("fusion", x)}
                        /* the INDEPENDENT ways of looking, named: why it is worth believing */
                        label={labelOpts(fusionLabel(x), labelColor(x))}
                    />
                )
            })}
        </>
    )
}
