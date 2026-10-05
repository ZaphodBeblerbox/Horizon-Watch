/**
 * TheaterEditor.jsx — making and changing a theater.
 *
 * A theater is three decisions: what it is called, where it looks, and
 * what is switched on there. The editor asks exactly those three.
 *
 * WHERE IT LOOKS IS TAKEN FROM THE MAP, not typed. Nobody knows the
 * latitude of the Bab el-Mandeb or what height shows the whole strait;
 * everybody can fly there and press a button. The numbers are shown and
 * editable underneath for the case where somebody does have a coordinate.
 */
import { useEffect, useMemo, useState } from "react"
import { LAYER_GROUPS } from "./layerRailConfig.js"
import API_BASE from "../apiBase.js"
import { places as loadPlaces } from "../voice/gazetteer.js"
import { buildSuggestions } from "../search/searchModel.js"

/* WHERE IT LOOKS IS A PLACE YOU NAME. The editor asked for latitude,
   longitude and height in metres — numbers nobody has to hand. Type the
   place instead; the same suggestions as the search box (local countries
   and cities instantly, the geocoder for the rest) and the camera height
   that suits it. The numbers stay available, folded, for whoever has one. */
function PlacePicker({ onPick }) {
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a place — Bab el-Mandeb, Red Sea, Taiwan…"
                   onKeyDown={(e) => { if (e.key === "Enter" && items[0]) { e.preventDefault(); onPick(items[0]); setQ("") } }}
                   style={INPUT} aria-label="Find the place this theater watches" />
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

const fmtHeight = (h) => (Number(h) >= 1000 ? `${Math.round(Number(h) / 1000).toLocaleString()} km up` : `${Math.round(Number(h))} m up`)

const SEVERITIES = [
    ["critical", "Critical"],
    ["elevated", "Elevated"],
    ["steady", "Steady"],
]

/* The same keys the map uses. Infra is listed here rather than imported
   from Situation.jsx because that module pulls the whole globe in with it,
   and this dialog only needs the names. */
const INFRA = [
    ["chokepoints", "Chokepoints"],
    ["ports", "Ports & terminals"],
    ["airfields", "Airports & airfields"],
    ["cables", "Submarine cables"],
    ["power", "Power grid"],
    ["nautical", "Nautical chart"],
    ["facMilitary", "Military sites"],
    ["facMedical", "Hospitals & clinics"],
    ["facSecurity", "Police & fire"],
]
const TRACKS = [["vessels", "Vessels"], ["aircraft", "Aircraft"]]

const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt-2)",
    font: "400 12px var(--font)", cursor: "pointer", borderRadius: 0,
}
const PRIMARY = {
    ...BTN, border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
    color: "var(--txt)", fontWeight: 600,
}
const DANGER = { ...BTN, color: "var(--red)", borderColor: "rgba(196,69,60,.45)" }
const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const INPUT = {
    width: "100%", height: 30, padding: "0 9px", background: "var(--glass2)",
    border: "1px solid var(--gline)", color: "var(--txt)",
    font: "400 13px var(--font)", outline: "none", borderRadius: 0,
}

function Pill({ on, children, onClick }) {
    return (
        <button type="button" onClick={onClick} style={{
            height: 24, padding: "0 9px", cursor: "pointer", borderRadius: 0,
            border: `1px solid ${on ? "var(--acc-line)" : "var(--gline)"}`,
            background: on ? "var(--acc-dim)" : "transparent",
            color: on ? "var(--txt)" : "var(--txt-3)",
            font: "400 11.5px var(--font)", whiteSpace: "nowrap",
        }}>{children}</button>
    )
}

/**
 * @param theater   the one being edited, or null to make a new one
 * @param readView  () => ({lat, lon, height}) for where the map is now
 */
