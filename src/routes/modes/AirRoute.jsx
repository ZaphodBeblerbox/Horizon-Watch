/**
 * AirRoute.jsx — the Flights route mode (owner, 2026-10-12: "risk of a
 * flight path through conflict airspace, GPS-jamming areas and missile
 * ranges, useful for business travel and charter decisions").
 *
 *   in   from / to airports (search by code, name or city), or a live
 *        aircraft (its track, and its path to its destination when the
 *        route is known — else its heading projected)
 *   out  the trade-off in one sentence; the candidates (direct great circle
 *        and the detours) with exposure bars and the extra time; what each
 *        crosses; the hazards with why and their caveats; every source with
 *        its dates. The paths are drawn on the globe (airLayer.cesium.jsx)
 *        and on the phone's map (airLayer.leaflet.js).
 *
 * Exports
 *   default AirRoute       the mode's body ({ctx, onPlan}) — what a shared route panel renders for mode "air"
 *   AirRoutePanel          a standalone sidebar (desktop) / sheet (phone) around it, opened by openAirRoute()
 *   AirRouteOffer          the aircraft inspector's "Check this flight's route" card (an inspector extension)
 */
import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "../routes.css"
import { addBaseTiles } from "../../mobile/tileSources.js"
import { closeRoutePanel } from "../store.js"
import {
    getAirRoute, subscribeAirRoute, openAirRoute, closeAirRoute, publishAirPlan, selectAirCandidate,
    fetchAirPlan, fetchAirContext, searchAirports, aircraftHex,
    fmtMinutes, fmtExtra, RISK_TEXT, RISK_COLOR, exposureBar, crossingLine, hazardColor, sourceLines, candidateColor,
} from "./airRoute.js"
import { drawAirPlan } from "./airLayer.leaflet.js"

export function useAirRoute() {
    const [s, setS] = useState(getAirRoute())
    useEffect(() => subscribeAirRoute(setS), [])
    return s
}

const ctxKey = (ctx) => (ctx?.icao ? `icao:${ctx.icao}` : ctx?.from && ctx?.to ? `${ctx.from}>${ctx.to}` : "")

// ── the mode's body ───────────────────────────────────────────────────────

export default function AirRoute({ ctx: ctx0, onPlan, onCtx }) {
    const [ctx, setCtx] = useState(ctx0 || {})
    useEffect(() => { setCtx(ctx0 || {}) }, [ctxKey(ctx0)]) // eslint-disable-line react-hooks/exhaustive-deps
    const [plan, setPlan] = useState(null)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const [sel, setSel] = useState(null)
    const key = ctxKey(ctx)
    const load = async () => {
        if (!key) return
        setLoading(true); setError(null)
        try {
            const p = await fetchAirPlan(ctx)
            setPlan(p); setSel(p.recommended || null)
        } catch (e) { setPlan(null); setError(e.message || "Could not assess the route") }
        finally { setLoading(false) }
    }
    useEffect(() => { setPlan(null); setSel(null); load() }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { onPlan?.(plan ? { ...plan, selected: sel } : null) }, [plan, sel]) // eslint-disable-line react-hooks/exhaustive-deps
    const change = (patch) => { const n = { ...ctx, ...patch }; setCtx(n); onCtx?.(n) }

    return (
        <div className="plx-air" data-testid="air-route" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <AirInputs ctx={ctx} plan={plan} change={change} />
            {loading && <div className="plx-dim" data-testid="air-loading">Assessing the airspace along the way…</div>}
            {error && <div role="alert" style={{ color: "#ff8a8d" }}>{error}</div>}
            {plan && <AirOutput plan={plan} sel={sel} setSel={(k) => { setSel(k); selectAirCandidate(k) }} reload={load} loading={loading} />}
        </div>
    )
}

