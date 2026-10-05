/**
 * SearchBar.jsx — type a place, a thing, or coordinates; go there.
 *
 * The search was a button that opened a centred palette, which answered
 * places from a backend geocoder only — so "Hormuz" sat at "No results"
 * for the seconds that took. It is now an input in the tab bar with its
 * suggestions dropping down under it as you type, the way a map search is
 * expected to work:
 *
 *   - countries, regions and major cities answer on the first keystroke
 *     (src/voice/gazetteer.js, data already shipped);
 *   - streets, towns, addresses, straits, ports and airports follow from
 *     GET /api/search (the backend geocoder, ~0.2–0.4s), merged in;
 *   - "26.5, 56.4" flies straight to the point;
 *   - Enter takes the top suggestion, arrows move, Escape clears.
 *
 * Every other search opener (Ctrl+Space, File → Open…, Home) used to open
 * the palette overlay; this listens for that and focuses itself instead,
 * so there is one search, not two.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { MODULES } from "../data/modules.js"
import { places as loadPlaces } from "../voice/gazetteer.js"
import { closeOverlay, subscribeOverlay } from "../state/overlayManager.js"
import { buildSuggestions, parseCoords } from "./searchModel.js"
import PlxIcon from "../plx6/PlxIcon.jsx"

const SEV = { critical: "var(--red)", high: "var(--amber)", significant: "var(--amber)" }

export default function SearchBar({
    narrow = false, theaters = [], signals = [],
    onPlace, onEntity, onSignal, onTheater, onModule,
}) {
    const [q, setQ] = useState("")
    const [open, setOpen] = useState(false)
    const [sel, setSel] = useState(0)
    const [remote, setRemote] = useState([])
    const [pending, setPending] = useState(false)
    const [places, setPlaces] = useState([])
    const input = useRef(null)
    const box = useRef(null)

    useEffect(() => { loadPlaces().then(setPlaces).catch(() => {}) }, [])

    // Any other "open search" lands here.
    useEffect(() => subscribeOverlay((cur) => {
        if (cur !== "overlay:palette") return
        closeOverlay("overlay:palette")
        input.current?.focus()
        setOpen(true)
    }), [])

    // Ctrl/⌘+K also focuses it (Ctrl+Space is handled by the shell).
    useEffect(() => {
        const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true) } }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [])

    useEffect(() => {
        const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
        document.addEventListener("mousedown", away)
        return () => document.removeEventListener("mousedown", away)
    }, [])

    useEffect(() => {
        const t = q.trim()
        if (t.length < 2 || parseCoords(t)) { setRemote([]); setPending(false); return undefined }
        setPending(true)
        let live = true
        const timer = setTimeout(() => {
            fetch(`${API_BASE}/api/search?q=${encodeURIComponent(t)}&limit=10`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : []))
                .then((d) => { if (live) { setRemote(Array.isArray(d) ? d : []); setPending(false) } })
                .catch(() => { if (live) { setRemote([]); setPending(false) } })
        }, 160)
        return () => { live = false; clearTimeout(timer) }
    }, [q])

    const coords = parseCoords(q)
    const groups = useMemo(() => {
        if (coords) {
            return [{ group: "Coordinates", items: [{ kind: "place", id: "coords", label: `${coords.lat.toFixed(4)}°, ${coords.lon.toFixed(4)}°`,
                                                       sub: "Fly to this point", lat: coords.lat, lon: coords.lon, altitude: 20_000 }] }]
        }
        return buildSuggestions(q, { places, remote, theaters, modules: MODULES, signals })
    }, [q, coords?.lat, coords?.lon, places, remote, theaters, signals]) // eslint-disable-line react-hooks/exhaustive-deps
    const flat = groups.flatMap((g) => g.items)

    const choose = (item) => {
        if (!item) return
        if (item.kind === "place") onPlace?.(item)
        else if (item.kind === "entity") onEntity?.(item.raw)
        else if (item.kind === "signal") onSignal?.(item.raw)
        else if (item.kind === "theater") onTheater?.(item.id)
        else if (item.kind === "module") onModule?.(item.id)
        setOpen(false)
        input.current?.blur()
    }

    const onKey = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setSel((i) => Math.min(i + 1, flat.length - 1)) }
        else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
        else if (e.key === "Enter") { e.preventDefault(); choose(flat[sel] || flat[0]) }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (q) setQ(""); else { setOpen(false); input.current?.blur() } }
    }

    let n = -1
    return (
        <div ref={box} style={{ position: "relative", flex: "none" }}>
            <label data-tour="search" style={{
                display: "flex", alignItems: "center", gap: 8,
                width: narrow ? 32 : (open ? 360 : 260), height: 28, transition: "width 140ms ease-out",
                padding: "0 8px 0 10px", border: `1px solid ${open ? "var(--acchi)" : "var(--gline)"}`,
                background: "var(--glass2)", color: "var(--txt3)", cursor: "text", boxSizing: "border-box",
            }}>
                <PlxIcon href="#g-search" size={13} style={{ flex: "none" }} />
                <input
                    ref={input} value={q} spellCheck={false} aria-label="Search places, things and coordinates"
                    placeholder={narrow ? "" : "Search a place, address, ship, signal…"}
                    onFocus={() => setOpen(true)}
                    onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true) }}
                    onKeyDown={onKey}
                    style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent",
                             color: "var(--txt)", font: "inherit", fontSize: 12.5, display: narrow ? "none" : "block" }}
                />
                {pending && <span style={{ font: "400 10px var(--mz-font-mono)", color: "var(--txt4)" }}>…</span>}
            </label>

            {open && (flat.length > 0 || q.trim().length >= 2) && (
                <div role="listbox" style={{
                    position: "absolute", top: 32, left: 0, width: 460, maxHeight: "min(70vh, 560px)", overflowY: "auto",
                    zIndex: 90, background: "var(--bg-1, var(--canvas))", border: "1px solid var(--gline2)",
                    boxShadow: "var(--gshadow)", padding: "4px 0",
                }}>
                    {groups.map((g) => (
                        <div key={g.group}>
                            <div style={{ padding: "8px 12px 4px", font: "600 10px var(--font)", letterSpacing: ".08em",
                                          textTransform: "uppercase", color: "var(--txt4)" }}>{g.group}</div>
                            {g.items.map((it) => {
                                n += 1
                                const i = n
                                return (
                                    <div key={`${it.kind}-${it.id}`} role="option" aria-selected={i === sel}
                                         onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); choose(it) }}
                                         style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 12px", cursor: "pointer",
                                                  background: i === sel ? "var(--accdim)" : "transparent" }}>
                                        {it.kind === "signal" && <i style={{ width: 7, height: 7, flex: "none", alignSelf: "center",
                                                                             background: SEV[it.severity] || "var(--txt4)" }} />}
                                        <span style={{ color: "var(--txt)", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 250 }}>{it.label}</span>
                                        {it.sub && <span style={{ color: "var(--txt4)", fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{it.sub}</span>}
                                    </div>
                                )
                            })}
                        </div>
                    ))}
                    {flat.length === 0 && !pending && (
                        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--txt4)" }}>
                            Nothing found for “{q.trim()}”. Try a city, a street, or coordinates like 26.5, 56.4.
                        </div>
                    )}
                    {pending && flat.length === 0 && (
                        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--txt4)" }}>Searching places…</div>
                    )}
                </div>
            )}
        </div>
    )
}
