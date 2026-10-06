/**
 * Assets.jsx — the asset register: what we have in the world, and what is
 * happening to it.
 *
 * Left, every asset (yours and the team's shared ones), most important
 * first, each with how exposed it is right now and the signal that matters
 * most. Right, the chosen asset: where it is (live for a vessel or aircraft
 * we can see), every signal within its radius ranked, and — read by the
 * model from exactly those signals — how they affect it, what could affect
 * it next (actor, place, act, a sign to watch for and a date), and what to
 * do. Backend: routers/my_assets.py, owned_assets.py.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import PlacePicker from "../search/PlacePicker.jsx"
import AssetFigure from "../assets/AssetFigure.jsx"
import { agoLabel } from "../utils/formatTime.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt2)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const PRIMARY = { ...BTN, background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }
const INPUT = {
    height: 32, padding: "0 10px", border: "1px solid var(--gline2)", background: "var(--glass2)", color: "var(--txt)",
    font: "inherit", fontSize: 13, borderRadius: 0, outline: "none", width: "100%", boxSizing: "border-box",
}
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }
export const EXPOSURE = {
    high: { label: "High exposure", color: "#E5484D" },
    elevated: { label: "Elevated", color: "#F5A524" },
    low: { label: "Low", color: "#8FB4E8" },
    quiet: { label: "Quiet", color: "#4CAF7A" },
    unknown: { label: "No position", color: "#9AA9BC" },
}
const SEV = { critical: "#E5484D", high: "#F5A524", significant: "#F5A524", elevated: "#F5A524", moderate: "#8FB4E8" }

const api = (path, opts = {}) => fetch(`${API_BASE}/api/my-assets${path}`, {
    credentials: "include", ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
}).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`); return d })

const flyTo = (lat, lon, altitude = 60_000) => {
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } })), 300)
}

function Chip({ exposure }) {
    const e = EXPOSURE[exposure] || EXPOSURE.unknown
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--txt2)", whiteSpace: "nowrap" }}>
            <i style={{ width: 8, height: 8, borderRadius: "50%", background: e.color, display: "inline-block" }} />{e.label}
        </span>
    )
}

/** Add or edit an asset. */
function AssetForm({ kinds, initial, onSaved, onCancel }) {
    const [f, setF] = useState(() => ({
        name: "", kind: "", importance: "normal", country: "", notes: "", shared: false, radius_km: "",
        lat: null, lon: null, place: "", identifiers: {}, ...(initial || {}),
    }))
    const [err, setErr] = useState(null)
    const [busy, setBusy] = useState(false)
    const kind = kinds.find((k) => k.key === f.kind)
    const groups = useMemo(() => {
        const g = {}
        for (const k of kinds) (g[k.group] ||= []).push(k)
        return Object.entries(g)
    }, [kinds])
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
    const setId = (k, v) => setF((p) => ({ ...p, identifiers: { ...p.identifiers, [k]: v } }))
    const save = async () => {
        setBusy(true); setErr(null)
        try {
            const body = {
                name: f.name, kind: f.kind, importance: f.importance, country: f.country || null, notes: f.notes || null,
                shared: f.shared, lat: f.lat, lon: f.lon, radius_km: f.radius_km === "" ? null : Number(f.radius_km),
                identifiers: Object.fromEntries(Object.entries(f.identifiers || {}).filter(([, v]) => String(v || "").trim())),
            }
            const saved = initial?.id ? await api(`/${initial.id}`, { method: "PUT", body: JSON.stringify(body) })
                : await api("", { method: "POST", body: JSON.stringify(body) })
            onSaved(saved)
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
    }
    const LABEL = { fontSize: 12, color: "var(--txt3)", marginBottom: 4, display: "block" }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
            <div>
                <span style={LABEL}>What is it</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {groups.map(([g, ks]) => (
                        <div key={g} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ ...EYE, width: 84 }}>{g}</span>
                            {ks.map((k) => (
                                <button key={k.key} onClick={() => set("kind", k.key)} style={{
                                    ...BTN, display: "inline-flex", alignItems: "center", gap: 6, height: 30,
                                    ...(f.kind === k.key ? { background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" } : null),
                                }}><AssetFigure group={k.group} size={16} color="currentColor" />{k.label}</button>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 12 }}>
                <label><span style={LABEL}>Name</span>
                    <input style={INPUT} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="MT Aurora, Jebel Ali office, Plant 3…" /></label>
                <label><span style={LABEL}>Importance</span>
                    <select style={INPUT} value={f.importance} onChange={(e) => set("importance", e.target.value)}>
                        <option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option>
                    </select></label>
            </div>
            {kind && kind.ids.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${kind.ids.length}, minmax(0,1fr))`, gap: 12 }}>
                    {kind.ids.map((k) => (
                        <label key={k}><span style={LABEL}>{{ mmsi: "MMSI (follows it live on AIS)", imo: "IMO number", icao: "ICAO hex (follows it live on ADS-B)", registration: "Registration", plate: "Plate" }[k]}</span>
                            <input style={INPUT} value={f.identifiers?.[k] || ""} onChange={(e) => setId(k, e.target.value)} /></label>
                    ))}
                </div>
            )}
            <div>
                <span style={LABEL}>{kind?.moves ? "Where it usually is (optional when it is tracked live)" : "Where it is"}</span>
                <PlacePicker label="" placeholder="Type a place — Jebel Ali, Hodeidah port, Djibouti…"
                    onPick={(p) => setF((x) => ({ ...x, lat: +Number(p.lat).toFixed(5), lon: +Number(p.lon).toFixed(5), place: p.label || p.name || "" }))} />
                <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                    <input style={{ ...INPUT, width: 140 }} placeholder="latitude" value={f.lat ?? ""} onChange={(e) => set("lat", e.target.value === "" ? null : Number(e.target.value))} />
                    <input style={{ ...INPUT, width: 140 }} placeholder="longitude" value={f.lon ?? ""} onChange={(e) => set("lon", e.target.value === "" ? null : Number(e.target.value))} />
                    {f.place && <span style={{ fontSize: 12, color: "var(--txt3)" }}>{f.place}</span>}
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                <label><span style={LABEL}>Watch radius (km)</span>
                    <input style={INPUT} value={f.radius_km ?? ""} placeholder={kind ? `default ${kind.radius}` : ""} onChange={(e) => set("radius_km", e.target.value)} /></label>
                <label><span style={LABEL}>Country</span>
                    <input style={INPUT} value={f.country || ""} onChange={(e) => set("country", e.target.value)} placeholder="e.g. United Arab Emirates" /></label>
                <label style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 6, fontSize: 13, color: "var(--txt2)" }}>
                    <input type="checkbox" checked={!!f.shared} onChange={(e) => set("shared", e.target.checked)} /> Shared with the team
                </label>
            </div>
            <label><span style={LABEL}>Notes — what matters about it (cargo, crew, what it supplies, who depends on it)</span>
                <textarea value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={3}
                    style={{ ...INPUT, height: "auto", padding: 10, resize: "vertical", lineHeight: 1.5 }} /></label>
            {err && <span style={{ color: "#FF6B6B", fontSize: 13 }}>{err}</span>}
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={save} disabled={busy || !f.name || !f.kind} style={{ ...PRIMARY, height: 32, opacity: busy || !f.name || !f.kind ? 0.5 : 1 }}>
                    {busy ? "Saving…" : initial?.id ? "Save changes" : "Add to the register"}
                </button>
                <button onClick={onCancel} style={{ ...BTN, height: 32 }}>Cancel</button>
            </div>
        </div>
    )
}

/** The model's reading: impact, what could come next, measures — each citing the signals. */
function Brief({ assetId, signals, onCite }) {
    const [b, setB] = useState(null)
    const load = useCallback((force = false) => {
        setB({ loading: true })
        api(`/${assetId}/brief${force ? "?force=true" : ""}`, { method: "POST" })
            .then(setB).catch((e) => setB({ error: e.message }))
    }, [assetId])
    useEffect(() => { if (signals?.length) load(false); else setB(null) }, [assetId, signals?.length]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!signals?.length) return null
    const cite = (text) => String(text || "").split(/(\[a\d+\])/g).map((part, i) => {
        const m = part.match(/^\[(a\d+)\]$/)
        if (!m || !b?.cites?.[m[1]]) return <span key={i}>{part}</span>
        return <button key={i} onClick={() => onCite(b.cites[m[1]])} title="Show this signal"
            style={{ border: 0, background: "var(--accdim)", color: "var(--txt)", font: "inherit", fontSize: 11, padding: "0 4px", cursor: "pointer", borderRadius: 3 }}>{m[1].slice(1)}</button>
    })
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={EYE}>How it affects us</span>
                {b?.written_at && <span style={{ fontSize: 11, color: "var(--txt4)" }}>read {agoLabel(b.written_at)} from the signals below</span>}
                <button onClick={() => load(true)} style={{ ...BTN, height: 24, marginLeft: "auto" }}>Read again</button>
            </div>
            {b?.loading && <span style={{ color: "var(--txt3)", fontSize: 13 }}>Reading the signals near it…</span>}
            {b?.error && <span style={{ color: "#FF6B6B", fontSize: 13 }}>{b.error}</span>}
            {b?.impact && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--txt)" }}>{cite(b.impact)}</p>}
            {b?.could_affect?.length > 0 && (
                <>
                    <span style={EYE}>What could affect it next</span>
                    {b.could_affect.map((c, i) => (
                        <div key={i} style={{ borderLeft: "2px solid #F5A524", padding: "2px 0 2px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
                            <span style={{ fontSize: 13.5, color: "var(--txt)" }}>{c.what}{c.by ? <span style={{ color: "var(--txt3)" }}> · by {c.by}</span> : null}</span>
                            <span style={{ fontSize: 12.5, color: "var(--txt2)" }}>{cite(c.why)}</span>
                            {c.watch_for && <span style={{ fontSize: 12, color: "var(--txt3)" }}>Watch for: {c.watch_for}</span>}
                        </div>
                    ))}
                </>
            )}
            {b?.measures?.length > 0 && (
                <>
                    <span style={EYE}>Measures</span>
                    <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                        {b.measures.map((m, i) => <li key={i} style={{ fontSize: 13.5, color: "var(--txt)", lineHeight: 1.5 }}>{m.action} <span style={{ color: "var(--txt3)" }}>{cite(m.why)}</span></li>)}
                    </ol>
                </>
            )}
        </div>
    )
}

function Detail({ asset, onEdit, onDeleted }) {
    const [s, setS] = useState(null)
    useEffect(() => {
        let live = true
        setS(null)
        api(`/${asset.id}/situation`).then((d) => { if (live) setS(d) }).catch((e) => { if (live) setS({ error: e.message }) })
        return () => { live = false }
    }, [asset.id, asset.updated_at])
    const pos = s?.position
    const openSignal = (id) => {
        const it = s?.signals?.find((x) => x.id === id)
        if (it) flyTo(it.lat, it.lon, 40_000)
    }
    const remove = async () => {
        if (!window.confirm(`Remove ${asset.name} from the register?`)) return
        await api(`/${asset.id}`, { method: "DELETE" }).catch(() => {})
        onDeleted()
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                <div style={{ width: 120, height: 120, display: "grid", placeItems: "center", border: "1px solid var(--gline)", background: "var(--glass2)", flex: "none" }}>
                    <AssetFigure group={asset.group} size={72} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <span style={EYE}>{asset.kind_label} · {asset.importance}{asset.shared ? " · shared" : ""}</span>
                    <h2 style={{ margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 22 }}>{asset.name}</h2>
                    <span style={{ fontSize: 13, color: "var(--txt2)" }}>
                        {pos ? `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)} · ${pos.source}${pos.speed_kn != null ? ` · ${pos.speed_kn} kn` : ""}${pos.as_of ? ` · ${agoLabel(pos.as_of)}` : ""}`
                            : s?.why || "Finding it…"}
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {s && <Chip exposure={s.exposure} />}
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>watching {asset.radius_km} km around it</span>
                    </div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignSelf: "flex-start" }}>
                    {pos && <button onClick={() => flyTo(pos.lat, pos.lon)} style={BTN}>Show on the map</button>}
                    {asset.mine && <button onClick={onEdit} style={BTN}>Edit</button>}
                    {asset.mine && <button onClick={remove} style={BTN}>Remove</button>}
                </div>
            </div>
            {asset.notes && <p style={{ margin: 0, fontSize: 13, color: "var(--txt2)", lineHeight: 1.5 }}>{asset.notes}</p>}
            <div style={CARD}><Brief assetId={asset.id} signals={s?.signals} onCite={openSignal} /></div>
            <div style={CARD}>
                <span style={EYE}>What matters now · {s?.signals?.length ?? "…"} within {asset.radius_km} km, last 72 h</span>
                {s?.signals?.length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>Nothing within range in the last 72 hours.</span>}
                {(s?.signals || []).map((it, i) => (
                    <button key={it.id} onClick={() => flyTo(it.lat, it.lon, 40_000)} style={{
                        display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", textAlign: "left",
                        border: 0, borderTop: i ? "1px solid var(--gline)" : 0, background: "transparent", color: "var(--txt)",
                        font: "inherit", padding: "8px 0", cursor: "pointer",
                    }}>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt4)" }}>{i + 1}</span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: 13.5 }}>{it.title}</span>
                            <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{[it.source, it.kind].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span style={{ fontSize: 12, color: "var(--txt2)", whiteSpace: "nowrap", display: "flex", gap: 8, alignItems: "center" }}>
                            <i style={{ width: 7, height: 7, borderRadius: "50%", background: SEV[String(it.severity).toLowerCase()] || "#9AA9BC", display: "inline-block" }} />
                            {it.km} km · {it.age_h < 1 ? "<1 h" : `${Math.round(it.age_h)} h`} ago
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}

export default function Assets() {
    const [kinds, setKinds] = useState([])
    const [assets, setAssets] = useState(null)
    const [sel, setSel] = useState(null)
    const [mode, setMode] = useState("view")        // view | add | edit
    const load = useCallback(() => api("").then((d) => setAssets(d.assets || [])).catch(() => setAssets([])), [])
    // The kinds are fixed, but the first request can lose a race with a
    // backend still warming up — ask again until they arrive.
    useEffect(() => {
        let live = true, tries = 0
        const get = () => api("/kinds").then((d) => { if (live) setKinds(d.kinds || []) })
            .catch(() => { if (live && ++tries < 6) setTimeout(get, 3000) })
        get(); load()
        return () => { live = false }
    }, [load])
    useEffect(() => { if (assets?.length && !assets.find((a) => a.id === sel)) setSel(assets[0].id) }, [assets, sel])
    // "+ Add asset" from Home lands here ready to add.
    useEffect(() => { if (window.__plxAddAsset) { window.__plxAddAsset = false; setMode("add") } }, [])
    const current = assets?.find((a) => a.id === sel)
    const counts = useMemo(() => {
        const c = { high: 0, elevated: 0 }
        for (const a of assets || []) if (c[a.exposure] != null) c[a.exposure]++
        return c
    }, [assets])

    return (
        <section data-screen-label="Assets" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
            <header style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "18px 24px 14px", borderBottom: "1px solid var(--gline)" }}>
                <h1 style={{ margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 22 }}>Assets</h1>
                <span style={{ fontSize: 13, color: "var(--txt3)" }}>
                    {assets ? `${assets.length} registered${counts.high ? ` · ${counts.high} highly exposed` : ""}${counts.elevated ? ` · ${counts.elevated} elevated` : ""}` : "reading the register"}
                </span>
                <button onClick={() => setMode("add")} style={{ ...PRIMARY, marginLeft: "auto" }}>+ Add asset</button>
            </header>
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(0,1fr)" }}>
                <nav aria-label="Registered assets" style={{ borderRight: "1px solid var(--gline)", overflow: "auto", padding: "8px 0" }}>
                    {assets?.length === 0 && (
                        <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--txt3)", lineHeight: 1.55 }}>
                            Nothing registered yet. Add a vessel, an aircraft, a site or a team, and Parallax will rank what happens near it and say how it affects you.
                        </div>
                    )}
                    {(assets || []).map((a) => (
                        <button key={a.id} onClick={() => { setSel(a.id); setMode("view") }} style={{
                            display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", gap: 10, width: "100%", textAlign: "left",
                            padding: "10px 16px", border: 0, borderLeft: `2px solid ${sel === a.id && mode === "view" ? "var(--acchi)" : "transparent"}`,
                            background: sel === a.id && mode === "view" ? "var(--accdim)" : "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer",
                        }}>
                            <AssetFigure group={a.group} size={30} />
                            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                                <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                                    <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                                    <span style={{ marginLeft: "auto" }}><Chip exposure={a.exposure} /></span>
                                </span>
                                <span style={{ fontSize: 12, color: "var(--txt3)" }}>{a.kind_label}{a.signal_count ? ` · ${a.signal_count} signal${a.signal_count === 1 ? "" : "s"} near it` : ""}</span>
                                {a.top && <span style={{ fontSize: 12, color: "var(--txt2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.top.title}</span>}
                            </span>
                        </button>
                    ))}
                </nav>
                <div style={{ overflow: "auto", padding: "20px 24px 60px", minWidth: 0 }}>
                    {mode === "add" && <AssetForm kinds={kinds} onCancel={() => setMode("view")} onSaved={(a) => { setMode("view"); setSel(a.id); load() }} />}
                    {mode === "edit" && current && <AssetForm kinds={kinds} initial={current} onCancel={() => setMode("view")} onSaved={() => { setMode("view"); load() }} />}
                    {mode === "view" && current && <Detail asset={current} onEdit={() => setMode("edit")} onDeleted={() => { setSel(null); load() }} />}
                    {mode === "view" && !current && assets?.length === 0 && (
                        <button onClick={() => setMode("add")} style={{ ...PRIMARY, height: 34 }}>Add your first asset</button>
                    )}
                </div>
            </div>
        </section>
    )
}
