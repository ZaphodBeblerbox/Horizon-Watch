/**
 * TradeRouteSection.jsx — what a trade route is, and how it is doing.
 *
 * For each chokepoint the route passes: a reference photograph and its
 * traffic against its own normal (ChokepointFlowSection). Above that, the
 * route's live status from /api/flows/status — vessels on it now, incidents
 * near it, and why it is disrupted when it is.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import SectionLabel from "../inspector/SectionLabel.jsx"
import ChokepointFlowSection from "./ChokepointFlowSection.jsx"

export const CHOKEPOINT_NAME = {
    hormuz: "Strait of Hormuz", suez: "Suez Canal", bab_el_mandeb: "Bab el-Mandeb",
    malacca: "Strait of Malacca", mozambique_channel: "Mozambique Channel",
    cape_of_good_hope: "Cape of Good Hope", gibraltar: "Strait of Gibraltar",
    bosphorus: "Turkish Straits / Bosphorus", panama: "Panama Canal", danish_straits: "Danish Straits",
}

function ChokepointCard({ name }) {
    const [img, setImg] = useState(null)
    useEffect(() => {
        let live = true
        fetch(`${API_BASE}/api/reference-image?kind=chokepoint&name=${encodeURIComponent(name)}`)
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d?.available) setImg(d) }).catch(() => {})
        return () => { live = false }
    }, [name])
    return (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border-dim)" }}>
            <div style={{ font: "600 12.5px var(--font)", color: "var(--txt)", marginBottom: 6 }}>{name}</div>
            {img?.thumbnail_url && (
                <img src={img.thumbnail_url} alt={name} loading="lazy"
                     style={{ width: "100%", maxHeight: 150, objectFit: "cover", display: "block", marginBottom: 6 }} />
            )}
            <ChokepointFlowSection name={name} />
        </div>
    )
}

export default function TradeRouteSection({ routeId, chokepoints = [] }) {
    const [st, setSt] = useState(null)
    useEffect(() => {
        let live = true
        fetch(`${API_BASE}/api/flows/status`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live) setSt((d?.routes || []).find((r) => r.id === routeId) || null) })
            .catch(() => {})
        return () => { live = false }
    }, [routeId])
    const names = chokepoints.map((c) => CHOKEPOINT_NAME[c] || c)
    return (
        <>
            {st && (
                <div style={{ marginBottom: "var(--space-4)" }}>
                    <SectionLabel meta={st.disrupted ? "disrupted" : null}>Right now</SectionLabel>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.6 }}>
                        {st.traffic?.baseline != null
                            ? `${st.traffic.vessels} vessels in the corridor, against ${st.traffic.baseline} usually.`
                            : `${st.traffic?.vessels ?? 0} vessels seen in the corridor; ${st.traffic?.note || "no baseline yet"}`}
                        {" "}{st.incidents?.count ? `${st.incidents.count} incident${st.incidents.count === 1 ? "" : "s"} within ${st.corridor_km || 75} km of the route.` : "No incidents near the route."}
                        {st.why?.length ? <div style={{ color: "var(--amber)" }}>Disrupted: {st.why.join("; ")}</div> : null}
                    </div>
                </div>
            )}
            {names.length > 0 && (
                <div style={{ marginBottom: "var(--space-4)" }}>
                    <SectionLabel meta={names.length}>Chokepoints on this route</SectionLabel>
                    {names.map((n) => <ChokepointCard key={n} name={n} />)}
                </div>
            )}
        </>
    )
}
