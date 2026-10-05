/**
 * PlacePicker.jsx — choose a place by name; get its coordinates.
 *
 * For every control that used to ask for latitude and longitude (the
 * theater editor, the day/night location in Settings): the search box's
 * own suggestions — local countries and cities instantly, the geocoder for
 * the rest — and the camera height that suits the place.
 */
import { useEffect, useMemo, useState } from "react"
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
export default function PlacePicker({ onPick, placeholder = "Type a place — Bab el-Mandeb, Red Sea, Taiwan…", label = "Find a place" }) {
    const [q, setQ] = useState("")
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
    return (
        <div style={{ position: "relative" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
                   onKeyDown={(e) => { if (e.key === "Enter" && items[0]) { e.preventDefault(); onPick(items[0]); setQ("") } }}
                   style={INPUT} aria-label={label} />
            {q.trim().length >= 2 && items.length > 0 && (
                <div style={{ position: "absolute", top: 32, left: 0, right: 0, zIndex: 5, background: "var(--bg-1, var(--canvas))",
                              border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)" }}>
                    {items.map((it) => (
                        <div key={it.id} onMouseDown={(e) => { e.preventDefault(); onPick(it); setQ("") }}
                             style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 10px", cursor: "pointer" }}
                             onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accdim)" }}
                             onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}>
                            <span style={{ fontSize: 13, color: "var(--txt)" }}>{it.label}</span>
                            <span style={{ fontSize: 11.5, color: "var(--txt-4, var(--txt4))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

