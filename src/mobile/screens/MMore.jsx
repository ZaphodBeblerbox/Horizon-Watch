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
import { useEffect, useRef, useState } from "react"
import API_BASE from "../../apiBase.js"
import { getCurrentUser, logout, subscribeAuth, updateCurrentUser } from "../../state/authStore.js"
import { Positionable, toPictureDataUrl, toCoverDataUrl } from "../../destinations/Profile.jsx"
import IssueReader from "../../reports/IssueReader.jsx"
import { usePoll, arr, getJSON } from "../useMine.js"
import { Icon, Row, Sheet, SignalSheet, sevColor, when } from "./common.jsx"
import { openSignal } from "../../notify/openSignal.js"
import { getSettings, subscribeSettings, updateSetting } from "../../state/settingsStore.js"
import { setDnd } from "../../state/notificationStore.js"
import LiveShareRow from "../../location/LiveShareRow.jsx"
import TrackSketch from "../../location/TrackSketch.jsx"
import { ShowTrackButton } from "../../location/TrackPanel.jsx"
import { openRoutePanel } from "../../routes/store.js"
import RouteContextCards from "../../routes/RouteContextCards.jsx"
import LivePositionLine from "../../location/LivePositionLine.jsx"
import AssetPeople from "../../warnings/AssetPeople.jsx"
import AdviseEvacuation from "../../evacuation/AdviseEvacuation.jsx"
import SafeHouseFields, { detailsBody, emptyDetails, declarable, isSafeHouse } from "../../evacuation/SafeHouseFields.jsx"
import AssetModel from "../../assets/AssetModel.jsx"
import { confirmAction } from "../../ui/confirm.js"
import { devicePosition, saveHere } from "../../components/LocationPrompt.jsx"
import { locate } from "../../location/geo.js"
import ClosedNotificationsRow from "../../notify/ClosedNotificationsRow.jsx"
import PushDevices from "../../notify/PushDevices.jsx"

const EXPOSURE = { high: ["High exposure", "#E5484D"], elevated: ["Elevated", "#F5A524"], low: ["Low", "#8FB4E8"], quiet: ["Quiet", "#4CAF7A"], unknown: ["No position", "#9AA9BC"] }
const isAdmin = () => { try { const u = getCurrentUser(); return !!u?.is_super_admin || String(u?.role || "").toLowerCase() === "admin" } catch { return false } }
const post = (path, body) => fetch(`${API_BASE}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
    .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).detail || `${r.status}`))))

function AssetDetail({ a, onClose, onShowOnMap, onRemoved }) {
    const [sit, setSit] = useState(null)
    const [brief, setBrief] = useState(null)
    const [open, setOpen] = useState(null)
    const [rmErr, setRmErr] = useState(null)
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
            {isSafeHouse(a) && <>
                {/* THE SAFE HOUSE: its model turning, whether it is open, places, contact */}
                <div style={{ marginBottom: 10 }}><AssetModel kind={a.kind} height={200} /></div>
                <div className="m2-card" data-testid="safe-house-facts" style={{ padding: 12, marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 650, color: a.details?.status === "closed" ? "#F5A524" : "#4fd08a" }}>{a.details?.status === "closed" ? "Closed — not offered in an evacuation" : "Open"}</div>
                    <div>{a.details?.capacity != null ? `${Math.max(0, a.details.capacity - (a.details.occupancy || 0))} of ${a.details.capacity} places free` : "Capacity not tracked"}</div>
                    {a.details?.contact && <div>{a.details.contact}</div>}
                </div>
            </>}
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
            {a.identifiers?.user_id && <>
                {/* LINKED TO A PERSON: their phone moves it — where it is now and where it has been */}
                <div className="m2-eyebrow" style={{ marginBottom: 6 }}>Where they have been</div>
                <div className="m2-card" style={{ padding: 10, marginBottom: 12 }}>
                    <div className="m2-sub" data-testid="asset-live-source" style={{ marginBottom: 8 }}>
                        Now: <LivePositionLine assetId={a.id} fallback={sit?.position || a.position} />
                    </div>
                    <TrackSketch assetId={a.id} />
                </div>
            </>}
            {/* LINK A PERSON (their phone moves it) · SEND THEM A WARNING (warnings/AssetPeople.jsx) */}
            <AssetPeople asset={a} variant="phone" />
            {/* ADVISE EVACUATION — the safest route to a safe house, sent with an alarm (evacuation/) */}
            <div style={{ margin: "10px 0" }}><AdviseEvacuation asset={a} variant="phone" onOpenRoute={onClose} /></div>
            {/* WHEN A ROUTE PLAN IS RELEVANT HERE: exit (a danger within 1 km) or deliveries/access (a call near a site) */}
            <div style={{ marginBottom: 10 }}><RouteContextCards assetId={a.id} /></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Number.isFinite(+(sit?.position?.lat ?? a.lat)) && <button className="m2-btn" onClick={() => { const p = sit?.position || a; onShowOnMap?.({ lat: p.lat, lon: p.lon }); onClose() }}>Show on the map</button>}
                {/* THE TRACK over a range, on the map; and the safest way out from where it is */}
                <ShowTrackButton className="m2-btn ghost" target={{ kind: "asset", id: a.id, name: a.name, userId: a.identifiers?.user_id }}
                                 onShown={() => { window.dispatchEvent(new CustomEvent("m2:go", { detail: "map" })); onClose() }} />
                {Number.isFinite(+(sit?.position?.lat ?? a.lat)) && <button className="m2-btn ghost" data-testid="asset-sheet-safe-route"
                    onClick={() => openRoutePanel({ request: { from: { asset_id: a.id }, to: null, mode: a.group === "Vehicles" ? "car" : "foot", purpose: "exit" } })}>Safest route</button>}
                {/* REMOVE: its owner or an admin; a failure is said (owner, 2026-10-12) */}
                {(a.mine || isAdmin()) && <button className="m2-btn ghost" data-testid="asset-sheet-remove" style={{ color: "#ff8a8d" }} onClick={async () => {
                    if (!(await confirmAction({ title: `Delete “${a.name}”?`, message: "This is not reversible.", confirm: "Delete", danger: true }))) return
                    setRmErr(null)
                    try {
                        const r = await fetch(`${API_BASE}/api/my-assets/${encodeURIComponent(a.id)}`, { method: "DELETE", credentials: "include" })
                        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`)
                        window.dispatchEvent(new CustomEvent("akili:assets-changed"))
                        onRemoved?.(); onClose()
                    } catch (e) { setRmErr(`Could not remove ${a.name}: ${e.message || "no connection"}`) }
                }}>Remove</button>}
            </div>
            {rmErr && <div role="alert" className="m2-sub" data-testid="asset-sheet-remove-error" style={{ color: "#ff8a8d", marginTop: 8 }}>{rmErr}</div>}
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </Sheet>
    )
}

