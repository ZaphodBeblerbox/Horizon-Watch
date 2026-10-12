/**
 * RoutePanel.jsx — THE route planner, one sidebar for every kind of route
 * (owner, 2026-10-12: route planning "as a sidebar UI that appears in
 * certain situations"). Desktop: a panel on the right of the globe, like
 * the inspector (the route drawn by routeLayer.cesium.jsx). Phone: a
 * full-height sheet with its own map (routeLayer.leaflet.js), the phone
 * map's tiles and their fallback chain.
 *
 *   in   from · to (a place, or the nearest safe point) · mode (registry.js) ·
 *        depart time · which dangers to avoid (provider chips)
 *   out  the safest route and the fastest, each candidate with its exposure
 *        and why it differs; the steps; Re-check; Send to the person;
 *        Apple / Google Maps for turn-by-turn.
 *
 * Opened by store.openRoutePanel — from a notification, "Get me out", an
 * asset's "Safest route", or a context card (contexts.js).
 */
import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import PlacePicker from "../search/PlacePicker.jsx"
import { addBaseTiles } from "../mobile/tileSources.js"
import { closeRoutePanel, updateRequest, publishPlan } from "./store.js"
import { useRoutePanel, usePlan } from "./usePlan.js"
import { sendPlan } from "./api.js"
import { listModes, listProviders, defaultAvoid, getMode } from "./registry.js"
import { drawPlan } from "./routeLayer.leaflet.js"
import {
    viewState, STATE_TEXT, summary, exposureLabel, hazardLine, fromLabel, toLabel, toLocalInput, fromLocalInput,
} from "./view.js"
import "./routes.css"

export default function RoutePanel({ variant = "desktop" }) {
    const panel = useRoutePanel()
    if (!panel.open) return null
    return <Panel panel={panel} variant={variant} />
}

const STATE_COLOR = { ok: "#3ddc84", clear: "#3ddc84", unsafe: "#E5484D", rerouting: "#F5A524", no_safe_route: "#E5484D", error: "#E5484D", no_route: "#F5A524", loading: "#8fb4e8" }

function Panel({ panel, variant }) {
    // A MODE WITH ITS OWN PLANNER (maritime, air …, registry.registerModeModule): its component, not ours
    const Custom = getMode(panel.request?.mode)?.name === panel.request?.mode ? getMode(panel.request?.mode)?.Component : null
    const r = usePlan(Custom ? { ...panel, open: false } : panel)
    const [sel, setSel] = useState(null)
    useEffect(() => { setSel(null) }, [r.plan?.id, r.plan?.generated_at])
    useEffect(() => { publishPlan(r.plan ? { ...r.plan, selected: sel } : null) }, [r.plan, sel])
    const phone = variant === "phone"
    const title = panel.title || (panel.request?.purpose === "access" ? "Deliveries / access route" : panel.request?.to ? "Route" : "Safest way out")
    return (
        <div className={`plx-route-panel ${phone ? "phone" : "desktop"}`} data-testid="route-panel" role="dialog" aria-label={title}>
            {phone && <PhoneMap plan={r.plan} sel={sel} />}
            <div className="plx-route-head">
                <button className="plx-route-close" onClick={closeRoutePanel} aria-label="Close">×</button>
                <div style={{ minWidth: 0 }}>
                    <div className="plx-route-eyebrow">{title}</div>
                    <div className="plx-route-title">{fromLabel(panel.request, r.plan)} → {toLabel(panel.request, r.plan)}</div>
                </div>
            </div>
            <div className="plx-route-body">
                {Custom ? <>
                    <ModeChips mode={panel.request?.mode} />
                    <Custom panel={panel} request={panel.request} variant={variant} onClose={closeRoutePanel} />
                </> : <>
                    <Inputs panel={panel} plan={r.plan} />
                    <Output r={r} sel={sel} setSel={setSel} panel={panel} />
                </>}
            </div>
        </div>
    )
}

