/**
 * WhatsNext.jsx — the top of Insight › What happens next.
 *
 * 1. ESCALATING NOW: countries whose share of the world's violent events
 *    rose against their own 28-day normal (backend/escalation.py) — a
 *    measured change, "+437% vs its normal", not a model's adjective.
 * 2. WHAT MAY FOLLOW: the outlook (backend/outlook.py) — who may do what,
 *    where, by when, how we will know, and what to watch for — each with a
 *    one-click response: watch the area by satellite, or make it a theater.
 *
 * YOURS FIRST (the owner, 2026-10-07): both lists follow the user's
 * interests — the countries their theaters frame, the ones they chose, and
 * what lies near their assets. "Yours" shows only those (the default once
 * there are any); "Everywhere" shows all, yours marked and first.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"
import { watched, nearestAsset } from "../state/interests.js"
import { places as loadPlaces } from "../voice/gazetteer.js"
import { theaterHere, watchArea } from "./respond.js"

const EYEBROW = { fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)" }
const BTN = { height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }

function Spark({ series }) {
    if (!series?.length) return null
    const max = Math.max(1, ...series.map((p) => p.events))
    const W = 140, H = 28, n = series.length
    const pts = series.map((p, i) => `${(i / (n - 1)) * W},${H - (p.events / max) * (H - 2) - 1}`).join(" ")
    const lastX = W * ((n - 4) / (n - 1))
    return (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="Violent events per day, last 31 days" style={{ flex: "none" }}>
            <rect x={lastX} y={0} width={W - lastX} height={H} fill="var(--red)" opacity="0.12" />
            <polyline points={pts} fill="none" stroke="var(--acchi)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    )
}

export default function WhatsNext({ onOpenModule = () => {} }) {
    const [esc, setEsc] = useState(null)
    const [outlook, setOutlook] = useState(null)
    const [places, setPlaces] = useState([])
    useEffect(() => {
        let live = true
        fetch(`${API_BASE}/api/insight/escalation?limit=10`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setEsc(d) }).catch(() => {})
        fetch(`${API_BASE}/api/enrich/outlook`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setOutlook(d) }).catch(() => {})
        loadPlaces().then((ps) => { if (live) setPlaces(ps.filter((p) => p.kind === "country")) }).catch(() => {})
        return () => { live = false }
    }, [])
    const [theaters, setTheaters] = useState([])
    const [assets, setAssets] = useState([])
    const [interests, setInterests] = useState(() => getSettings()?.interests || {})
    useEffect(() => subscribeSettings((st) => setInterests(st?.interests || {})), [])
    useEffect(() => {
        let live = true
        fetch(`${API_BASE}/api/theaters`, { credentials: "include" }).then((r) => (r.ok ? r.json() : [])).then((d) => { if (live) setTheaters(Array.isArray(d) ? d : []) }).catch(() => {})
        fetch(`${API_BASE}/api/my-assets`, { credentials: "include" }).then((r) => (r.ok ? r.json() : {})).then((d) => { if (live) setAssets(d.assets || []) }).catch(() => {})
        return () => { live = false }
    }, [])
    const w = useMemo(() => watched(interests || {}, theaters, places, assets), [interests, theaters, places, assets])
    const hasYours = w.countries.size > 0 || w.assets.length > 0
    const [scope, setScope] = useState(null)              // null until known: "yours" when there is something
    const view = scope || (hasYours ? "yours" : "everywhere")
    const countryIsMine = (name) => w.countries.has(name)
    const outlookIsMine = (o) => (o.lat != null && nearestAsset({ lat: o.lat, lon: o.lon }, w.assets))
        || [...w.countries.keys()].some((c) => `${o.place || ""} ${o.statement || ""}`.toLowerCase().includes(String(c).toLowerCase()))
    const where = (country) => places.find((p) => p.name.toLowerCase() === String(country || "").toLowerCase())
    const show = (lat, lon, altitude) => {
        onOpenModule("map")
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } }))
    }

    const risingAll = (esc?.countries || []).filter((c) => c.change_pct >= 40)
        .sort((a, b) => countryIsMine(b.country) - countryIsMine(a.country))
    const rising = view === "yours" ? risingAll.filter((c) => countryIsMine(c.country)) : risingAll
    const outlookAll = [...(outlook?.outlook || [])].sort((a, b) => !!outlookIsMine(b) - !!outlookIsMine(a))
    const outlookShown = view === "yours" ? outlookAll.filter((o) => outlookIsMine(o)) : outlookAll
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                    {[["yours", "Yours"], ["everywhere", "Everywhere"]].map(([k, l]) => (
                        <button key={k} onClick={() => setScope(k)} style={{ ...BTN, border: 0, background: view === k ? "var(--accdim)" : "transparent" }}>{l}</button>
                    ))}
                </div>
                <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                    {hasYours ? `Yours: ${[...w.countries.keys()].slice(0, 6).join(", ")}${w.countries.size > 6 ? "…" : ""}${w.assets.length ? `${w.countries.size ? " and " : ""}near ${w.assets.length} asset${w.assets.length === 1 ? "" : "s"}` : ""}`
                        : "Nothing is yours yet — make a theater, add countries under Settings › Your interests, or register an asset."}
                </span>
            </div>
            <div style={CARD}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--gline)", display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={EYEBROW}>Escalating now</span>
                    <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{esc?.rule || "Violent events against each country's own normal"}</span>
                </div>
                {!esc ? <div style={{ padding: 14, color: "var(--txt3)" }}>Loading…</div>
                    : !rising.length ? <div style={{ padding: 14, color: "var(--txt3)" }}>{view === "yours" && risingAll.length ? `None of your countries is markedly above its normal; ${risingAll.length} elsewhere — see Everywhere.` : "No country's violence is markedly above its normal in the last 3 days."}</div>
                    : rising.map((c) => {
                        const p = where(c.country)
                        return (
                            <div key={c.iso3} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 14, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--gline)" }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                                        <b style={{ fontSize: 15 }}>{c.country}</b>
                                        {countryIsMine(c.country) && <span style={{ fontSize: 10.5, color: "var(--acchi)" }}>yours · {w.countries.get(c.country)}</span>}
                                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 13, color: c.escalating ? "var(--red)" : "var(--amber)" }}>
                                            {c.change_pct > 0 ? "+" : ""}{c.change_pct}%
                                        </span>
                                        <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
                                            {c.escalating ? "escalating" : "rising, within its usual swing"} · {c.recent_per_day} violent events a day vs {c.baseline_per_day} normally · {c.sigma} sd
                                        </span>
                                    </div>
                                </div>
                                <Spark series={c.series} />
                                <div style={{ display: "flex", gap: 6 }}>
                                    {p && <button style={BTN} onClick={() => show(p.lat, p.lon, p.altitude)}>Map</button>}
                                    {p && <button style={BTN} onClick={() => theaterHere({ name: `${c.country} escalation`, lat: p.lat, lon: p.lon, height: p.altitude })}>Theater here</button>}
                                </div>
                            </div>
                        )
                    })}
                <div style={{ padding: "8px 14px", fontSize: 10.5, color: "var(--txt4)" }}>{esc?.source}{esc?.days ? ` · ${esc.days} days of history` : ""}</div>
            </div>

            <div style={CARD}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--gline)" }}><span style={EYEBROW}>What may follow · next 14 days</span></div>
                {!outlook ? <div style={{ padding: 14, color: "var(--txt3)" }}>Loading…</div>
                    : !outlookShown.length ? <div style={{ padding: 14, color: "var(--txt3)" }}>{view === "yours" && outlookAll.length ? `Nothing forecast for your countries or assets; ${outlookAll.length} elsewhere — see Everywhere.` : "Nothing specific enough to forecast from today's signals."}</div>
                    : outlookShown.map((o, i) => (
                        <div key={i} style={{ padding: "12px 14px", borderBottom: "1px solid var(--gline)", display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 15, color: o.probability >= 60 ? "var(--red)" : "var(--amber)", minWidth: 40 }}>{o.probability}%</span>
                                <b style={{ fontSize: 14.5, textWrap: "pretty" }}>{[o.place, o.statement].filter(Boolean).join(" · ")}</b>
                                {outlookIsMine(o) && <span style={{ fontSize: 10.5, color: "var(--acchi)", whiteSpace: "nowrap" }}>yours</span>}
                            </div>
                            {o.because && <span style={{ fontSize: 12.5, color: "var(--txt2)", paddingLeft: 50 }}>{o.because}</span>}
                            {(o.watch_for || []).length > 0 && (
                                <div style={{ paddingLeft: 50, fontSize: 12.5, color: "var(--txt)" }}>
                                    <span style={{ ...EYEBROW, fontSize: 9.5 }}>Watch for </span>{o.watch_for.join(" · ")}
                                </div>
                            )}
                            <span style={{ paddingLeft: 50, fontSize: 11, color: "var(--txt4)" }}>Resolves by {o.resolves_by} if: {o.criterion}</span>
                            {o.lat != null && (
                                <div style={{ paddingLeft: 50, display: "flex", gap: 6, marginTop: 2 }}>
                                    <button style={BTN} onClick={() => show(o.lat, o.lon, 250_000)}>Map</button>
                                    <button style={BTN} onClick={() => watchArea({ name: o.place || "area", lat: o.lat, lon: o.lon })}>Watch this area</button>
                                    <button style={BTN} onClick={() => theaterHere({ name: o.place || "New theater", lat: o.lat, lon: o.lon })}>Theater here</button>
                                </div>
                            )}
                        </div>
                    ))}
            </div>
        </div>
    )
}