export default function TheaterEditor({ theater = null, readView = null, onSave, onDelete, onClose, canDelete = true }) {
    const [name, setName] = useState(theater?.name || "")
    const [sev, setSev] = useState(theater?.sev || "steady")
    const [view, setView] = useState(theater?.view?.lat != null ? theater.view : null)
    const [placeName, setPlaceName] = useState(null)
    const [showCoords, setShowCoords] = useState(false)
    const [layers, setLayers] = useState(() => ({
        groups: theater?.layers?.groups || ["news"],
        infra: theater?.layers?.infra || [],
        tracks: theater?.layers?.tracks || [],
    }))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)

    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    // A new theater starts wherever the map already is — which is almost
    // always the place somebody was looking at when they decided to make one.
    useEffect(() => {
        if (!theater && !view && readView) setView(readView())
    }, [theater, view, readView])

    const toggle = (key, value) => setLayers((p) => {
        const list = p[key] || []
        return { ...p, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] }
    })

    const count = useMemo(
        () => Object.values(layers).reduce((a, v) => a + (v?.length || 0), 0), [layers])

    const save = async () => {
        setErr(null)
        if (!name.trim()) { setErr("A theater needs a name."); return }
        setBusy(true)
        try {
            await onSave({ name: name.trim(), sev, view, layers })
        } catch (e) {
            setErr(e.message || "That did not save")
        } finally { setBusy(false) }
    }

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.55)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="theater-editor" style={{
                width: 520, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "13px 16px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{ flex: 1, minWidth: 0, font: "600 13px var(--font)", color: "var(--txt)" }}>
                        {theater ? "Edit theater" : "New theater"}
                    </b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, flex: "none", padding: "0 6px" }}>✕</button>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>Name</div>
                        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                               placeholder="Bab el-Mandeb" maxLength={60} style={INPUT}
                               onKeyDown={(e) => { if (e.key === "Enter") save() }} />
                    </div>

                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>Standing</div>
                        <div style={{ display: "flex", gap: 5 }}>
                            {SEVERITIES.map(([k, l]) => (
                                <Pill key={k} on={sev === k} onClick={() => setSev(k)}>{l}</Pill>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <span style={EYE}>Where it looks</span>
                            <div style={{ flex: 1 }} />
                            {readView && (
                                <button style={{ ...BTN, height: 22 }} onClick={() => { setView(readView()); setPlaceName("the current map view") }}>
                                    Use the current map view
                                </button>
                            )}
                        </div>
                        <PlacePicker onPick={(p) => {
                            setView({ lat: +Number(p.lat).toFixed(4), lon: +Number(p.lon).toFixed(4), height: Math.round(p.altitude || 600_000) })
                            setPlaceName(p.label)
                            if (!name.trim()) setName(p.label)
                            // Show it, so the choice is visibly right before saving.
                            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude || 600_000 } }))
                        }} />
                        <div style={{ marginTop: 7, font: "400 12px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            {view ? (
                                <>
                                    Looks at <b style={{ color: "var(--txt)", fontWeight: 600 }}>{placeName || "the view you set"}</b>
                                    {" "}· {fmtHeight(view.height)}{" "}
                                    <button type="button" onClick={() => setShowCoords((v) => !v)}
                                            style={{ border: 0, background: "none", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit", padding: 0 }}>
                                        {showCoords ? "hide coordinates" : "coordinates"}
                                    </button>
                                </>
                            ) : "Not set — selecting this theater will leave the map where it is."}
                        </div>
                        {view && showCoords && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
                                {[["lat", "Latitude"], ["lon", "Longitude"], ["height", "Height (m)"]].map(([k, l]) => (
                                    <label key={k} style={{ display: "block" }}>
                                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>{l}</span>
                                        <input
                                            value={view[k] ?? ""} inputMode="decimal"
                                            onChange={(e) => setView((p) => ({ ...p, [k]: e.target.value }))}
                                            onBlur={(e) => {
                                                const n = Number(e.target.value)
                                                setView((p) => ({ ...p, [k]: Number.isFinite(n) ? n : 0 }))
                                            }}
                                            style={{ ...INPUT, height: 28, font: "400 12px var(--mono)" }}
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>
                            What is on here · {count} layer{count === 1 ? "" : "s"}
                        </div>
                        <p style={{ margin: "0 0 9px", font: "400 11.5px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            Selecting the theater turns these on and everything else off, so switching is a
                            change of subject rather than an accumulation.
                        </p>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "8px 0 4px" }}>Domains</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {LAYER_GROUPS.map((g) => (
                                <Pill key={g.key} on={layers.groups.includes(g.key)}
                                      onClick={() => toggle("groups", g.key)}>{g.label || g.key}</Pill>
                            ))}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Infrastructure</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {INFRA.map(([k, l]) => (
                                <Pill key={k} on={layers.infra.includes(k)}
                                      onClick={() => toggle("infra", k)}>{l}</Pill>
                            ))}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Live tracks</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {TRACKS.map(([k, l]) => (
                                <Pill key={k} on={layers.tracks.includes(k)}
                                      onClick={() => toggle("tracks", k)}>{l}</Pill>
                            ))}
                        </div>
                    </div>

                    {err && (
                        <div role="alert" style={{
                            font: "400 12px/1.6 var(--font)", color: "var(--red)",
                            border: "1px solid rgba(196,69,60,.4)", padding: "8px 11px",
                        }}>{err}</div>
                    )}
                </div>

                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "11px 16px",
                    borderTop: "1px solid var(--gline)",
                }}>
                    {theater && canDelete && (
                        <button style={{ ...DANGER, flex: "none" }} disabled={busy}
                                onClick={() => {
                                    if (confirm(`Delete “${theater.name}”? Anything you filed while watching it stays where it is.`)) onDelete(theater)
                                }}>Delete</button>
                    )}
                    <div style={{ flex: 1 }} />
                    <button style={{ ...BTN, flex: "none" }} onClick={onClose}>Cancel</button>
                    <button style={{ ...PRIMARY, flex: "none" }} disabled={busy} onClick={save}>
                        {busy ? "Saving…" : theater ? "Save" : "Create theater"}
                    </button>
                </div>
            </div>
        </div>
    )
}
