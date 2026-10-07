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
 * do. Each kind has its own 3D model (assets/three/), turning in the detail
 * and rendered as a still in the list. Placed by address or by clicking
 * the map — never by typing coordinates. Backend: routers/my_assets.py,
 * owned_assets.py.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import PlacePicker from "../search/PlacePicker.jsx"
import PinMap from "../ui/PinMap.jsx"
import AssetModel from "../assets/AssetModel.jsx"
import AssetThumb from "../assets/AssetThumb.jsx"
import Dots from "../ui/Dots.jsx"
import { shareToDesk } from "../desk/shareToDesk.js"
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

/** Add or edit an asset: what it is (with its model), and where — by address or on the map. */
function AssetForm({ kinds, initial, onSaved, onCancel }) {
    const [f, setF] = useState(() => ({
        name: "", kind: "", importance: "normal", country: "", notes: "", shared: false, radius_km: "",
        lat: null, lon: null, address: "", identifiers: {}, ...(initial || {}),
    }))
    const [err, setErr] = useState(null)
    const [busy, setBusy] = useState(false)
    const [addr, setAddr] = useState(initial?.address || null)      // shown in the address field
    const kind = kinds.find((k) => k.key === f.kind)
    const groups = useMemo(() => {
        const g = {}
        for (const k of kinds) (g[k.group] ||= []).push(k)
        return Object.entries(g)
    }, [kinds])
    const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
    const setId = (k, v) => setF((p) => ({ ...p, identifiers: { ...p.identifiers, [k]: v } }))
    const pinAt = (p, label) => {
        setF((x) => ({ ...x, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }))
        if (label) { setAddr(label); set("address", label); return }
        setAddr("Finding the address…")
        api(`/reverse?lat=${p.lat}&lon=${p.lon}`).then((d) => {
            const pl = d.place
            const text = pl?.label || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
            setAddr(text)
            setF((x) => ({ ...x, address: text, country: x.country || pl?.country || "" }))
        }).catch(() => setAddr(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`))
    }
    const save = async () => {
        setBusy(true); setErr(null)
        try {
            const body = {
                name: f.name, kind: f.kind, importance: f.importance, country: f.country || null,
                notes: [f.notes || null].filter(Boolean).join("") || null,
                shared: f.shared, lat: f.lat, lon: f.lon, radius_km: f.radius_km === "" ? null : Number(f.radius_km),
                address: f.address || null,
                identifiers: Object.fromEntries(Object.entries(f.identifiers || {}).filter(([, v]) => String(v || "").trim())),
            }
            const saved = initial?.id ? await api(`/${initial.id}`, { method: "PUT", body: JSON.stringify(body) })
                : await api("", { method: "POST", body: JSON.stringify(body) })
            onSaved(saved)
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
    }
    const LABEL = { fontSize: 12, color: "var(--txt3)", marginBottom: 5, display: "block" }
    const pin = f.lat != null && f.lon != null ? { lat: f.lat, lon: f.lon } : null
    return (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 28, minHeight: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 20 }}>{initial?.id ? `Edit ${initial.name}` : "Add an asset"}</h2>
                <label><span style={LABEL}>Type</span>
                    <select style={{ ...INPUT, height: 36, fontSize: 14 }} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                        <option value="">Choose what it is…</option>
                        {groups.map(([g, ks]) => (
                            <optgroup key={g} label={g}>
                                {ks.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </label>
                <div style={{ border: "1px solid var(--gline)", background: "radial-gradient(ellipse at 50% 60%, rgba(122,167,255,.07), transparent 70%)" }}>
                    {f.kind ? <AssetModel kind={f.kind} height={300} />
                        : <div style={{ height: 300, display: "grid", placeItems: "center", color: "var(--txt4)", fontSize: 13 }}>Choose a type to see it</div>}
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
                            <label key={k}><span style={LABEL}>{{ mmsi: "MMSI — followed live on AIS", imo: "IMO number", icao: "ICAO hex — followed live on ADS-B", registration: "Registration", plate: "Plate" }[k]}</span>
                                <input style={INPUT} value={f.identifiers?.[k] || ""} onChange={(e) => setId(k, e.target.value)} /></label>
                        ))}
                    </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                    <label><span style={LABEL}>Watch radius (km)</span>
                        <input style={INPUT} value={f.radius_km ?? ""} placeholder={kind ? `${kind.radius} km — the default for a ${kind.label.toLowerCase()}` : ""} onChange={(e) => set("radius_km", e.target.value)} /></label>
                    <label><span style={LABEL}>Country</span>
                        <input style={INPUT} value={f.country || ""} onChange={(e) => set("country", e.target.value)} placeholder="filled from the address" /></label>
                </div>
                <label><span style={LABEL}>What matters about it — cargo, crew, who depends on it</span>
                    <textarea value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={4}
                        style={{ ...INPUT, height: "auto", padding: 10, resize: "vertical", lineHeight: 1.5 }} /></label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--txt2)" }}>
                    <input type="checkbox" checked={!!f.shared} onChange={(e) => set("shared", e.target.checked)} /> Shared with the team
                </label>
                {err && <span style={{ color: "#FF6B6B", fontSize: 13 }}>{err}</span>}
                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={save} disabled={busy || !f.name || !f.kind} style={{ ...PRIMARY, height: 34, opacity: busy || !f.name || !f.kind ? 0.5 : 1 }}>
                        {busy ? "Saving…" : initial?.id ? "Save changes" : "Add to the register"}
                    </button>
                    <button onClick={onCancel} style={{ ...BTN, height: 34 }}>Cancel</button>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <span style={LABEL}>{kind?.moves ? "Where it usually is — optional when it is followed live" : "Where it is"}</span>
                <PlacePicker keep value={addr} label="Address" placeholder="Search an address or place — Jebel Ali Free Zone, 12 Rue de Rivoli Paris…"
                    onPick={(p) => pinAt({ lat: Number(p.lat), lon: Number(p.lon) }, p.address)} />
                <PinMap center={pin} pin={pin} zoom={16} radiusKm={Number(f.radius_km) || kind?.radius || null}
                    onPin={(p) => pinAt(p)} height={560} />
                <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                    Search an address, or click the map where it is; the watch radius is drawn around the pin.
                </span>
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

const ID_LABEL = { mmsi: "MMSI", imo: "IMO", icao: "ICAO", registration: "Registration", plate: "Plate" }

/** What the live feeds know about a tracked vessel: speed, heading, destination, flag, owner. */
function useVesselFacts(mmsi) {
    const [v, setV] = useState(null)
    useEffect(() => {
        if (!mmsi) { setV(null); return undefined }
        let live = true
        Promise.all([
            fetch(`${API_BASE}/api/ais/vessels/${mmsi}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch(`${API_BASE}/api/vessels/${mmsi}/owner`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]).then(([ais, own]) => { if (live) setV({ ais, owner: own?.owner, registry: own?.registry }) })
        return () => { live = false }
    }, [mmsi])
    return v
}