function AirInputs({ ctx, plan, change }) {
    if (ctx.icao) {
        const a = plan?.aircraft
        const alt = typeof a?.alt_baro === "number" ? (a.alt_baro >= 18000 ? `FL${Math.round(a.alt_baro / 100)}` : `${a.alt_baro.toLocaleString()} ft`) : null
        return (
            <div className="plx-route-inputs">
                <div className="plx-route-row"><span>Flight</span>
                    <b data-testid="air-flight">{a?.flight || ctx.icao.toUpperCase()}</b>
                    {a && <span className="plx-dim">{[alt, a.gs ? `${Math.round(a.gs)} kt` : null, a.type].filter(Boolean).join(" · ")}</span>}
                </div>
                {a && <div className="plx-dim" style={{ fontSize: 12.5 }}>
                    {a.destination_airport
                        ? <>From {a.departure?.city || a.departure?.name || "?"} to <b style={{ color: "#fff" }}>{a.destination_airport.city || a.destination_airport.name}</b> — {a.route_source}</>
                        : <>Destination unknown: its current heading is projected two hours ahead.</>}
                </div>}
                <button className="plx-link" style={{ alignSelf: "flex-start" }} onClick={() => change({ icao: null, from: a?.departure?.code || "", to: a?.destination_airport?.code || "" })}>
                    Plan between airports instead
                </button>
            </div>
        )
    }
    return (
        <div className="plx-route-inputs">
            <AirportField label="From" value={ctx.from} onPick={(code) => change({ from: code })} testid="air-from" />
            <AirportField label="To" value={ctx.to} onPick={(code) => change({ to: code })} testid="air-to" />
            {ctx.from && ctx.to && <button className="plx-link" style={{ alignSelf: "flex-start" }} onClick={() => change({ from: ctx.to, to: ctx.from })}>⇄ swap</button>}
        </div>
    )
}

