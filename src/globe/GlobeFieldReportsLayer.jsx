/**
 * GlobeFieldReportsLayer.jsx — USER REPORTS on the globe (owner, 2026-10-24), and the desktop's way to make one.
 *
 *   data     GET /api/field-reports (the reports you may read that are active), every 60 s and at once after a
 *            report is sent, ended or deleted (lib/fieldReports.js); a report leaves the map at its expiry (the
 *            clock is re-read every 15 s)
 *   marker   the one typology (lib/mapIcons.js reportIcon): a circle, the kind's glyph, the dashed 'user' edge
 *            (unverified); the shared collision pass (screenDeclutter.js) like every point layer
 *   card     the Inspector, with the report's card as an inspector extension (fieldReports/ReportCard.jsx): who,
 *            when, the expiry, the note and the media, "End now" for the author
 *   report   right-click on the globe → "Report here…", or the map tools' Report button (openReportForm) at the
 *            view's centre; the form floats over the globe, a click on the globe moves the pin
 *
 * Markers are drawn only with the layer on; the right-click menu and the form are always there.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Entity, useCesium } from "resium"
import { Cartesian2, Cartesian3, HeightReference, Math as CMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium"
import { setEntity, deleteEntity } from "./entityStore.js"
import { useDeclutter } from "./screenDeclutter.js"
import ClusterMark, { useClusterRecords } from "./ClusterMark.jsx"
import { listReports, reportActive, reportIcon, reportLines, subscribeReports, OPEN_EVENT, REFRESH_MS } from "../lib/fieldReports.js"
import { ICON_PX, REPORT_KINDS } from "../lib/mapIcons.js"
import { myPosition } from "../location/liveShare.js"
import ReportForm from "../fieldReports/ReportForm.jsx"
import { ReportInspectorExtension } from "../fieldReports/ReportCard.jsx"
import { registerInspectorExtension } from "../inspector/extensionRegistry.js"

// the report's card (who, when, expiry, note, media, End now) under its record in the Inspector
registerInspectorExtension(ReportInspectorExtension)

const SIZE = ICON_PX

function pickLatLon(viewer, x, y) {
    const c = viewer?.camera?.pickEllipsoid(new Cartesian2(x, y), viewer.scene.globe.ellipsoid)
    if (!c) return null
    const g = viewer.scene.globe.ellipsoid.cartesianToCartographic(c)
    return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude) }
}

export default function GlobeFieldReportsLayer({ enabled = false }) {
    const cesium = useCesium()
    const viewer = cesium?.viewer
    const [reports, setReports] = useState([])
    const [nowMs, setNowMs] = useState(() => Date.now())
    const [menu, setMenu] = useState(null)               // {x, y, at} — the right-click menu
    const [form, setForm] = useState(null)               // {at, kind, place} — the open report form
    const formRef = useRef(form)
    formRef.current = form

    // the reports: on, every minute, and at once after a change
    useEffect(() => {
        if (!enabled) { setReports([]); return undefined }
        let live = true
        const load = () => listReports().then((r) => { if (live) setReports(r) }).catch(() => { /* a dropped poll is not an empty map */ })
        load()
        const iv = setInterval(load, REFRESH_MS)
        const tick = setInterval(() => setNowMs(Date.now()), 15_000)
        const off = subscribeReports(load)
        return () => { live = false; clearInterval(iv); clearInterval(tick); off() }
    }, [enabled])

    // right-click → "Report here…"; while the form is open, a left click moves its pin
    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return undefined
        const h = new ScreenSpaceEventHandler(viewer.scene.canvas)
        h.setInputAction((e) => {
            const at = pickLatLon(viewer, e.position.x, e.position.y)
            if (!at) return
            const r = viewer.scene.canvas.getBoundingClientRect()
            setMenu({ x: r.left + e.position.x, y: r.top + e.position.y, at })
        }, ScreenSpaceEventType.RIGHT_CLICK)
        h.setInputAction((e) => {
            setMenu(null)
            if (!formRef.current) return
            const at = pickLatLon(viewer, e.position.x, e.position.y)
            if (at) setForm((f) => (f ? { ...f, at } : f))
        }, ScreenSpaceEventType.LEFT_CLICK)
        const canvas = viewer.scene.canvas
        const noNative = (e) => e.preventDefault()          // our menu, not the browser's
        canvas.addEventListener("contextmenu", noNative)
        return () => { canvas.removeEventListener("contextmenu", noNative); if (!h.isDestroyed()) h.destroy() }
    }, [viewer])

    // the map tools' Report button: at the given point, else the view's centre
    useEffect(() => {
        const h = (e) => {
            let at = e.detail && Number.isFinite(e.detail.lat) ? { lat: e.detail.lat, lon: e.detail.lon } : null
            if (!at && viewer && !viewer.isDestroyed?.()) {
                const c = viewer.scene.canvas
                at = pickLatLon(viewer, c.clientWidth / 2, c.clientHeight / 2)
            }
            setMenu(null)
            setForm({ at, kind: null, place: "" })
        }
        window.addEventListener(OPEN_EVENT, h)
        return () => window.removeEventListener(OPEN_EVENT, h)
    }, [viewer])
    useEffect(() => {
        if (!menu) return undefined
        const close = (e) => { if (!e.target?.closest?.(".fr-menu")) setMenu(null) }
        const esc = (e) => { if (e.key === "Escape") setMenu(null) }
        window.addEventListener("mousedown", close)
        window.addEventListener("keydown", esc)
        return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc) }
    }, [menu])

    const items = useMemo(() => reports.filter((r) => reportActive(r, nowMs)).map((r) => {
        const c = reportLines(r, nowMs)
        return { id: `fr-${r.id}`, lat: r.lat, lon: r.lon, size: SIZE, pri: (REPORT_KINDS[r.kind] || REPORT_KINDS.other).priority,
                 image: reportIcon(r.kind), t: Date.parse(r.occurred_at || "") || 0, title: c.title, line: `${c.who} · ${c.expiry}`, r }
    }), [reports, nowMs])
    const layout = useDeclutter("userReports", items, enabled)
    useClusterRecords(layout)
    useEffect(() => {
        const ids = []
        for (const g of layout) {
            if (g.cluster) continue
            const r = g.item.r, c = reportLines(r, nowMs)
            setEntity(g.item.id, "field_report", { ...r, kind: "field_report", report_kind: r.kind, headline: c.title, title: c.title,
                                                   status_label: `${c.who} · ${c.expiry}`, source: "User report" })
            ids.push(g.item.id)
        }
        return () => ids.forEach((id) => deleteEntity(id))
    }, [layout, nowMs])

    const pinKind = form?.kind || "other"
    return (
        <>
            {enabled && layout.map((g) => {
                if (g.cluster) return <ClusterMark key={g.id} g={g} />
                const r = g.item.r
                return (
                    <Entity key={g.item.id} id={g.item.id} name={g.item.title}
                            position={Cartesian3.fromDegrees(r.lon, r.lat, 0)}
                            billboard={{ image: reportIcon(r.kind), width: SIZE, height: SIZE, heightReference: HeightReference.CLAMP_TO_GROUND,
                                         disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -80) }} />
                )
            })}
            {form?.at && (
                <Entity key="fr-pin" id="fr-pin" name="Your report"
                        position={Cartesian3.fromDegrees(form.at.lon, form.at.lat, 0)}
                        billboard={{ image: reportIcon(pinKind, { selected: true }), width: SIZE + 8, height: SIZE + 8,
                                     heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1e7, eyeOffset: new Cartesian3(0, 0, -90) }} />
            )}
            {menu && typeof document !== "undefined" && createPortal(
                <div className="fr-menu" style={{ left: menu.x, top: menu.y }} data-testid="fr-menu" onContextMenu={(e) => e.preventDefault()}>
                    <button data-testid="fr-report-here" onClick={() => { setForm({ at: menu.at, kind: null, place: "" }); setMenu(null) }}>Report here…</button>
                </div>, document.body)}
            {form && typeof document !== "undefined" && createPortal(
                <div className="fr-float" style={{ left: 16, top: 96 }} data-testid="fr-desktop-form">
                    <ReportForm variant="desktop" kind={form.kind} at={form.at} place={form.place}
                                onKind={(k) => setForm((f) => ({ ...f, kind: k }))}
                                onPlace={(p) => setForm((f) => ({ ...f, place: p }))}
                                moveHint="click the map to move the pin"
                                onUseMyLocation={myPosition() ? () => { const p = myPosition(); if (p) setForm((f) => ({ ...f, at: { lat: p.lat, lon: p.lon } })) } : null}
                                onClose={() => setForm(null)}
                                onSent={() => setForm(null)} />
                </div>, document.body)}
        </>
    )
}