function Inputs({ panel, plan }) {
    const req = panel.request || {}
    const mode = req.mode || "foot"
    const avoid = req.avoid || defaultAvoid(mode)
    const [pickTo, setPickTo] = useState(false)
    return (
        <div className="plx-route-inputs">
            <div className="plx-route-row"><span>To</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                    {pickTo
                        ? <PlacePicker label="Destination" placeholder="Type a place or an address" onPick={(p) => { setPickTo(false); updateRequest({ to: { lat: p.lat, lon: p.lon, name: p.label || p.name } }) }} />
                        : <>
                            <b>{toLabel(req, plan)}</b>{" "}
                            <button className="plx-link" onClick={() => setPickTo(true)}>change</button>
                            {req.to && <> · <button className="plx-link" onClick={() => updateRequest({ to: null, purpose: "exit" })}>nearest safe point</button></>}
                        </>}
                </span>
            </div>
            <ModeChips mode={mode} />
            {getMode(mode)?.note && <div className="plx-dim">{getMode(mode).note}</div>}
            <div className="plx-route-row"><span>Leave</span>
                <input type="datetime-local" className="plx-input" value={toLocalInput(req.depart_at)} aria-label="Departure time"
                       onChange={(e) => updateRequest({ depart_at: fromLocalInput(e.target.value) })} />
                {req.depart_at && <button className="plx-link" onClick={() => updateRequest({ depart_at: null })}>now</button>}
            </div>
            <div className="plx-chips" role="group" aria-label="Avoid">
                <span className="plx-dim" style={{ alignSelf: "center" }}>Avoid</span>
                {listProviders().map((p) => {
                    const on = avoid.includes(p.name)
                    return <button key={p.name} className="plx-chip small" aria-pressed={on} title={p.hint} data-provider={p.name}
                                   onClick={() => updateRequest({ avoid: on ? avoid.filter((x) => x !== p.name) : [...avoid, p.name] })}>{p.label}</button>
                })}
            </div>
        </div>
    )
}

function ModeChips({ mode }) {
    return (
        <div className="plx-chips" role="group" aria-label="Mode">
            {listModes().map((m) => (
                <button key={m.name} className="plx-chip" aria-pressed={mode === m.name} data-mode={m.name}
                        onClick={() => updateRequest({ mode: m.name, avoid: null })}>{m.label}</button>
            ))}
        </div>
    )
}

