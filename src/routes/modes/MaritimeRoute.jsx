/**
 * MaritimeRoute.jsx — the SAFEST sea route (owner, 2026-10-12: "sea routes
 * that avoid Houthi strike ranges in the Red Sea, GPS-jamming areas and
 * piracy zones, including the Suez versus Cape of Good Hope choice, with the
 * added days weighed against the risk").
 *
 *   in   origin (the vessel, or a port) · destination (port search) · speed ·
 *        departure · passages to close · what a day at sea is worth
 *   out  the candidates (Suez, Cape …) with exposure bars, days and distance,
 *        the trade-off in one sentence, the zones and their sources; drawn on
 *        the globe (globe/GlobeSeaRouteLayer.jsx) and on the phone's own map.
 *
 * Exports:
 *   default MaritimeRoute      the panel body (the mode's Component, for RoutePanel)
 *   SeaRouteSidebar            standalone sidebar (desktop right panel / phone sheet), store-driven
 *   SeaRouteOffer              the vessel inspector's "Plan a safer sea route" card (asks /context)
 */
import { useEffect, useMemo, useRef, useState } from "react"
import {
    getSeaRoute, subscribeSeaRoute, closeSeaRoute, updateSeaRequest, publishSeaPlan, openSeaRoute,
    planSeaRoute, searchPorts, seaContext, canPlan, toBody, placeLabel, deltaText, exposureBar, fmtNm, fmtDays,
    zonesLine, hazardColor, hazardStats, hazardsUsed, sourceList, relevant, requestFromContext, PASSAGES, KIND_LABEL,
} from "./maritimeCore.js"
import "./maritime.css"

export function useSeaRoute() {
    const [s, setS] = useState(getSeaRoute())
    useEffect(() => subscribeSeaRoute(setS), [])
    return s
}

function usePlanSea(state) {
    const [plan, setPlan] = useState(null)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const req = state.request
    useEffect(() => {
        if (!state.open || !canPlan(req)) { setPlan(null); return undefined }
        let dead = false
        setLoading(true); setError(null)
        planSeaRoute(toBody(req))
            .then((p) => { if (!dead) { setPlan(p); setError(p.ok === false ? p.error : null) } })
            .catch((e) => { if (!dead) { setError(e.message || "Could not plan"); setPlan(null) } })
            .finally(() => { if (!dead) setLoading(false) })
        return () => { dead = true }
    }, [state.open, state.seq])                                      // eslint-disable-line react-hooks/exhaustive-deps
    return { plan, error, loading }
}

// ── the panel body ────────────────────────────────────────────────────────

export default function MaritimeRoute({ state: given }) {
    const live = useSeaRoute()
    const state = given || live
    const { plan, error, loading } = usePlanSea(state)
    const [sel, setSel] = useState(null)
    useEffect(() => { setSel(null) }, [plan])
    useEffect(() => { publishSeaPlan(plan ? { ...plan, selected: sel } : null) }, [plan, sel])
    useEffect(() => () => publishSeaPlan(null), [])
    const req = state.request || {}
    return (
        <div className="plx-sea" data-testid="sea-route">
            <SeaInputs req={req} />
            <SeaOutput plan={plan} error={error} loading={loading} sel={sel} setSel={setSel} req={req} />
        </div>
    )
}

