/**
 * EvacuationOutput.jsx — the route panel's body for an EVACUATION
 * (backend/evacuation.py): the 2–3 itineraries to a safe house (recommended,
 * fastest safe, lowest exposure), the chosen one's legs — each with its mode,
 * colour (the map draws the same) and its own steps — what is ASSUMED
 * (flights, border status), "Open in Apple / Google Maps" for the ground leg
 * to do now, and the safe houses left out, with why.
 */
import { useState } from "react"
import { chosenItinerary, currentGroundLeg, itineraryHeadline, legColor, legLine } from "./itinerary.js"
import { exposureLabel } from "../routes/view.js"
import "./evacuation.css"

const STATUS_TEXT = {
    ok: "Evacuation route ready.",
    shelter: "No safe way to a safe house now — shelter, then re-plan.",
    no_route: "No route could be planned now.",
}
const STATUS_COLOR = { ok: "#3ddc84", shelter: "#F5A524", no_route: "#E5484D" }

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`)

export default function EvacuationOutput({ r, sel, setSel }) {
    const { plan, loading } = r
    const it = chosenItinerary(plan, sel)
    const ground = currentGroundLeg(it)
    const [open, setOpen] = useState(0)            // the leg whose steps are shown
    const st = plan.check && plan.check.safe === false && !plan.rerouted ? "unsafe" : plan.status
    return (
        <div data-testid="evac-output" data-state={st} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {r.changed && <div role="alert" className="plx-route-alert" onClick={r.dismissChanged}>{r.changed}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 10, height: 10, borderRadius: 5, background: st === "unsafe" ? "#E5484D" : STATUS_COLOR[plan.status] || "#8fb4e8", flex: "none" }} />
                <b data-testid="route-state" style={{ flex: 1 }}>{st === "unsafe" ? "A new danger is on this route — re-plan." : STATUS_TEXT[plan.status] || plan.status}</b>
                <button className="plx-btn small" onClick={() => r.recheck(true)} disabled={loading} data-testid="route-recheck">{loading ? "…" : "Re-check"}</button>
            </div>
            {plan.explanation && <div data-testid="route-why">{plan.explanation}</div>}
            {(plan.itineraries || []).length > 1 && (
                <div className="plx-cands" data-testid="evac-itineraries">
                    {plan.itineraries.map((x) => (
                        <button key={x.key} className="plx-cand" aria-pressed={it?.key === x.key} data-kind={x.kind}
                                onClick={() => { setSel(x.key); setOpen(0) }}>
                            <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: "none", paddingTop: 3 }}>
                                {x.legs.map((l, i) => <i key={i} style={{ width: 14, height: 4, borderRadius: 2, background: legColor(l) }} />)}
                            </span>
                            <span style={{ minWidth: 0 }}>
                                <b>{itineraryHeadline(x)}</b> · {exposureLabel(x.exposure)}
                                <span className="plx-dim" style={{ display: "block" }}>{x.summary}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
            {it && (
                <div data-testid="evac-legs" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <div className="plx-h">{plan.itineraries.length > 1 ? "This way, leg by leg" : itineraryHeadline(it)} · {it.duration_label} door to door</div>
                    {it.legs.map((l, i) => (
                        <div key={i} data-leg={l.kind} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", gap: 10, padding: "6px 0" }}>
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <i style={{ width: 12, height: 12, borderRadius: 6, background: legColor(l), border: "2px solid rgba(255,255,255,.85)", flex: "none" }} />
                                {i < it.legs.length - 1 && <i style={{ width: 3, flex: 1, minHeight: 14, background: legColor(l), opacity: 0.6, borderRadius: 2 }} />}
                            </span>
                            <span style={{ minWidth: 0 }}>
                                <button className="plx-link" style={{ fontWeight: 650, textAlign: "left", color: "inherit", padding: 0 }}
                                        onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                                    {i + 1}. {legLine(l)}
                                </button>
                                {l.distance_m > 0 && <span className="plx-dim"> · {km(l.distance_m)}</span>}
                                {l.kind === "air" && l.risk && <span className="plx-dim"> · airspace {l.risk}</span>}
                                {open === i && (l.steps || []).length > 0 && (
                                    <ol data-testid="route-steps" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                                        {l.steps.filter((x) => x.text).slice(0, 40).map((x, k) => (
                                            <li key={k} style={{ padding: "2px 0" }}>{x.text}{x.distance_m >= 10 ? <span className="plx-dim"> · {km(x.distance_m)}</span> : null}</li>
                                        ))}
                                    </ol>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            {ground?.links && (ground.links.apple || ground.links.google) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {ground.links.apple && <a className="plx-btn" href={ground.links.apple} target="_blank" rel="noreferrer" data-testid="evac-apple">Open in Apple Maps</a>}
                    {ground.links.google && <a className="plx-btn" href={ground.links.google} target="_blank" rel="noreferrer">Google Maps</a>}
                    <span className="plx-dim" style={{ alignSelf: "center" }}>for: {ground.label}</span>
                </div>
            )}
            {it?.assumptions?.length > 0 && (
                <div data-testid="evac-assumptions">
                    <div className="plx-h">Assumed — check before you go</div>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {it.assumptions.map((a, i) => <li key={i} className="plx-dim" style={{ padding: "1px 0" }}>{a}</li>)}
                    </ul>
                </div>
            )}
            {it?.destination?.contact && <div><span className="plx-h">At the safe house</span> {it.destination.contact}</div>}
            {plan.excluded?.length > 0 && (
                <div className="plx-dim" style={{ fontSize: 12 }}>
                    Not considered: {plan.excluded.map((x) => `${x.name} (${x.reason})`).join(" · ")}
                </div>
            )}
            {plan.attribution && <div className="plx-dim" style={{ fontSize: 11 }}>{plan.attribution}</div>}
            <div className="plx-dim" style={{ fontSize: 11 }}>Plan {plan.id || "…"}</div>
        </div>
    )
}