function Output({ r, sel, setSel, panel }) {
    const { plan, error, loading, changed } = r
    const st = viewState({ loading, error, plan, check: plan?.check, rerouting: false })
    const [sent, setSent] = useState(null)
    const cands = plan?.candidates || []
    const shown = cands.find((c) => c.key === sel) || plan?.safest
    const subject = plan?.subject
    const send = async () => {
        setSent("Sending…")
        try { const x = await sendPlan(plan.id || r.planId, subject?.asset_id ? { asset_id: subject.asset_id } : {}); setSent(`Sent${x.leave_via ? ` — leave via ${x.leave_via}` : ""}.`) }
        catch (e) { setSent(e.message || "Could not send") }
    }
    return (
        <div data-testid="route-output" data-state={st} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {changed && <div role="alert" className="plx-route-alert" onClick={r.dismissChanged}>{changed}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 10, height: 10, borderRadius: 5, background: STATE_COLOR[st] || "#8fb4e8", flex: "none" }} />
                <b data-testid="route-state" style={{ flex: 1 }}>{st === "error" && error ? `${STATE_TEXT.error} ${error}` : STATE_TEXT[st]}</b>
                <button className="plx-btn small" onClick={() => r.recheck(true)} disabled={loading} data-testid="route-recheck">{loading ? "…" : "Re-check"}</button>
            </div>
            {plan?.explanation && <div data-testid="route-why">{plan.explanation}</div>}
            {cands.length > 0 && (
                <div className="plx-cands" data-testid="route-candidates">
                    {cands.map((c) => (
                        <button key={c.key} className="plx-cand" aria-pressed={(shown?.key) === c.key} onClick={() => setSel(c.key)} data-role={c.role}>
                            <span className={`plx-swatch ${c.role}`} />
                            <span style={{ minWidth: 0 }}>
                                <b>{c.role === "safest" ? "Safest" : c.role === "fastest" ? "Fastest" : "Alternative"}</b> · {summary(c)} · {exposureLabel(c.exposure)}
                                <span className="plx-dim" style={{ display: "block" }}>{c.why}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {plan?.links?.apple && <a className="plx-btn" href={plan.links.apple} target="_blank" rel="noreferrer">Open in Apple Maps</a>}
                {plan?.links?.google && <a className="plx-btn" href={plan.links.google} target="_blank" rel="noreferrer">Google Maps</a>}
                {subject?.can_send && <button className="plx-btn go" onClick={send} data-testid="route-send">Send to {subject.name || "them"}</button>}
            </div>
            {sent && <div className="plx-dim">{sent}</div>}
            {shown?.steps?.length > 0 && (
                <div>
                    <div className="plx-h">Step by step{shown.leave_via ? ` · leave via ${shown.leave_via}` : ""}</div>
                    <ol data-testid="route-steps" style={{ margin: 0, paddingLeft: 22 }}>
                        {shown.steps.filter((x) => x.text).map((x, i) => (
                            <li key={i} style={{ padding: "3px 0" }}>{x.text}{x.distance_m >= 10 ? <span className="plx-dim"> · {x.distance_m >= 1000 ? `${(x.distance_m / 1000).toFixed(1)} km` : `${Math.round(x.distance_m / 10) * 10} m`}</span> : null}</li>
                        ))}
                    </ol>
                </div>
            )}
            {plan?.hazards?.length > 0 && (
                <div>
                    <div className="plx-h">Dangers taken into account</div>
                    {plan.hazards.slice(0, 8).map((h) => (
                        <div key={h.id} style={{ padding: "4px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
                            <span style={{ color: "#ff8a8d" }}>●</span> {hazardLine(h)}{h.distance_m != null ? ` · ${h.distance_m >= 1000 ? `${(h.distance_m / 1000).toFixed(1)} km` : `${h.distance_m} m`} away` : ""}{h.hard ? " · never crossed" : ""}
                            <div className="plx-dim" style={{ fontSize: 12 }}>
                                {h.source?.url ? <a href={h.source.url} target="_blank" rel="noreferrer" style={{ color: "#8fb4e8" }}>{h.source.label}</a> : h.source?.label}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {plan?.attribution && <div className="plx-dim" style={{ fontSize: 11 }}>
                {plan.attribution} · <a href={plan.fix_the_map} target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,.6)" }}>fix the map</a>
            </div>}
            {panel.request?.purpose && <div className="plx-dim" style={{ fontSize: 11 }}>Plan {plan?.id || "…"}</div>}
        </div>
    )
}

function PhoneMap({ plan, sel }) {
    const el = useRef(null)
    const map = useRef(null)
    const group = useRef(null)
    const fitted = useRef(null)
    useEffect(() => {
        if (!el.current || map.current) return undefined
        map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([48.8566, 2.3522], 13)
        el.current._m2route = map.current             // reachable for browser checks
        const off = addBaseTiles(L, map.current, "dark")
        group.current = L.layerGroup().addTo(map.current)
        setTimeout(() => map.current?.invalidateSize(), 60)
        return () => { off(); map.current?.remove(); map.current = null }
    }, [])
    useEffect(() => {
        if (!map.current || !group.current) return
        const b = drawPlan(L, group.current, plan, sel)
        const key = plan ? `${plan.origin?.lat},${plan.origin?.lon},${plan.safest?.key || ""}` : null
        if (b && b.isValid() && fitted.current !== key) {
            fitted.current = key
            map.current.fitBounds(b, { padding: [24, 24], maxZoom: 17 })
        }
    }, [plan, sel])
    return <div ref={el} className="plx-route-map" />
}