function Fact({ k, v }) {
    if (v == null || v === "") return null
    return (
        <>
            <span style={{ fontSize: 12, color: "var(--txt3)" }}>{k}</span>
            <span style={{ fontSize: 13.5, color: "var(--txt)" }}>{v}</span>
        </>
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
    const vf = useVesselFacts(asset.identifiers?.mmsi)
    const openSignal = (id) => {
        const it = s?.signals?.find((x) => x.id === id)
        if (it) flyTo(it.lat, it.lon, 40_000)
    }
    const remove = async () => {
        if (!window.confirm(`Remove ${asset.name} from the register?`)) return
        await api(`/${asset.id}`, { method: "DELETE" }).catch(() => {})
        onDeleted()
    }
    const ais = vf?.ais
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            {/* THE ASSET: its model, large, beside what we know about it */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 1fr)", gap: 0, border: "1px solid var(--gline)", background: "var(--glass2)" }}>
                <div style={{ position: "relative", background: "radial-gradient(ellipse at 50% 62%, rgba(122,167,255,.09), transparent 72%)", borderRight: "1px solid var(--gline)" }}>
                    <AssetModel kind={asset.kind} height={460} />
                    <span style={{ position: "absolute", left: 14, bottom: 10, ...EYE }}>{asset.kind_label} · drag to turn</span>
                </div>
                <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                            <span style={EYE}>{asset.kind_label} · {asset.importance}{asset.shared ? " · shared with the team" : ""}</span>
                            <h2 style={{ margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 24 }}>{asset.name}</h2>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                {s && <Chip exposure={s.exposure} />}
                                <span style={{ fontSize: 12, color: "var(--txt3)" }}>{s?.signals ? `${s.signals.length} signal${s.signals.length === 1 ? "" : "s"} within ${asset.radius_km} km, 72 h` : "reading what is near it…"}</span>
                            </div>
                        </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0,1fr)", gap: "7px 14px", alignItems: "baseline" }}>
                        <Fact k="Where" v={asset.address || (pos ? `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}` : null)} />
                        <Fact k="Position" v={pos ? `${pos.source}${pos.as_of ? ` · ${agoLabel(pos.as_of)}` : ""}` : s?.why} />
                        <Fact k="Country" v={asset.country} />
                        {Object.entries(asset.identifiers || {}).map(([k, v]) => <Fact key={k} k={ID_LABEL[k] || k} v={v} />)}
                        {ais && <Fact k="Speed, heading" v={`${ais.speed ?? "—"} kn · ${ais.heading != null && ais.heading !== 511 ? `${Math.round(ais.heading)}°` : "heading not sent"}`} />}
                        {ais && <Fact k="Status" v={ais.nav_status} />}
                        {ais && <Fact k="Destination" v={ais.destination} />}
                        {ais && <Fact k="Flag" v={ais.flag} />}
                        {vf?.owner && <Fact k="Registered owner" v={[vf.owner.name, vf.owner.country].filter(Boolean).join(", ")} />}
                        <Fact k="Watch radius" v={`${asset.radius_km} km`} />
                    </div>
                    {asset.notes && <p style={{ margin: 0, fontSize: 13, color: "var(--txt2)", lineHeight: 1.55, borderTop: "1px solid var(--gline)", paddingTop: 12 }}>{asset.notes}</p>}
                    <div style={{ display: "flex", gap: 6, marginTop: "auto", flexWrap: "wrap" }}>
                        {pos && <button onClick={() => flyTo(pos.lat, pos.lon)} style={PRIMARY}>Show on the map</button>}
                        <button onClick={() => shareToDesk({ kind: "asset", id: asset.id, name: asset.name, asset_kind: asset.kind, kind_label: asset.kind_label, group: asset.group, exposure: s?.exposure || null })} style={BTN}>Share to the desk</button>
                        {asset.mine && <button onClick={onEdit} style={BTN}>Edit</button>}
                        {asset.mine && <button onClick={remove} style={BTN}>Remove</button>}
                    </div>
                </div>
            </div>
            {/* WHAT IT MEANS, beside WHAT IS HAPPENING */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                    <div style={CARD}><Brief assetId={asset.id} signals={s?.signals} onCite={openSignal} />
                        {s?.signals?.length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>Nothing within range in the last 72 hours — nothing to read yet.</span>}
                    </div>
                    {pos && (
                        <div style={{ ...CARD, padding: 0, gap: 0 }}>
                            <span style={{ ...EYE, padding: "12px 16px" }}>Where · {asset.radius_km} km watched</span>
                            <PinMap center={pos} pin={pos} zoom={asset.radius_km > 40 ? 8 : asset.radius_km > 15 ? 10 : 12} radiusKm={asset.radius_km} height={340} />
                        </div>
                    )}
                </div>
                <div style={CARD}>
                    <span style={EYE}>What matters now · ranked by severity, distance and age</span>
                    {s?.signals?.length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>Nothing within range in the last 72 hours.</span>}
                    {(s?.signals || []).map((it, i) => (
                        <button key={it.id} onClick={() => flyTo(it.lat, it.lon, 40_000)} style={{
                            display: "grid", gridTemplateColumns: "22px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", textAlign: "left",
                            border: 0, borderTop: i ? "1px solid var(--gline)" : 0, background: "transparent", color: "var(--txt)",
                            font: "inherit", padding: "9px 0", cursor: "pointer",
                        }}>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt4)" }}>{i + 1}</span>
                            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                <span style={{ fontSize: 13.5 }}>{it.title}</span>
                                <span style={{ fontSize: 11.5, color: "var(--txt3)" }}><Dots text={[it.source, it.kind].filter(Boolean).join(" · ")} /></span>
                            </span>
                            <span style={{ fontSize: 12, color: "var(--txt2)", whiteSpace: "nowrap", display: "flex", gap: 8, alignItems: "center" }}>
                                <i style={{ width: 7, height: 7, borderRadius: "50%", background: SEV[String(it.severity).toLowerCase()] || "#9AA9BC", display: "inline-block" }} />
                                {it.km} km · {it.age_h < 1 ? "<1 h" : `${Math.round(it.age_h)} h`} ago
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default function Assets() {
    const [kinds, setKinds] = useState([])
    const [assets, setAssets] = useState(null)
    const [sel, setSel] = useState(null)
    const [mode, setMode] = useState("view")        // view | add | edit
    const load = useCallback(() => api("").then((d) => { setAssets(d.assets || []); window.dispatchEvent(new CustomEvent("akili:assets-changed")) }).catch(() => setAssets([])), [])
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
    // A click on an asset's pin on the map lands here, on that asset.
    useEffect(() => {
        const take = () => { if (window.__plxAssetSel) { setSel(window.__plxAssetSel); setMode("view"); window.__plxAssetSel = null } }
        take()
        const h = (e) => { setSel(e.detail?.id); setMode("view"); window.__plxAssetSel = null }
        window.addEventListener("akili:open-asset", h)
        return () => window.removeEventListener("akili:open-asset", h)
    }, [])
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
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(300px, 380px) minmax(0,1fr)" }}>
                <nav aria-label="Registered assets" style={{ borderRight: "1px solid var(--gline)", overflow: "auto", padding: "8px 0" }}>
                    {assets?.length === 0 && (
                        <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--txt3)", lineHeight: 1.55 }}>
                            Nothing registered yet. Add a vessel, an aircraft, a site or a team, and Parallax will rank what happens near it and say how it affects you.
                        </div>
                    )}
                    {(assets || []).map((a) => (
                        <button key={a.id} onClick={() => { setSel(a.id); setMode("view") }} style={{
                            display: "grid", gridTemplateColumns: "84px minmax(0,1fr)", gap: 12, width: "100%", textAlign: "left", alignItems: "center",
                            padding: "10px 16px", border: 0, borderLeft: `2px solid ${sel === a.id && mode === "view" ? "var(--acchi)" : "transparent"}`,
                            background: sel === a.id && mode === "view" ? "var(--accdim)" : "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer",
                        }}>
                            <AssetThumb kind={a.kind} group={a.group} width={84} height={54} />
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
                <div style={{ overflow: "auto", padding: "20px 24px 40px", minWidth: 0 }}>
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