function AddAsset({ onClose, onAdded, initialKind = "office" }) {
    const kinds = usePoll("/api/my-assets/kinds", 0, (d) => arr(d?.kinds ?? d))
    const [name, setName] = useState("")
    const [kind, setKind] = useState(initialKind)
    const [details, setDetails] = useState(emptyDetails())
    const [address, setAddress] = useState("")
    const [at, setAt] = useState(null)
    const [msg, setMsg] = useState(null)
    // asked inside the tap; a refusal says how to allow it (location/geo.js)
    const here = () => {
        setMsg("Finding you…")
        locate({ onRetry: () => setMsg("Weak signal — trying with lower accuracy…") })
            .then((p) => { setAt({ lat: p.lat, lon: p.lon }); setMsg("Using where you are.") })
            .catch((e) => setMsg(e.message))
    }
    const save = async () => {
        if (!name.trim()) { setMsg("Give it a name."); return }
        try {
            await post("/api/my-assets", { name, kind, address: address || undefined, ...(at || {}),
                                           ...(kind === "safe_house" || details.safe_house ? { details: detailsBody(details), shared: true } : {}) })
            window.dispatchEvent(new CustomEvent("akili:assets-changed"))
            onAdded(); onClose()
        }
        catch (e) { setMsg(e.message) }
    }
    return (
        <Sheet onClose={onClose}>
            <div className="m2-eyebrow" style={{ marginBottom: 8 }}>{kind === "safe_house" ? "Add a safe house" : "Register an asset"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input className="m2-input" placeholder="Name (e.g. Head office Munich)" value={name} onChange={(e) => setName(e.target.value)} />
                <select className="m2-input" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="m-add-kind">
                    {/* the safe house first: easy to find (owner, 2026-10-12) */}
                    {[...(kinds || [])].sort((x, y) => (y.key === "safe_house") - (x.key === "safe_house"))
                        .map((k) => <option key={k.key || k.kind || k} value={k.key || k.kind || k}>{k.label || k.key || k}</option>)}
                </select>
                {/* DECLARE AS SAFE HOUSE: any building or site keeps its kind (owner, 2026-10-12) */}
                {declarable((kinds || []).find((k) => k.key === kind)) && (
                    <label className="m2-sub" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }} data-testid="m-declare-safe-house">
                        <input type="checkbox" checked={!!details.safe_house} onChange={(e) => setDetails({ ...details, safe_house: e.target.checked })} />
                        Declare as safe house
                    </label>
                )}
                {(kind === "safe_house" || details.safe_house) && <SafeHouseFields value={details} onChange={setDetails} inputStyle={{ width: "100%", minHeight: 40, padding: "8px 10px", border: "1px solid rgba(255,255,255,.14)", background: "rgba(0,0,0,.2)",
                                                                                                      color: "inherit", font: "inherit", borderRadius: 8, boxSizing: "border-box" }} />}
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
    const [adding, setAdding] = useState(false)       // false | an asset kind to start from
    const [only, setOnly] = useState("all")           // all | safe
    const load = () => getJSON("/api/my-assets").then((d) => setAssets(arr(d?.assets)))
    useEffect(() => { load() }, [])
    useEffect(() => { if (initial && assets) setOpen(assets.find((a) => a.id === initial) || null) }, [initial, assets])
    return (
        <div className="m2-scroll" data-screen-label="Phone assets">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <span className="m2-eyebrow" style={{ flex: 1 }}>What you protect</span>
                <button className="m2-chip" onClick={() => setAdding("safe_house")} data-testid="m-add-safe-house" style={{ marginRight: 6 }}><Icon id="g-plus" size={14} />Safe house</button>
                <button className="m2-chip" onClick={() => setAdding("office")}><Icon id="g-plus" size={14} />Add</button>
            </div>
            {/* SAFE HOUSES, easy to find */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button className="m2-chip" aria-pressed={only === "all"} onClick={() => setOnly("all")} >All{assets ? ` · ${assets.length}` : ""}</button>
                <button className="m2-chip" aria-pressed={only === "safe"} data-testid="m-assets-filter-safe" onClick={() => setOnly("safe")}
                        style={only === "safe" ? { borderColor: "#2E9E5B", background: "rgba(46,158,91,.2)" } : undefined}>Safe houses{assets ? ` · ${assets.filter(isSafeHouse).length}` : ""}</button>
            </div>
            <div className="m2-card">
                {assets === null ? <div className="m2-empty">Loading…</div> : assets.length === 0 ? <div className="m2-empty">No assets yet. Register a site, a vessel or a vehicle, and Parallax tells you what happens near it.</div>
                    : only === "safe" && !assets.some(isSafeHouse) ? <div className="m2-empty">No safe house yet. Tap “Safe house” above, or declare a building one when you add it.</div>
                    : assets.filter((a) => only === "all" || isSafeHouse(a)).map((a) => {
                        const ex = EXPOSURE[a.exposure] || EXPOSURE.unknown
                        return <Row key={a.id} color={ex[1]} title={a.name} sub={[ex[0], a.kind_label || a.kind, isSafeHouse(a) && a.kind !== "safe_house" ? "safe house" : null, a.top?.title].filter(Boolean).join(" · ")}
                            when={a.signal_count ? `${a.signal_count} near` : ""} onClick={() => setOpen(a)} />
                    })}
            </div>
            {open && <AssetDetail a={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} onRemoved={load} />}
            {adding && <AddAsset key={adding} initialKind={adding} onClose={() => setAdding(false)} onAdded={load} />}
        </div>
    )
}

export function MAlerts({ onShowOnMap, onOpen, focus = null }) {
    const items = usePoll("/api/notifications?limit=60", 30_000, (d) => arr(d?.items ?? d))
    const [open, setOpen] = useState(null)
    // OPENED FROM ITS NOTIFICATION (a signal with no place on a map): found
    // in the list, scrolled to, opened in place with its details under it
    const bare = (x) => String(x ?? "").replace(/^sig[:-]/, "")
    const found = focus ? arr(items).find((n) => bare(n.id) === bare(focus.id) || (n.alert_id && bare(n.alert_id) === bare(focus.id))) : null
    const foundRef = useRef(null)
    useEffect(() => { if (found && foundRef.current) foundRef.current.scrollIntoView({ block: "center", behavior: "smooth" }) }, [found?.id, focus?._t]) // eslint-disable-line react-hooks/exhaustive-deps
    const tap = (n) => (n.kind === "asset" && n.asset_id ? onOpen("assets", { asset: n.asset_id })
        // as its notification opens: the map at it, drawn, with its card (notify/openSignal.js)
        : openSignal({ ...n, headline: n.title, sev: n.sev }))
    return (
        <div className="m2-scroll" data-screen-label="Phone alerts">
            <div className="m2-eyebrow" style={{ marginBottom: 10 }}>For you, newest first</div>
            {focus && !found && items !== null && (
                <div className="m2-card" style={{ marginBottom: 12 }}>
                    <div className="m2-row found" style={{ cursor: "default" }}><span /><span style={{ minWidth: 0 }}><span className="m2-t">{focus.title || "Signal"}</span>
                        <span className="m2-sub">No longer in your list; it has no place to show on the map.</span></span><span /></div>
                </div>
            )}
            <div className="m2-card">
                {items === null ? <div className="m2-empty">Loading…</div> : items.length === 0 ? <div className="m2-empty">Nothing has earned an interruption.</div>
                    : items.map((n) => (n === found ? (
                        <div key={n.id} ref={foundRef} data-testid="alert-found">
                            <div className="m2-row found" style={{ cursor: "default" }}>
                                <span className="m2-dot" style={{ background: sevColor(n.sev) }} />
                                <span style={{ minWidth: 0 }}><span className="m2-t">{n.title}</span></span>
                                <span className="m2-when">{when(n.created_at)}</span>
                            </div>
                            <div className="m2-found-detail">
                                {n.reason && <div style={{ marginBottom: 10 }}>{n.reason}</div>}
                                <button className="m2-btn" style={{ height: 34 }} onClick={() => setOpen({ ...n, headline: n.title, severity_tier: n.sev })}>Details</button>
                            </div>
                        </div>
                    ) : <Row key={n.id} color={sevColor(n.sev)} title={n.title} sub={n.reason} when={when(n.created_at)} onClick={() => tap(n)} />))}
            </div>
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </div>
    )
}

export function MReports() {
    const runs = usePoll("/api/briefings2/runs", 60_000, (d) => arr(d))
    const [reading, setReading] = useState(null)
    if (reading) return (
        <div className="m2-fit" style={{ display: "flex", flexDirection: "column" }}>
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
            background: value ? "#f4f5f7" : "rgba(255,255,255,.16)",
        }}>
            <span style={{ position: "absolute", top: 2, left: value ? 22 : 2, width: 27, height: 27, borderRadius: 14,
                           background: value ? "#0a0b0d" : "#fff", transition: "left .25s cubic-bezier(.22,1,.36,1), background .2s ease" }} />
        </button>
    )
}