function PortField({ label, value, onPick, allowVessel }) {
    const [q, setQ] = useState("")
    const [hits, setHits] = useState([])
    const [editing, setEditing] = useState(!value)
    useEffect(() => {
        if (!editing || q.trim().length < 2) { setHits([]); return undefined }
        const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
        if (m) { setHits([{ name: `Position ${(+m[1]).toFixed(2)}, ${(+m[2]).toFixed(2)}`, lat: +m[1], lon: +m[2], locode: "", country: "" }]); return undefined }
        const t = setTimeout(() => { searchPorts(q).then(setHits).catch(() => setHits([])) }, 200)
        return () => clearTimeout(t)
    }, [q, editing])
    return (
        <div className="plx-sea-row">
            <span className="plx-sea-lab">{label}</span>
            <span style={{ flex: 1, minWidth: 0, position: "relative" }}>
                {!editing && value
                    ? <><b>{placeLabel(value)}</b>{value.mmsi && allowVessel ? <span className="plx-dim"> · live position</span> : null}{" "}
                        <button className="plx-link" onClick={() => setEditing(true)}>change</button></>
                    : <>
                        <input className="plx-sea-input" autoFocus={!!value} placeholder="Port name, UN/LOCODE or lat, lon" value={q}
                               aria-label={`${label} port`} data-testid={`sea-${label.toLowerCase()}-input`} onChange={(e) => setQ(e.target.value)} />
                        {hits.length > 0 && (
                            <div className="plx-sea-hits" role="listbox">
                                {hits.map((p, i) => (
                                    <button key={`${p.locode}-${i}`} role="option" aria-selected="false" className="plx-sea-hit"
                                            onClick={() => { onPick({ lat: p.lat, lon: p.lon, name: p.locode ? `${p.name} (${p.locode})` : p.name }); setEditing(false); setQ(""); setHits([]) }}>
                                        <b>{p.name}</b> <span className="plx-dim">{[p.locode, p.country].filter(Boolean).join(" · ")}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {value && <button className="plx-link" onClick={() => { setEditing(false); setQ("") }}>cancel</button>}
                    </>}
            </span>
        </div>
    )
}

function SeaInputs({ req }) {
    const avoid = req.avoid || []
    return (
        <div className="plx-sea-inputs">
            <PortField label="From" value={req.origin} allowVessel onPick={(p) => updateSeaRequest({ origin: p })} />
            <PortField label="To" value={req.destination} onPick={(p) => updateSeaRequest({ destination: p })} />
            <div className="plx-sea-row">
                <span className="plx-sea-lab">Speed</span>
                <input className="plx-sea-input small" type="number" min="3" max="40" step="0.5" value={req.speed_kn ?? ""} placeholder="by type"
                       aria-label="Speed in knots" onChange={(e) => updateSeaRequest({ speed_kn: e.target.value })} /> <span className="plx-dim">kn</span>
                <span className="plx-sea-lab" style={{ marginLeft: 8 }}>Leave</span>
                <input className="plx-sea-input" type="date" value={(req.departure || "").slice(0, 10)} aria-label="Departure date"
                       onChange={(e) => updateSeaRequest({ departure: e.target.value || null })} />
            </div>
            <div className="plx-sea-chips" role="group" aria-label="Close passages">
                <span className="plx-dim" style={{ alignSelf: "center" }}>Close</span>
                {PASSAGES.map(([k, label]) => {
                    const on = avoid.includes(k)
                    return <button key={k} className="plx-sea-chip" aria-pressed={on} data-passage={k}
                                   onClick={() => updateSeaRequest({ avoid: on ? avoid.filter((x) => x !== k) : [...avoid, k] })}>{label}</button>
                })}
            </div>
            <div className="plx-sea-row">
                <span className="plx-sea-lab" title="How many risk-hours one extra day at sea is worth">Day worth</span>
                <input className="plx-sea-input small" type="number" min="0" max="50" step="0.5" value={req.day_value ?? ""} placeholder="4"
                       aria-label="Risk-hours one day at sea is worth" onChange={(e) => updateSeaRequest({ day_value: e.target.value })} />
                <span className="plx-dim">risk-hours per extra day</span>
            </div>
        </div>
    )
}

function SeaOutput({ plan, error, loading, sel, setSel, req }) {
    if (!canPlan(req)) return <div className="plx-dim">Choose where from and where to.</div>
    if (loading && !plan) return <div className="plx-dim" data-testid="sea-loading">Planning the sea routes…</div>
    if (error) return <div className="plx-sea-alert" role="alert">{error}</div>
    if (!plan?.candidates) return null
    const max = Math.max(...plan.candidates.map((c) => c.exposure.risk_hours), 1)
    const shownKey = sel || plan.recommended
    const shown = plan.candidates.find((c) => c.key === shownKey) || plan.candidates[0]
    return (
        <div className="plx-sea-out" data-testid="sea-output">
            <div className="plx-sea-tradeoff" data-testid="sea-tradeoff">{plan.tradeoff}</div>
            <div className="plx-sea-cands" data-testid="sea-candidates">
                {plan.candidates.map((c) => {
                    const bar = exposureBar(c, max)
                    return (
                        <button key={c.key} className="plx-sea-cand" aria-pressed={shown?.key === c.key} onClick={() => setSel(c.key)}
                                data-recommended={c.recommended ? "1" : "0"}>
                            <div className="plx-sea-cand-top">
                                <b>{c.label}</b>
                                {c.recommended && <span className="plx-sea-tag go">Recommended</span>}
                                {c.shortest && !c.recommended && <span className="plx-sea-tag">Shortest</span>}
                            </div>
                            <div className="plx-sea-cand-nums">{fmtDays(c.days)} · {fmtNm(c.distance_nm)} · {deltaText(c)} · ETA {c.eta.slice(0, 10)}</div>
                            <div className="plx-sea-bar" aria-label={bar.label} title={bar.label}><i style={{ width: `${bar.pct}%`, background: bar.color }} /></div>
                            <div className="plx-dim plx-sea-small">{bar.label} · {zonesLine(c)}</div>
                        </button>
                    )
                })}
            </div>
            {shown && (
                <div>
                    <div className="plx-sea-h">{shown.label}: passages</div>
                    <div className="plx-sea-small">{shown.passage_names.length ? shown.passage_names.join(" · ") : "Open sea"}</div>
                </div>
            )}
            <div>
                <div className="plx-sea-h">Hazards on these routes</div>
                {hazardsUsed(plan).map((h) => (
                        <div key={h.id} className="plx-sea-haz" data-kind={h.kind}>
                            <span style={{ color: hazardColor(h) }}>●</span> <b>{h.name}</b>
                            <span className="plx-dim"> · {KIND_LABEL[h.kind] || h.kind}{h.kind === "gnss" ? ` · ${h.cells} cells` : ` · weight ${h.weight.toFixed(2)}`}{h.live ? " (live)" : ""}</span>
                            {hazardStats(h) && <div className="plx-sea-small">{hazardStats(h)}</div>}
                            <div className="plx-dim plx-sea-small">{h.why}</div>
                        </div>
                    ))}
            </div>
            <div>
                <div className="plx-sea-h">Sources</div>
                <ul className="plx-sea-sources">
                    {sourceList(plan).map((s) => (
                        <li key={s.label}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}{s.date ? <span className="plx-dim"> · {s.date}</span> : null}</li>
                    ))}
                </ul>
                <div className="plx-dim plx-sea-small">{plan.method}</div>
            </div>
        </div>
    )
}

// ── standalone sidebar (desktop panel / phone sheet) ──────────────────────

export function SeaRouteSidebar({ variant = "desktop" }) {
    const s = useSeaRoute()
    if (!s.open) return null
    const phone = variant === "phone"
    const req = s.request || {}
    return (
        <div className={`plx-sea-panel ${phone ? "phone" : "desktop"}`} data-testid="sea-route-panel" role="dialog" aria-label="Safer sea route">
            {phone && <SeaPhoneMap />}
            <div className="plx-sea-head">
                <button className="plx-sea-close" onClick={closeSeaRoute} aria-label="Close">×</button>
                <div style={{ minWidth: 0 }}>
                    <div className="plx-sea-eyebrow">Shipping · safer sea route</div>
                    <div className="plx-sea-title">{placeLabel(req.origin)} → {placeLabel(req.destination)}</div>
                </div>
            </div>
            <div className="plx-sea-body"><MaritimeRoute state={s} /></div>
        </div>
    )
}

function SeaPhoneMap() {
    const el = useRef(null)
    const map = useRef(null)
    const group = useRef(null)
    const fitted = useRef(null)
    const s = useSeaRoute()
    const plan = s.plan
    useEffect(() => {
        let off = () => {}
        let cancelled = false
        Promise.all([import("leaflet"), import("../../mobile/tileSources.js"), import("leaflet/dist/leaflet.css")]).then(([Lm, tiles]) => {
            if (cancelled || !el.current || map.current) return
            const L = Lm.default || Lm
            map.current = L.map(el.current, { zoomControl: false, worldCopyJump: false }).setView([20, 40], 2)
            el.current._m2sea = map.current
            off = tiles.addBaseTiles(L, map.current, "dark")
            group.current = L.layerGroup().addTo(map.current)
            map.current._L = L
            setTimeout(() => map.current?.invalidateSize(), 60)
        })
        return () => { cancelled = true; off(); map.current?.remove(); map.current = null }
    }, [])
    useEffect(() => {
        let t = null
        const draw = () => {
            if (!map.current || !group.current) { t = setTimeout(draw, 150); return }
            import("./seaLeaflet.js").then(({ drawSeaPlan }) => {
                const b = drawSeaPlan(map.current._L, group.current, plan)
                const key = plan ? `${plan.origin?.lat},${plan.destination?.lat},${plan.recommended}` : null
                if (b && b.isValid() && fitted.current !== key) { fitted.current = key; map.current.fitBounds(b, { padding: [20, 20] }) }
            })
        }
        draw()
        return () => clearTimeout(t)
    }, [plan])
    return <div ref={el} className="plx-sea-map" data-testid="sea-phone-map" />
}

// ── the vessel inspector's offer ──────────────────────────────────────────

export function SeaRouteOffer({ mmsi }) {
    const [ctx, setCtx] = useState(null)
    useEffect(() => {
        if (!mmsi) return undefined
        let dead = false
        seaContext(mmsi).then((c) => { if (!dead) setCtx(c) }).catch(() => { if (!dead) setCtx(null) })
        return () => { dead = true }
    }, [mmsi])
    const rel = useMemo(() => relevant({ entityType: "vessel", mmsi, seaContext: ctx }), [mmsi, ctx])
    if (!rel) return null
    return (
        <div className="plx-sea-offer" data-testid="sea-route-offer">
            <div className="plx-sea-h" style={{ color: "#F5A524" }}>Sea route risk</div>
            <div className="plx-sea-small">{rel.why}</div>
            {rel.reasons.length > 1 && <div className="plx-dim plx-sea-small">{rel.reasons.slice(1, 3).join(" ")}</div>}
            <button className="plx-sea-btn go" onClick={() => openSeaRoute(requestFromContext({ mmsi, seaContext: ctx }))}>{rel.offer}</button>
        </div>
    )
}
