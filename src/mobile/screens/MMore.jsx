/**
 * MMore.jsx — the screens behind the quick menu on the phone:
 *
 *   Assets      what the user protects, how exposed each is, what is near
 *               it and how it affects them (the same brief as the desktop);
 *               register one by address or "where I am"
 *   Alerts      the notifications meant for this user
 *   Reports     their situation reports: read them, or take the PDF
 *   Profile     who they are, sign out
 */
import { useEffect, useState } from "react"
import API_BASE from "../../apiBase.js"
import { getCurrentUser, logout } from "../../state/authStore.js"
import IssueReader from "../../reports/IssueReader.jsx"
import { usePoll, arr, getJSON } from "../useMine.js"
import { Icon, Row, Sheet, SignalSheet, sevColor, when } from "./common.jsx"
import LiveShareRow from "../../location/LiveShareRow.jsx"
import ClosedNotificationsRow from "../../notify/ClosedNotificationsRow.jsx"

const EXPOSURE = { high: ["High exposure", "#E5484D"], elevated: ["Elevated", "#F5A524"], low: ["Low", "#8FB4E8"], quiet: ["Quiet", "#4CAF7A"], unknown: ["No position", "#9AA9BC"] }
const post = (path, body) => fetch(`${API_BASE}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).detail || `${r.status}`))))

function AssetDetail({ a, onClose, onShowOnMap }) {
    const [sit, setSit] = useState(null)
    const [brief, setBrief] = useState(null)
    const [open, setOpen] = useState(null)
    useEffect(() => {
        getJSON(`/api/my-assets/${a.id}/situation`).then(setSit)
        post(`/api/my-assets/${a.id}/brief`).then(setBrief).catch(() => setBrief({ error: true }))
    }, [a.id])
    const ex = EXPOSURE[sit?.exposure || a.exposure] || EXPOSURE.unknown
    return (
        <Sheet onClose={onClose}>
            <div className="m2-eyebrow" style={{ color: ex[1] }}>{ex[0]}</div>
            <h2 style={{ margin: "6px 0 2px", fontSize: 20 }}>{a.name}</h2>
            <div className="m2-sub" style={{ marginBottom: 12 }}>{[a.kind_label || a.kind, a.address || a.country, a.radius_km && `watch radius ${a.radius_km} km`].filter(Boolean).join(" · ")}</div>
            <div className="m2-eyebrow" style={{ marginBottom: 6 }}>How it affects you</div>
            <div className="m2-card" style={{ padding: 12, marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
                {!brief ? "Reading the situation…" : brief.error ? "The brief could not be written right now." : (
                    <>
                        <div>{brief.impact || brief.one_line}</div>
                        {arr(brief.measures).length > 0 && <>
                            <div className="m2-eyebrow" style={{ margin: "10px 0 4px" }}>What to do</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>{brief.measures.map((m, i) => <li key={i} style={{ marginBottom: 4 }}>{m.action}</li>)}</ul>
                        </>}
                    </>
                )}
            </div>
            <div className="m2-eyebrow" style={{ marginBottom: 6 }}>Near it</div>
            <div className="m2-card" style={{ marginBottom: 12 }}>
                {!sit ? <div className="m2-empty">Loading…</div> : arr(sit.signals).length === 0 ? <div className="m2-empty">Nothing within range in the last 72 hours.</div>
                    : sit.signals.slice(0, 8).map((s) => <Row key={s.id} s={s} title={s.title} sub={[s.km != null && `${Math.round(s.km)} km`, s.category, s.source].filter(Boolean).join(" · ")}
                        when={when(s.when)} onClick={() => setOpen({ ...s, headline: s.title })} />)}
            </div>
            {Number.isFinite(+a.lat) && <button className="m2-btn" onClick={() => { onShowOnMap?.({ lat: a.lat, lon: a.lon }); onClose() }}>Show on the map</button>}
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </Sheet>
    )
}

function AddAsset({ onClose, onAdded }) {
    const kinds = usePoll("/api/my-assets/kinds", 0, (d) => arr(d?.kinds ?? d))
    const [name, setName] = useState("")
    const [kind, setKind] = useState("office")
    const [address, setAddress] = useState("")
    const [at, setAt] = useState(null)
    const [msg, setMsg] = useState(null)
    const here = () => navigator.geolocation?.getCurrentPosition((p) => { setAt({ lat: p.coords.latitude, lon: p.coords.longitude }); setMsg("Using where you are.") }, () => setMsg("Location was not allowed."))
    const save = async () => {
        if (!name.trim()) { setMsg("Give it a name."); return }
        try { await post("/api/my-assets", { name, kind, address: address || undefined, ...(at || {}) }); onAdded(); onClose() }
        catch (e) { setMsg(e.message) }
    }
    return (
        <Sheet onClose={onClose}>
            <div className="m2-eyebrow" style={{ marginBottom: 8 }}>Register an asset</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input className="m2-input" placeholder="Name (e.g. Head office Munich)" value={name} onChange={(e) => setName(e.target.value)} />
                <select className="m2-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                    {(kinds || []).map((k) => <option key={k.key || k.kind || k} value={k.key || k.kind || k}>{k.label || k.key || k}</option>)}
                </select>
                <input className="m2-input" placeholder="Address — enough to find it" value={address} onChange={(e) => setAddress(e.target.value)} />
                <div style={{ display: "flex", gap: 8 }}>
                    <button className="m2-btn ghost" onClick={here}><Icon id="g-pin" size={14} /> Where I am</button>
                    <span style={{ flex: 1 }} />
                    <button className="m2-btn" onClick={save}>Save</button>
                </div>
                {msg && <div className="m2-sub">{msg}</div>}
            </div>
        </Sheet>
    )
}

export function MAssets({ onShowOnMap, initial }) {
    const [assets, setAssets] = useState(null)
    const [open, setOpen] = useState(null)
    const [adding, setAdding] = useState(false)
    const load = () => getJSON("/api/my-assets").then((d) => setAssets(arr(d?.assets)))
    useEffect(() => { load() }, [])
    useEffect(() => { if (initial && assets) setOpen(assets.find((a) => a.id === initial) || null) }, [initial, assets])
    return (
        <div className="m2-scroll" data-screen-label="Phone assets">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <span className="m2-eyebrow" style={{ flex: 1 }}>What you protect</span>
                <button className="m2-chip" onClick={() => setAdding(true)}><Icon id="g-plus" size={14} />Add</button>
            </div>
            <div className="m2-card">
                {assets === null ? <div className="m2-empty">Loading…</div> : assets.length === 0 ? <div className="m2-empty">No assets yet. Register a site, a vessel or a vehicle, and Parallax tells you what happens near it.</div>
                    : assets.map((a) => {
                        const ex = EXPOSURE[a.exposure] || EXPOSURE.unknown
                        return <Row key={a.id} color={ex[1]} title={a.name} sub={[ex[0], a.kind_label || a.kind, a.top?.title].filter(Boolean).join(" · ")}
                            when={a.signal_count ? `${a.signal_count} near` : ""} onClick={() => setOpen(a)} />
                    })}
            </div>
            {open && <AssetDetail a={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
            {adding && <AddAsset onClose={() => setAdding(false)} onAdded={load} />}
        </div>
    )
}

export function MAlerts({ onShowOnMap, onOpen }) {
    const items = usePoll("/api/notifications?limit=60", 30_000, (d) => arr(d?.items ?? d))
    const [open, setOpen] = useState(null)
    return (
        <div className="m2-scroll" data-screen-label="Phone alerts">
            <div className="m2-eyebrow" style={{ marginBottom: 10 }}>For you, newest first</div>
            <div className="m2-card">
                {items === null ? <div className="m2-empty">Loading…</div> : items.length === 0 ? <div className="m2-empty">Nothing has earned an interruption.</div>
                    : items.map((n) => <Row key={n.id} color={sevColor(n.sev)} title={n.title} sub={n.reason} when={when(n.created_at)}
                        onClick={() => (n.kind === "asset" && n.asset_id ? onOpen("assets", { asset: n.asset_id }) : setOpen({ ...n, headline: n.title, severity_tier: n.sev }))} />)}
            </div>
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </div>
    )
}

export function MReports() {
    const runs = usePoll("/api/briefings2/runs", 60_000, (d) => arr(d))
    const [reading, setReading] = useState(null)
    if (reading) return (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
            <IssueReader runId={reading} onClose={() => setReading(null)} />
        </div>
    )
    const done = arr(runs).filter((r) => r.status === "done")
    return (
        <div className="m2-scroll" data-screen-label="Phone reports">
            <div className="m2-eyebrow" style={{ marginBottom: 10 }}>Your situation reports</div>
            <div className="m2-card">
                {runs === null ? <div className="m2-empty">Loading…</div> : done.length === 0 ? <div className="m2-empty">No reports yet. They are written on the desktop, under Reports › Situation report, and appear here to read.</div>
                    : done.map((r) => (
                        <div key={r.id} style={{ padding: "11px 12px", borderTop: "1px solid var(--gline, rgba(255,255,255,.08))" }}>
                            <span className="m2-t">{r.title || `${r.cadence} report`}</span>
                            <span className="m2-sub">{[r.language?.toUpperCase(), `${r.pages} pages`, when(r.created_at), r.mode === "rehearsal" ? "rehearsal" : null].filter(Boolean).join(" · ")}</span>
                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                <button className="m2-btn" style={{ height: 34 }} onClick={() => setReading(r.id)}>Read</button>
                                <a className="m2-btn ghost" style={{ height: 34, display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={`${API_BASE}/api/briefings2/runs/${r.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                            </div>
                        </div>
                    ))}
            </div>
        </div>
    )
}