export function MProfile() {
    /* YOUR PICTURE AND HEADER, EDITED ON THE PHONE (owner, 2026-10-12): the
       same images and focal points as the desktop Profile (Profile.jsx), and
       the same save — change, drag to reposition, remove. */
    const [u, setU] = useState(() => getCurrentUser() || {})
    useEffect(() => subscribeAuth((x) => setU(x || {})), [])
    const [draft, setDraft] = useState(null)        // {avatar, avatar_pos, cover, cover_pos} while editing
    const [posing, setPosing] = useState(null)      // "avatar" | "cover"
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState(null)
    const v = draft || { avatar: u.avatar || null, avatar_pos: u.avatar_pos || "50% 50%", cover: u.cover || null, cover_pos: u.cover_pos || "50% 50%" }
    const edit = (patch) => setDraft({ ...v, ...patch })
    const pick = (which) => {
        const inp = document.createElement("input")
        inp.type = "file"; inp.accept = "image/*"
        inp.onchange = async () => {
            const f = inp.files?.[0]
            if (!f) return
            try {
                if (which === "avatar") edit({ avatar: await toPictureDataUrl(f), avatar_pos: "50% 50%" })
                else edit({ cover: await toCoverDataUrl(f), cover_pos: "50% 50%" })
                setPosing(which); setMsg(null)
            } catch (e) { setMsg({ ok: false, text: e.message }) }
        }
        inp.click()
    }
    const save = async () => {
        if (!u.id || !draft) return
        setBusy(true); setMsg(null)
        try {
            const r = await fetch(`${API_BASE}/api/users/${u.id}`, {
                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ avatar: v.avatar, avatar_pos: v.avatar_pos, cover: v.cover, cover_pos: v.cover_pos }),
            })
            const d = await r.json().catch(() => null)
            if (!r.ok) throw new Error(d?.detail || `Could not save (${r.status})`)
            updateCurrentUser(d); setDraft(null); setPosing(null)
            setMsg({ ok: true, text: "Saved — your picture and header show everywhere." })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
    }
    const chip = { height: 30, padding: "0 12px", borderRadius: 15, border: "1px solid var(--gline2)", background: "rgba(10,14,22,.6)",
                   color: "var(--txt)", font: "inherit", fontSize: 12.5, cursor: "pointer" }
    return (
        <div className="m2-scroll" data-screen-label="Phone profile">
            <div className="m2-card" style={{ overflow: "hidden", marginBottom: 10 }} data-testid="m2-profile-edit">
                <div style={{ position: "relative", height: 120, background: "linear-gradient(160deg,#1c2433,#0e131c)" }}>
                    {v.cover && <Positionable src={v.cover} pos={v.cover_pos} editing={posing === "cover"}
                                              onPos={(p) => edit({ cover_pos: p })} style={{ width: "100%", height: 120 }} />}
                    <div style={{ position: "absolute", right: 8, bottom: 8, display: "flex", gap: 6 }}>
                        {v.cover && <button style={chip} onClick={() => setPosing(posing === "cover" ? null : "cover")}>{posing === "cover" ? "Done" : "Reposition"}</button>}
                        <button style={chip} onClick={() => pick("cover")}>{v.cover ? "Change header" : "Add a header"}</button>
                        {v.cover && <button style={chip} onClick={() => { edit({ cover: null }); setPosing(null) }}>Remove</button>}
                    </div>
                    {posing === "cover" && <div className="m2-sub" style={{ position: "absolute", left: 10, top: 8, color: "#fff", textShadow: "0 1px 3px #000" }}>Drag to choose what shows</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14 }}>
                    <div style={{ width: 64, height: 64, borderRadius: 32, overflow: "hidden", flex: "none", background: "#2a2e36", color: "var(--txt2)", display: "grid", placeItems: "center", fontWeight: 650 }}>
                        {v.avatar ? <Positionable src={v.avatar} pos={v.avatar_pos} editing={posing === "avatar"} radius="50%"
                                                  onPos={(p) => edit({ avatar_pos: p })} style={{ width: 64, height: 64 }} />
                            : u.initials}
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 650 }}>{u.name}</div>
                        <div className="m2-sub">{[u.title, u.company].filter(Boolean).join(" · ") || u.email}</div>
                    </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 14px" }}>
                    <button style={chip} onClick={() => pick("avatar")}>{v.avatar ? "Change picture" : "Add a picture"}</button>
                    {v.avatar && <button style={chip} onClick={() => setPosing(posing === "avatar" ? null : "avatar")}>{posing === "avatar" ? "Done" : "Reposition"}</button>}
                    {v.avatar && <button style={chip} onClick={() => { edit({ avatar: null }); setPosing(null) }}>Remove</button>}
                </div>
                {draft && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "0 14px 14px" }}>
                        <button className="m2-btn" disabled={busy} onClick={save} data-testid="m2-profile-save">{busy ? "Saving…" : "Save"}</button>
                        <button className="m2-btn ghost" disabled={busy} onClick={() => { setDraft(null); setPosing(null); setMsg(null) }}>Cancel</button>
                    </div>
                )}
                {msg && <div className="m2-sub" style={{ padding: "0 14px 14px", color: msg.ok ? "var(--txt2)" : "var(--red, #e5484d)" }}>{msg.text}</div>}
            </div>
            <button className="m2-btn ghost" style={{ width: "100%", marginBottom: 14 }} onClick={() => window.dispatchEvent(new CustomEvent("m2:go", { detail: "settings" }))}>
                Settings — notifications, location, time
            </button>
            <div className="m2-sub" style={{ marginBottom: 14, lineHeight: 1.5 }}>Your name, theaters and interests are set on the desktop under Profile and Settings; the phone follows them.</div>
            <button className="m2-btn ghost" onClick={() => logout().then(() => window.location.reload())}>Sign out</button>
            {/* which build this phone is running: a cached copy looks like a fix that did not ship */}
            <div className="m2-sub" data-testid="build-stamp" style={{ marginTop: 18, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                Parallax {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""} · build {typeof __PLX_BUILD__ !== "undefined" ? __PLX_BUILD__ : "?"}
            </div>
        </div>
    )
}