function AirportField({ label, value, onPick, testid }) {
    const [q, setQ] = useState("")
    const [list, setList] = useState([])
    const [editing, setEditing] = useState(!value)
    useEffect(() => { setEditing(!value) }, [value])
    useEffect(() => {
        if (!editing || q.trim().length < 2) { setList([]); return undefined }
        let off = false
        const t = setTimeout(() => { searchAirports(q.trim()).then((l) => { if (!off) setList(l) }).catch(() => {}) }, 220)
        return () => { off = true; clearTimeout(t) }
    }, [q, editing])
    return (
        <div className="plx-route-row" style={{ position: "relative" }}>
            <span>{label}</span>
            {!editing
                ? <><b data-testid={testid}>{value}</b><button className="plx-link" onClick={() => { setQ(""); setEditing(true) }}>change</button></>
                : <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
                    <input className="plx-input" style={{ width: "100%" }} autoFocus={label === "From"} value={q} placeholder="Airport, city or code (FRA, OMDB)"
                           data-testid={`${testid}-input`} onChange={(e) => setQ(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter" && list[0]) { onPick(list[0].iata || list[0].icao); setEditing(false) } }} />
                    {list.length > 0 && (
                        <div role="listbox" style={{ position: "absolute", left: 0, right: 0, top: 34, zIndex: 5, background: "#141a24",
                                                     border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, maxHeight: 240, overflowY: "auto" }}>
                            {list.map((a) => (
                                <button key={`${a.icao}`} role="option" className="plx-cand" style={{ display: "block", width: "100%", border: 0, borderRadius: 0 }}
                                        onClick={() => { onPick(a.iata || a.icao); setEditing(false); setList([]) }}>
                                    <b>{a.iata || a.icao}</b> {a.name}
                                    <span className="plx-dim" style={{ display: "block", fontSize: 12 }}>{[a.city, a.country, a.icao].filter(Boolean).join(" · ")}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>}
        </div>
    )
}

function AirOutput({ plan, sel, setSel, reload, loading }) {
    const cands = plan.candidates || []
    const shown = cands.find((c) => c.key === sel) || cands[0]
    const touched = new Set(cands.flatMap((c) => (c.score?.crossings || []).map((x) => x.id)))
    const hazards = (plan.hazards || []).filter((h) => touched.has(h.id))
    const sources = sourceLines(plan)
    return (
        <div data-testid="air-output" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div data-testid="air-tradeoff" style={{ fontSize: 14, lineHeight: 1.5 }}>{plan.tradeoff}</div>
            {plan.inside_now?.length > 0 && <div className="plx-route-alert">Inside {plan.inside_now.join(", ")} now.</div>}
            {(plan.warnings || []).map((w) => <div key={w} className="plx-route-alert" style={{ cursor: "default" }}>{w}</div>)}
            <div className="plx-cands" data-testid="air-candidates">
                {cands.map((c) => {
                    const bar = exposureBar(c, cands)
                    return (
                        <button key={c.key} className="plx-cand" aria-pressed={shown?.key === c.key} onClick={() => setSel(c.key)} data-key={c.key}>
                            <span style={{ marginTop: 7, height: 5, borderRadius: 3, background: candidateColor(c) }} />
                            <span style={{ minWidth: 0 }}>
                                <b>{c.label}</b>{plan.recommended === c.key && cands.length > 1 ? <span style={{ color: "#3ddc84" }}> · recommended</span> : null}
                                <span className="plx-dim" style={{ display: "block" }}>
                                    {Math.round(c.score.distance_km).toLocaleString()} km · {fmtMinutes(c.score.minutes)}{c.key !== "direct" ? ` · ${fmtExtra(c.extra_minutes)}` : ""}
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                    <span style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                                        <span data-testid={`air-bar-${c.key}`} style={{ display: "block", height: "100%", width: `${bar}%`, background: RISK_COLOR[c.risk] || "#8fb4e8" }} />
                                    </span>
                                    <span style={{ fontSize: 12, color: RISK_COLOR[c.risk] || "#fff", whiteSpace: "nowrap" }}>{RISK_TEXT[c.risk] || c.risk}</span>
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
            {shown?.score?.crossings?.length > 0 && (
                <div>
                    <div className="plx-h">{shown.key === "direct" ? "The direct path crosses" : "This path crosses"}</div>
                    {shown.score.crossings.filter((x) => x.weighted_minutes >= 0.05).map((x) => (
                        <div key={x.id} style={{ padding: "3px 0", fontSize: 13 }}>
                            <span style={{ color: hazardColor(plan.hazards?.find((h) => h.id === x.id) || x) }}>■</span> {crossingLine(x)}
                        </div>
                    ))}
                </div>
            )}
            {hazards.length > 0 && (
                <div>
                    <div className="plx-h">The hazards, and why</div>
                    {hazards.slice(0, 12).map((h) => (
                        <div key={h.id} style={{ padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
                            <div><span style={{ color: hazardColor(h) }}>■</span> <b>{h.name}</b> <span className="plx-dim">· {h.kind_label}{h.level === "below_fl" && h.below_fl ? ` · below FL${h.below_fl}` : ""}</span></div>
                            {h.why && <div className="plx-dim" style={{ fontSize: 12.5 }}>{h.why}</div>}
                            {h.stats?.peak_degraded ? <div className="plx-dim" style={{ fontSize: 12 }}>Up to {h.stats.peak_degraded} of {h.stats.peak_aircraft} aircraft without a reliable fix at once (last 24 h).</div> : null}
                            {h.stats?.events ? <div className="plx-dim" style={{ fontSize: 12 }}>{h.stats.events} event{h.stats.events > 1 ? "s" : ""}{h.date ? `, latest ${String(h.date).slice(0, 10)}` : ""}.</div> : null}
                            {h.caveat && <div className="plx-dim" style={{ fontSize: 12, fontStyle: "italic" }}>Drawn approximately: {h.caveat}.</div>}
                        </div>
                    ))}
                </div>
            )}
            {sources.length > 0 && (
                <div data-testid="air-sources">
                    <div className="plx-h">Sources</div>
                    {sources.slice(0, 16).map((s) => (
                        <div key={s.key} style={{ fontSize: 12.5, padding: "2px 0" }}>
                            {s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#8fb4e8" }}>{s.text}</a> : s.text}
                            {s.dates ? <span className="plx-dim"> · {s.dates}</span> : null}
                            {s.note ? <span className="plx-dim"> · {s.note}</span> : null}
                        </div>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="plx-btn small" onClick={reload} disabled={loading}>{loading ? "…" : "Re-assess"}</button>
                <span className="plx-dim" style={{ fontSize: 11 }}>{plan.assumptions?.note}</span>
            </div>
        </div>
    )
}

// ── inside the shared route panel (registry.registerModeModule) ──────────

/** The shared panel's request → this mode's ctx: {icao} | {from, to} as codes. */
export function ctxFromRequest(request) {
    const code = (v) => (typeof v === "string" ? v : v?.code || v?.iata || v?.icao || null)
    if (request?.icao) return { icao: request.icao }
    return { from: code(request?.from), to: code(request?.to) }
}

export function AirRouteInPanel({ request, variant }) {
    const s = useAirRoute()
    useEffect(() => () => publishAirPlan(null), [])
    return (
        <>
            {variant === "phone" && <AirPhoneMap plan={s.plan} />}
            <AirRoute ctx={ctxFromRequest(request)} onPlan={publishAirPlan} />
        </>
    )
}

// ── the standalone sidebar / sheet ────────────────────────────────────────

export function AirRoutePanel({ variant = "desktop" }) {
    const s = useAirRoute()
    useEffect(() => { if (s.open) { try { closeRoutePanel() } catch { /* not mounted */ } } }, [s.open, s.seq])
    if (!s.open) return null
    const phone = variant === "phone"
    const p = s.plan
    const title = p?.aircraft ? (p.aircraft.flight || p.aircraft.hex || "").toUpperCase()
        : p ? `${p.origin?.code || p.origin?.name || "?"} → ${p.destination?.code || p.destination?.name || "?"}` : "Plan a flight"
    return (
        <div className={`plx-route-panel ${phone ? "phone" : "desktop"}`} data-testid="air-route-panel" role="dialog" aria-label="Flight route" style={phone ? undefined : { width: 420 }}>
            {phone && <AirPhoneMap plan={p} />}
            <div className="plx-route-head">
                <button className="plx-route-close" onClick={closeAirRoute} aria-label="Close">×</button>
                <div style={{ minWidth: 0 }}>
                    <div className="plx-route-eyebrow">Flight route · safest path</div>
                    <div className="plx-route-title">{title}</div>
                </div>
            </div>
            <div className="plx-route-body">
                <AirRoute key={s.seq} ctx={s.ctx} onPlan={publishAirPlan} />
            </div>
        </div>
    )
}

function AirPhoneMap({ plan }) {
    const el = useRef(null)
    const map = useRef(null)
    const group = useRef(null)
    const fitted = useRef(null)
    useEffect(() => {
        if (!el.current || map.current) return undefined
        map.current = L.map(el.current, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([30, 30], 3)
        el.current._m2air = map.current
        const off = addBaseTiles(L, map.current, "dark")
        group.current = L.layerGroup().addTo(map.current)
        setTimeout(() => map.current?.invalidateSize(), 60)
        return () => { off(); map.current?.remove(); map.current = null }
    }, [])
    useEffect(() => {
        if (!map.current || !group.current) return
        const b = drawAirPlan(L, group.current, plan, plan?.selected)
        const key = plan ? plan.generated_at : null
        if (b && b.isValid() && fitted.current !== key) {
            fitted.current = key
            map.current.fitBounds(b, { padding: [20, 20], maxZoom: 7 })
        }
    }, [plan])
    return <div ref={el} className="plx-route-map" />
}

// ── the inspector's offer ─────────────────────────────────────────────────

const _ctxCache = new Map()

export function AirRouteOffer({ recordRef }) {
    const hex = aircraftHex({ recordRef })
    const [ctx, setCtx] = useState(null)
    useEffect(() => {
        setCtx(null)
        if (!hex) return undefined
        const hit = _ctxCache.get(hex)
        if (hit && Date.now() - hit.at < 5 * 60_000) { setCtx(hit.v); return undefined }
        let off = false
        fetchAirContext({ icao: hex }).then((v) => { _ctxCache.set(hex, { at: Date.now(), v }); if (!off) setCtx(v) }).catch(() => {})
        return () => { off = true }
    }, [hex])
    if (!hex) return null
    const open = () => openAirRoute({ icao: hex })
    if (!ctx?.relevant) {
        return (
            <div style={{ margin: "8px 0" }}>
                <button className="plx-link" onClick={open} data-testid="air-offer-quiet" style={{ color: "#8fb4e8", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                    Flight route risk
                </button>
            </div>
        )
    }
    return (
        <div data-testid="air-offer" style={{ margin: "10px 0", padding: "10px 12px", borderRadius: 10, border: `1px solid ${RISK_COLOR[ctx.risk] || "#F5A524"}`,
                                              background: "rgba(245,165,36,.08)", fontFamily: "var(--mz-font-body, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)" }}>
            <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: RISK_COLOR[ctx.risk] || "#F5A524" }}>Route risk</div>
            <div style={{ fontSize: 13, margin: "4px 0 8px" }}>{ctx.reason}</div>
            <button onClick={open} data-testid="air-offer-open" style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)",
                                                                        background: "rgba(255,255,255,.06)", color: "inherit", cursor: "pointer", font: "inherit" }}>
                {ctx.label || "Check this flight's route"}
            </button>
        </div>
    )
}
