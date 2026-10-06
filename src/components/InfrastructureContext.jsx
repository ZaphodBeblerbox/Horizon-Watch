/**
 * InfrastructureContext.jsx — what a piece of infrastructure is, and what is
 * happening at it now.
 *
 * Cable: TeleGeography's record (owners, length, in service since, every
 * landing point and the countries it connects) — GET /api/infrastructure/cables/{id}.
 * Airport / port: aircraft and vessels at it right now and relevant signals
 * near it in the last 24 h — GET /api/infrastructure/around.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import SectionLabel from "../inspector/SectionLabel.jsx"
import { whenLabel } from "../utils/formatTime.js"

const T = { fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.6 }
const DIM = { font: "400 11px var(--font)", color: "var(--txt-4, var(--text-dim))" }

function useJson(url) {
    const [d, setD] = useState(undefined)
    useEffect(() => {
        setD(undefined)
        if (!url) return undefined
        let live = true
        fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.json() : null))
            .then((x) => { if (live) setD(x) }).catch(() => { if (live) setD(null) })
        return () => { live = false }
    }, [url])
    return d
}

export function CableSection({ id }) {
    const d = useJson(id ? `${API_BASE}/api/infrastructure/cables/${encodeURIComponent(id)}` : null)
    const [all, setAll] = useState(false)
    if (d === undefined) return <div style={{ marginBottom: "var(--space-4)", ...DIM }}>Loading the cable record…</div>
    if (!d) return <div style={{ marginBottom: "var(--space-4)", ...DIM }}>No public record for this cable.</div>
    const lps = all ? d.landing_points : d.landing_points.slice(0, 6)
    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <SectionLabel meta="TeleGeography">The cable</SectionLabel>
            <div style={T}>
                {[d.length, d.rfs_year ? (d.is_planned ? `planned for ${d.rfs_year}` : `in service since ${d.rfs_year}`) : null,
                  `${d.landing_points.length} landing points in ${d.countries.length} ${d.countries.length === 1 ? "country" : "countries"}`].filter(Boolean).join(" · ")}
            </div>
            {d.owners.length > 0 && <div style={{ ...T, marginTop: 4 }}><span style={DIM}>Owners </span>{d.owners.join(", ")}</div>}
            {d.suppliers && <div style={T}><span style={DIM}>Built by </span>{d.suppliers}</div>}
            <div style={{ ...T, marginTop: 4 }}><span style={DIM}>Connects </span>{d.countries.join(", ")}</div>
            <div style={{ marginTop: 6 }}>
                {lps.map((lp) => <div key={lp.name} style={{ ...DIM, padding: "2px 0" }}>{lp.name}</div>)}
                {d.landing_points.length > 6 && (
                    <button onClick={() => setAll((v) => !v)} style={{ border: 0, background: "none", padding: "3px 0", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit", fontSize: 11.5 }}>
                        {all ? "Fewer" : `All ${d.landing_points.length} landing points`}
                    </button>
                )}
            </div>
            {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ ...DIM, color: "var(--acc-hi, var(--acchi))" }}>Project site ↗</a>}
        </div>
    )
}

export function AroundSection({ lat, lon, kind }) {
    const ok = Number.isFinite(lat) && Number.isFinite(lon)
    const d = useJson(ok ? `${API_BASE}/api/infrastructure/around?lat=${lat}&lon=${lon}&kind=${kind}` : null)
    if (!ok || d === undefined || !d) return null
    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <SectionLabel>Right now around it</SectionLabel>
            <div style={T}>
                {kind === "airport"
                    ? `${d.aircraft_now} aircraft within ${d.radius_km.aircraft} km${d.military_aircraft_now ? `, ${d.military_aircraft_now} military` : ""}.`
                    : `${d.vessels_now} vessels within ${d.radius_km.vessels} km.`}
                {kind === "airport" && d.airlines_now.length > 0 && <div style={DIM}>{d.airlines_now.join(", ")}</div>}
            </div>
            <div style={{ marginTop: 6 }}>
                {d.signals_24h.length === 0
                    ? <div style={DIM}>No relevant signals within {d.radius_km.signals} km in the last 24 hours.</div>
                    : d.signals_24h.map((s, i) => (
                        <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--border-dim)" }}>
                            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{s.headline}</div>
                            <div style={DIM}>{s.km} km away · {whenLabel(s.published_at)}{s.severity ? ` · ${s.severity}` : ""}</div>
                        </div>
                    ))}
            </div>
        </div>
    )
}