/** Where you are, on the phone: use the device's location, or forget it. */
function HereRowPhone() {
    const [here, setHere] = useState(() => getSettings()?.interests?.here || null)
    useEffect(() => subscribeSettings((st) => setHere(st?.interests?.here || null)), [])
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)
    const use = async () => {
        setBusy(true); setErr(null)
        const asked = devicePosition()          // inside the tap, before any await
        try { const p = await asked; await saveHere(p.lat, p.lon, p.label || null) }
        catch (e) { setErr(e.message) } finally { setBusy(false) }
    }
    return (
        <PhoneRow label="Your location" hint={<>{here ? `${here.label || `${here.lat}, ${here.lon}`} — what happens within 30 km comes first.` : "Not shared yet."}
            {err && <span style={{ display: "block", color: "var(--red, #e5484d)", marginTop: 4 }}>{err}</span>}</>}>
            <button className="m2-chip" disabled={busy} onClick={use}>{busy ? "Finding…" : here ? "Update" : "Use my location"}</button>
        </PhoneRow>
    )
}


/** Settings on the phone (owner, 2026-10-10: "there is no settings page on
 *  mobile"): notifications, sounds, location, time, footage — the same
 *  stored settings as the desktop's, so the two agree. */
export function MSettings() {
    const [st, setSt] = useState(() => getSettings() || {})
    useEffect(() => subscribeSettings((s) => setSt(s || {})), [])
    const Group = ({ title, children }) => (
        <>
            <div className="m2-h">{title}</div>
            <div className="m2-card" style={{ padding: "2px 14px", marginBottom: 6 }}>{children}</div>
        </>
    )
    const set = (k, v) => updateSetting(k, v)
    const timeUtc = st?.general?.timeDisplay === "utc"
    return (
        <div className="m2-scroll" data-screen-label="Phone settings">
            <Group title="Notifications">
                <ClosedNotificationsRow Row={PhoneRow} Toggle={PhoneToggle} />
                <PushDevices Row={PhoneRow} />
                <PhoneRow label="Do not disturb" hint="No cards on screen; everything still lands in Alerts.">
                    <PhoneToggle value={!!st.dnd} onChange={(v) => setDnd(v)} />
                </PhoneRow>
                <PhoneRow label="Alert sounds" hint="A sound with each card that takes the screen.">
                    <PhoneToggle value={!st.soundMuted} onChange={(v) => set("soundMuted", !v)} />
                </PhoneRow>
                {!st.soundMuted && <>
                    <PhoneRow label="Critical"><PhoneToggle value={st.soundCritical !== false} onChange={(v) => set("soundCritical", v)} /></PhoneRow>
                    <PhoneRow label="High"><PhoneToggle value={st.soundSignificant !== false} onChange={(v) => set("soundSignificant", v)} /></PhoneRow>
                    <PhoneRow label="Moderate"><PhoneToggle value={!!st.soundElevated} onChange={(v) => set("soundElevated", v)} /></PhoneRow>
                </>}
            </Group>
            {/* WHAT A NOTIFICATION IS — the server's one rule (event_watch.notifies),
                the same on this phone and the desktop app */}
            <div className="m2-sub" data-testid="notify-rule" style={{ margin: "4px 4px 14px", lineHeight: 1.5 }}>
                With Parallax closed, this phone gets the same notifications as the desktop app: whatever would pop up on the
                desktop's screen — anything critical, escalations, surges, fusions, high-severity signals, Telegram reports,
                official claims of a strike, live developments and a channel going live. A burst arrives as two
                notifications and one "N more". Everything else waits in Alerts.
            </div>
            <Group title="Location">
                <HereRowPhone />
                <LiveShareRow Row={PhoneRow} Toggle={PhoneToggle} />
            </Group>
            <Group title="Time">
                <PhoneRow label="Times shown in" hint="Your local time, or Zulu (UTC) everywhere.">
                    <div className="m2-segs" style={{ width: 160 }}>
                        <button aria-pressed={!timeUtc} onClick={() => set("general.timeDisplay", "local")}>Local</button>
                        <button aria-pressed={timeUtc} onClick={() => set("general.timeDisplay", "utc")}>Zulu</button>
                    </div>
                </PhoneRow>
            </Group>
            <Group title="Footage">
                <PhoneRow label="Warn before graphic footage" hint="Footage that may show dead or injured people opens blurred until you choose to see it.">
                    <PhoneToggle value={st?.media?.warnGraphic !== false} onChange={(v) => set("media.warnGraphic", v)} />
                </PhoneRow>
            </Group>
            <div className="m2-sub" data-testid="build-stamp" style={{ marginTop: 16, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                Parallax {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""} · build {typeof __PLX_BUILD__ !== "undefined" ? __PLX_BUILD__ : "?"}
            </div>
        </div>
    )
}
