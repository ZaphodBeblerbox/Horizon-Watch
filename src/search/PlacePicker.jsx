/**
 * PlacePicker.jsx — choose a place by name; get its coordinates.
 *
 * For every control that used to ask for latitude and longitude (the
 * theater editor, the day/night location in Settings): the search box's
 * own suggestions — local countries and cities instantly, the geocoder for
 * the rest — and the camera height that suits the place.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { places as loadPlaces } from "../voice/gazetteer.js"
import { buildSuggestions } from "./searchModel.js"

const INPUT = {
    width: "100%", height: 30, padding: "0 9px", background: "var(--glass2)",
    border: "1px solid var(--gline)", color: "var(--txt)",
    font: "400 13px var(--font)", outline: "none", borderRadius: 0, boxSizing: "border-box",
}

/* WHERE IT LOOKS IS A PLACE YOU NAME. The editor asked for latitude,
   longitude and height in metres — numbers nobody has to hand. Type the
   place instead; the same suggestions as the search box (local countries
   and cities instantly, the geocoder for the rest) and the camera height
   that suits it. The numbers stay available, folded, for whoever has one. */
export default function PlacePicker({ onPick, placeholder = "Type a place — Bab el-Mandeb, Red Sea, Taiwan…", label = "Find a place",
                                     keep = false, value = null }) {
    // keep: the chosen place stays in the field (an address you are setting,
    // not a search you are done with). value: set from outside — the address
    // of a pin dropped on a map.
    const [q, setQ] = useState(value || "")
    const [open, setOpen] = useState(false)
    useEffect(() => { if (value != null) { setQ(value); setOpen(false); chosen.current = value } }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
    const [places, setPlaces] = useState([])
    const [remote, setRemote] = useState([])
    useEffect(() => { loadPlaces().then(setPlaces).catch(() => {}) }, [])
    useEffect(() => {
        const t = q.trim()
        if (t.length < 2) { setRemote([]); return undefined }
        let live = true
        const timer = setTimeout(() => {
            fetch(`${API_BASE}/api/search?q=${encodeURIComponent(t)}&limit=8`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : [])).then((d) => { if (live) setRemote(Array.isArray(d) ? d : []) })
                .catch(() => {})
        }, 160)
        return () => { live = false; clearTimeout(timer) }
    }, [q])
    const items = useMemo(() => {
        // Same order the search box uses: the closer match leads.
        const g = buildSuggestions(q, { places, remote })
        return g.filter((x) => x.group === "Places" || x.group === "On the map")
            .flatMap((x) => x.group === "Places" ? x.items
                : x.items.map((i) => ({ ...i, lat: i.raw?.lat, lon: i.raw?.lon, altitude: 600_000 })))
            .filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon)).slice(0, 7)
    }, [q, places, remote])
    // the place as an address: its name and where it is, without the
    // suggestion's category tag ("· place", "· port")
    const asAddress = (it) => [it.label, String(it.sub || "").split(" · ")[0]].filter(Boolean).join(", ")
    const chosen = useRef(value || "")
    const choose = (it) => { onPick({ ...it, address: asAddress(it) }); setOpen(false); chosen.current = keep ? asAddress(it) : ""; setQ(chosen.current) }
    // Typed and never picked: look it up and take the best match — Enter,
    // or (for an address being set) simply leaving the field.
    const lookUp = (t) => {
        if (t.length < 2) return
        fetch(`${API_BASE}/api/search?q=${encodeURIComponent(t)}&limit=3`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : [])).then((d) => {
                const hit = (Array.isArray(d) ? d : []).find((x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)))
                if (hit) {
                    // keep what was typed as the address: it is what the user means by it
                    onPick({ ...hit, lat: Number(hit.lat), lon: Number(hit.lon), label: hit.label || hit.name || t, sub: hit.sub || "", address: keep ? t : undefined })
                    setOpen(false); chosen.current = keep ? t : ""; setQ(chosen.current)
                }
            }).catch(() => {})
    }
    return (
        <div style={{ position: "relative" }}>
            <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} placeholder={placeholder}
                   onFocus={() => setOpen(true)}
                   onBlur={() => setTimeout(() => {
                       setOpen(false)
                       const t = q.trim()
                       if (keep && t.length >= 4 && t !== chosen.current) lookUp(t)
                   }, 180)}
                   onKeyDown={(e) => {
                       if (e.key !== "Enter") return
                       e.preventDefault()
                       if (items[0]) { choose(items[0]); return }
                       // Enter before the suggestions arrive: look it up now, take the best
                       lookUp(q.trim())
                   }}
                   style={{ ...INPUT, ...(keep ? { height: 34, fontSize: 13.5 } : null) }} aria-label={label} />
            {open && q.trim().length >= 2 && items.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 20, background: "var(--bg-1, var(--canvas))",
                              border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)", overflow: "hidden" }}>
                    {items.map((it) => (
                        <div key={it.id} onMouseDown={(e) => { e.preventDefault(); choose(it) }}
                             style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 10px", cursor: "pointer", minWidth: 0 }}
                             onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accdim)" }}
                             onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}>
                            <span style={{ fontSize: 13, color: "var(--txt)", flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                            <span style={{ fontSize: 11.5, color: "var(--txt-4, var(--txt4))", flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

