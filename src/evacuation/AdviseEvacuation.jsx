/**
 * AdviseEvacuation.jsx — "ADVISE EVACUATION" for a person (owner,
 * 2026-10-12: "press 'Advise for Evacuation' for a person; they get the
 * signal and automatically get the safest exit route, leading to our
 * predetermined safe houses").
 *
 * One press (and a confirm): the server plans from the person's live
 * position to the best safe house they may use — abroad by air, over a
 * border or by sea when it must — and sends it as an EVACUATE warning (red
 * takeover, alarm, "Open the evacuation route"). Then, here: whether they
 * have seen and acknowledged it, and their PROGRESS — on the route or off
 * it, the leg, the time left and the ETA — polled every 15 s.
 *
 * Shown for an asset linked to a person, to its owner or an admin (the
 * server refuses anyone else). Desktop asset page, the inspector, the phone
 * asset sheet.
 */
import { useEffect, useState } from "react"
import { adviseEvacuation, latestEvacuation } from "./api.js"
import { cancelWarning, warningStatus } from "../warnings/api.js"
import { chosenItinerary, itineraryHeadline, progressLine } from "./itinerary.js"
import { openRoutePanel } from "../routes/store.js"
import { getCurrentUser } from "../state/authStore.js"
import "./evacuation.css"

export const POLL_MS = 15_000
const isAdmin = () => { try { const u = getCurrentUser(); return !!u?.is_super_admin || String(u?.role || "").toLowerCase() === "admin" } catch { return false } }
export const canAdvise = (asset) => !!asset?.identifiers?.user_id && (!!asset.mine || isAdmin())

export default function AdviseEvacuation({ asset, variant = "desktop", onOpenRoute }) {
    const [state, setState] = useState(null)         // {warning, progress, route}
    const [step, setStep] = useState("idle")         // idle | confirm | sending
    const [mode, setMode] = useState("car")
    const [err, setErr] = useState(null)
    const [plan, setPlan] = useState(null)
    const id = asset?.id
    useEffect(() => {
        if (!id || !canAdvise(asset)) return undefined
        let live = true, t = null
        const poll = async () => {
            try { const d = await latestEvacuation(id); if (live) setState(d.warning ? d : null) } catch { /* next time */ }
            if (live) t = setTimeout(poll, POLL_MS)
        }
        poll()
        return () => { live = false; if (t) clearTimeout(t) }
    }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!canAdvise(asset)) return null
    const w = state?.warning
    const active = w && w.status !== "cancelled" && Date.now() - Date.parse(w.created_at) < 24 * 3600_000
    const send = async () => {
        setStep("sending"); setErr(null)
        try {
            const d = await adviseEvacuation({ asset_id: id, mode })
            setPlan(d.plan)
            setState({ warning: d.warning, progress: null, route: d.warning.route })
            setStep("idle")
        } catch (e) {
            // A CROSS-BORDER PLAN CAN OUTLAST THE APP'S 30 s FETCH LIMIT: the server goes on
            // and sends it; the poll below shows it here when it is sent
            if (!e.status) {
                setStep("idle")
                setErr("Still planning (a route abroad takes longer) — it shows here once sent.")
                const until = Date.now() + 120_000
                const look = async () => {
                    try { const d = await latestEvacuation(id); if (d.warning && Date.now() - Date.parse(d.warning.created_at) < 180_000) { setState(d); setErr(null); return } } catch { /* again */ }
                    if (Date.now() < until) setTimeout(look, 5000)
                }
                setTimeout(look, 5000)
            } else { setErr(e.message || "Could not send"); setStep("confirm") }
        }
    }
    const openRoute = () => {
        const pid = w?.route?.route_plan_id
        if (!pid) return
        onOpenRoute?.()
        openRoutePanel({ request: { from: { asset_id: id }, to: null, mode: "car", purpose: "evacuate" }, planId: pid, title: "Evacuation" })
    }
    const it = plan ? chosenItinerary(plan) : null
    return (
        <div className="plx-evac-panel" data-testid="advise-evacuation" style={variant === "phone" ? { borderRadius: 12 } : undefined}>
            {step === "idle" && !active && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button className="plx-evac-btn" onClick={() => setStep("confirm")} data-testid="advise-evacuation-btn">Advise evacuation</button>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>Sends the safest route to a safe house, with an alarm</span>
                </div>
            )}
            {(step === "confirm" || step === "sending") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <b>Send EVACUATE to {asset.name}?</b>
                    <span style={{ fontSize: 12.5, opacity: 0.85, lineHeight: 1.45 }}>
                        The safest route from their live position to the best safe house they may use is planned now — abroad by air or over a border if it must —
                        and sent to their phone. It takes their screen with an alarm until they acknowledge.
                    </span>
                    <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>Travelling
                        <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={step === "sending"}
                                style={{ font: "inherit", background: "transparent", color: "inherit", border: "1px solid rgba(255,255,255,.25)", borderRadius: 6, padding: "3px 6px" }}>
                            <option value="car">by car</option><option value="foot">on foot</option>
                        </select>
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="plx-evac-btn" onClick={send} disabled={step === "sending"} data-testid="advise-evacuation-send">
                            {step === "sending" ? "Planning the route…" : "Send evacuation"}
                        </button>
                        <button className="plx-evac-btn ghost" onClick={() => { setStep("idle"); setErr(null) }} disabled={step === "sending"}>Cancel</button>
                    </div>
                    {step === "sending" && <span style={{ fontSize: 12, opacity: 0.8 }}>Asking the routing services — a cross-border route can take half a minute.</span>}
                </div>
            )}
            {err && <div role="alert" style={{ color: "#ff8a8d", fontSize: 13 }}>{err}</div>}
            {active && step === "idle" && (
                <div data-testid="evacuation-status" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <b style={{ color: "#ff8a8d", letterSpacing: ".04em" }}>EVACUATION SENT</b>
                        <span style={{ fontSize: 12.5 }}>{w.route?.safe_house ? `to ${w.route.safe_house}` : ""} · {warningStatus(w)}</span>
                    </div>
                    {(it || w.route?.summary) && <span style={{ fontSize: 12.5, opacity: 0.9 }}>{it ? itineraryHeadline(it) : w.route.summary}</span>}
                    <span data-testid="evacuation-progress" style={{ fontSize: 13, fontWeight: 600, color: state?.progress?.off_route ? "#ff8a8d" : state?.progress?.arrived ? "#3ddc84" : "inherit" }}>
                        {state?.progress ? progressLine(state.progress) : "Following their position…"}
                    </span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {w.route?.route_plan_id && <button className="plx-evac-btn ghost" onClick={openRoute} data-testid="evacuation-open-route">Open the route</button>}
                        {!w.acked_at && <button className="plx-evac-btn ghost" onClick={async () => { try { await cancelWarning(w.id); setState(null) } catch (e) { setErr(e.message) } }}>Withdraw</button>}
                        <button className="plx-evac-btn ghost" onClick={() => setStep("confirm")}>Send again</button>
                    </div>
                </div>
            )}
        </div>
    )
}
