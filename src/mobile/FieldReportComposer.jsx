/**
 * FieldReportComposer.jsx — the phone map's "Report" button (owner, 2026-10-24): one tap, pick what you saw
 * from its icon, the pin starts at your location (or the map's centre) and is dragged (or the map tapped) to
 * where it is, expiry chips, an optional note and photo, Send. The form is fieldReports/ReportForm.jsx; a sent
 * report turns the "User reports" layer on (the m2:layers event MMap listens to).
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import L from "leaflet"
import ReportForm from "../fieldReports/ReportForm.jsx"
import { reportMarker } from "../lib/fieldReports.js"
import { PHONE_ICON_SCALE } from "../lib/mapIcons.js"
import { myPosition } from "../location/liveShare.js"

const VISIBLE_Y = 0.22                 // the share of the map's height where the pin stands, above the form

/** Move the map so `p` stands above the form, not under it. */
function showAbove(m, p) {
    if (!m) return
    const sz = m.getSize()
    const z = Math.max(m.getZoom(), 13)
    const pt = m.project([p.lat, p.lon], z).add([0, sz.y * (0.5 - VISIBLE_Y)])
    m.setView(m.unproject(pt, z), z, { animate: false })
}

export default function FieldReportComposer({ mapRef }) {
    const [open, setOpen] = useState(false)
    const [kind, setKind] = useState(null)
    const [at, setAt] = useState(null)
    const [place, setPlace] = useState("")
    const pin = useRef(null)

    const start = () => {
        const m = mapRef?.current
        const me = myPosition()
        // the form covers the lower map: the pin starts in the middle of what stays visible above it
        const sz = m?.getSize?.()
        const c = sz ? m.containerPointToLatLng([sz.x / 2, sz.y * VISIBLE_Y]) : null
        // your location when it is in view, else that point
        const inView = me && m?.getBounds?.()?.contains?.([me.lat, me.lon])
        setAt(inView ? { lat: me.lat, lon: me.lon } : c ? { lat: c.lat, lon: L.Util.wrapNum(c.lng, [-180, 180], true) } : null)
        setKind(null); setPlace(""); setOpen(true)
    }
    const close = () => { setOpen(false); setKind(null) }

    // the pin: draggable, the kind's icon; a tap on the map moves it too
    useEffect(() => {
        const m = mapRef?.current
        if (!open || !m || !at) return undefined
        const ic = reportMarker(kind || "other", { selected: true })
        const w = Math.round((ic.w + 10) * PHONE_ICON_SCALE)
        const icon = L.icon({ iconUrl: ic.uri, iconSize: [w, w], iconAnchor: [w / 2, w / 2] })
        if (!pin.current) {
            pin.current = L.marker([at.lat, at.lon], { draggable: true, icon, zIndexOffset: 2000, keyboard: false }).addTo(m)
            pin.current.on("dragend", () => { const p = pin.current.getLatLng(); setAt({ lat: p.lat, lon: L.Util.wrapNum(p.lng, [-180, 180], true) }) })
        } else {
            pin.current.setIcon(icon)
            pin.current.setLatLng([at.lat, at.lon])
        }
        return undefined
    }, [open, at, kind, mapRef])
    useEffect(() => {
        const m = mapRef?.current
        if (!open || !m) return undefined
        const tap = (e) => setAt({ lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180], true) })
        m.on("click", tap)
        return () => m.off("click", tap)
    }, [open, mapRef])
    useEffect(() => {
        if (open) return undefined
        if (pin.current) { pin.current.remove(); pin.current = null }
        return undefined
    }, [open])
    useEffect(() => () => { if (pin.current) { pin.current.remove(); pin.current = null } }, [])

    const host = typeof document !== "undefined" ? (document.querySelector(".m2") || document.body) : null
    return (
        <>
            <button className="m2-round" aria-label="Report what you see" data-testid="m2-report-btn" onClick={() => (open ? close() : start())}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 2.8 19.5 6v5.6c0 4.4-3.2 7.4-7.5 9-4.3-1.6-7.5-4.6-7.5-9V6z" /><path d="M12 8v4.6M12 15.8v.4" />
                </svg>
            </button>
            {open && host && createPortal(
                <div className="fr-phone" role="dialog" aria-label="Report what you see" data-testid="m2-report-sheet">
                    <ReportForm variant="phone" kind={kind} onKind={setKind} at={at} place={place} onPlace={setPlace}
                                moveHint="drag the pin or tap the map"
                                onUseMyLocation={() => { const p = myPosition(); if (p) { setAt({ lat: p.lat, lon: p.lon }); showAbove(mapRef?.current, p) } }}
                                onClose={close}
                                onSent={() => { close(); window.dispatchEvent(new CustomEvent("m2:layers", { detail: { userReports: true } })) }} />
                </div>, host)}
        </>
    )
}