// The settings row and switch, in the phone's own type and 44 px target.
function PhoneRow({ label, hint, children }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
                {hint && <div className="m2-sub" style={{ marginTop: 4, lineHeight: 1.45 }}>{hint}</div>}
            </div>
            {children}
        </div>
    )
}
function PhoneToggle({ value, onChange }) {
    return (
        <button aria-pressed={value} onClick={() => onChange(!value)} style={{
            width: 51, height: 31, minWidth: 51, borderRadius: 16, border: 0, padding: 0, position: "relative", cursor: "pointer",
            background: value ? "var(--acchi, #7f9cc8)" : "rgba(255,255,255,.16)",
        }}>
            <span style={{ position: "absolute", top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: 14,
                           background: "#fff", transition: "left .15s ease" }} />
        </button>
    )
}

export function MProfile() {
    const u = getCurrentUser() || {}
    return (
        <div className="m2-scroll" data-screen-label="Phone profile">
            <div className="m2-card" style={{ overflow: "hidden", marginBottom: 14 }}>
                {u.cover && <img src={u.cover} alt="" style={{ display: "block", width: "100%", height: 110, objectFit: "cover" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14 }}>
                    {u.avatar ? <img src={u.avatar} alt="" style={{ width: 54, height: 54, borderRadius: 27, objectFit: "cover" }} />
                        : <span style={{ width: 54, height: 54, borderRadius: 27, display: "grid", placeItems: "center", background: u.color || "#334", fontWeight: 700 }}>{u.initials}</span>}
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 650 }}>{u.name}</div>
                        <div className="m2-sub">{[u.title, u.company].filter(Boolean).join(" · ") || u.email}</div>
                    </div>
                </div>
            </div>
            <div className="m2-card" style={{ padding: "4px 14px", marginBottom: 14 }}>
                <ClosedNotificationsRow Row={PhoneRow} Toggle={PhoneToggle} />
                <LiveShareRow Row={PhoneRow} Toggle={PhoneToggle} />
            </div>
            <div className="m2-sub" style={{ marginBottom: 14, lineHeight: 1.5 }}>Your picture, header, theaters and interests are set on the desktop under Profile and Settings; the phone follows them.</div>
            <button className="m2-btn ghost" onClick={() => logout().then(() => window.location.reload())}>Sign out</button>
        </div>
    )
}
