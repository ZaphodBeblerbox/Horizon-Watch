/**
 * VesselHistorySection.jsx — where this ship has been, and what it did there.
 *
 * GET /api/vessels/{mmsi}/history (backend/vessel_history.py): 90 days of
 * Global Fishing Watch events. Warnings lead — went dark (as GFW judges it),
 * met ships at sea, changed name or flag — then the port calls, meetings and
 * dark periods themselves. Any row with a position flies the map there.
 * The data is days behind real time, and the section says by how much.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import SectionLabel from "../inspector/SectionLabel.jsx"
import { fmtWhen } from "../utils/formatTime.js"

const fly = (r) => {
    if (r?.lat == null || r?.lon == null) return
    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: +r.lat, lon: +r.lon, altitude: 60_000 } }))
}
const dur = (h) => (h == null ? "" : h >= 48 ? `${Math.round(h / 24)} d` : `${Math.round(h)} h`)

function Row({ main, sub, onClick }) {
    return (
        <div onClick={onClick} style={{
            padding: "5px 0", borderBottom: "1px solid var(--border-dim)", cursor: onClick ? "pointer" : "default",
        }}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{main}</div>
            {sub && <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4, var(--text-dim))" }}>{sub}</div>}
        </div>
    )
}

export default function VesselHistorySection({ mmsi }) {
    const [h, setH] = useState(undefined)
    const [all, setAll] = useState(false)
    useEffect(() => {
        setH(undefined); setAll(false)
        if (!mmsi) return undefined
        let live = true
        fetch(`${API_BASE}/api/vessels/${encodeURIComponent(mmsi)}/history`)
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setH(d) })
            .catch(() => { if (live) setH(null) })
        return () => { live = false }
    }, [mmsi])

    if (h === undefined) {
        return (
            <div style={{ marginBottom: "var(--space-4)" }}>
                <SectionLabel>Last 90 days</SectionLabel>
                <Loading size={18} inline label="Asking Global Fishing Watch" />
            </div>
        )
    }
    if (!h || !h.available) {
        return (
            <div style={{ marginBottom: "var(--space-4)" }}>
                <SectionLabel>Last 90 days</SectionLabel>
                <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>{h?.reason || "No history available."}</div>
            </div>
        )
    }
    const ports = all ? h.port_calls : h.port_calls.slice(0, 5)
    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <SectionLabel meta={h.lag_days != null ? `GFW, ${h.lag_days} days behind` : "GFW"}>Last 90 days</SectionLabel>
            {h.warnings.map((w) => (
                <div key={w} role="note" style={{
                    margin: "0 0 6px", padding: "6px 9px", border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)", borderRadius: 6,
                    background: "var(--accdim)", font: "500 12px var(--font)", color: "var(--txt)",
                }}>{w}</div>
            ))}
            <div style={{ fontSize: "var(--text-sm)", color: "var(--txt-2, var(--text-primary))", margin: "2px 0 8px" }}>{h.summary}</div>

            {h.port_calls.length > 0 && (
                <>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", margin: "8px 0 2px" }}>Port calls</div>
                    {ports.map((p) => (
                        <Row key={p.start + p.port} main={`${p.port}${p.country_code ? ` · ${p.country_code}` : ""}`}
                             sub={`${fmtWhen(p.start, { precision: "day" })}${p.hours != null ? ` · ${dur(p.hours)} in port` : ""}`}
                             onClick={() => fly(p)} />
                    ))}
                    {h.port_calls.length > 5 && (
                        <button onClick={() => setAll((v) => !v)} style={{ border: 0, background: "none", padding: "5px 0", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit", fontSize: 11.5 }}>
                            {all ? "Fewer" : `All ${h.port_calls.length} port calls`}
                        </button>
                    )}
                </>
            )}
            {h.encounters.length > 0 && (
                <>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", margin: "8px 0 2px" }}>Met at sea</div>
                    {h.encounters.slice(0, 5).map((m) => (
                        <Row key={m.start} main={`${m.with.name || "Unnamed vessel"}${m.with.flag ? ` · ${m.with.flag}` : ""}${m.with.type ? ` · ${m.with.type}` : ""}`}
                             sub={`${fmtWhen(m.start, { precision: "minute" })}${m.hours != null ? ` · ${dur(m.hours)}` : ""}${m.gfw_potential_risk ? " · GFW: potential risk" : ""}`}
                             onClick={() => fly(m)} />
                    ))}
                </>
            )}
            {h.dark_periods.length > 0 && (
                <>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", margin: "8px 0 2px" }}>Dark periods</div>
                    {h.dark_periods.slice(0, 5).map((d) => (
                        <Row key={d.start} main={`${dur(d.hours)} silent${d.km != null ? `, moved ${Math.round(d.km)} km` : ""}`}
                             sub={`${fmtWhen(d.start, { precision: "minute" })} · ${d.gfw_intentional ? "GFW: likely switched off" : "likely reception gap"}`}
                             onClick={() => fly(d)} />
                    ))}
                </>
            )}
            {h.loitering.length > 0 && (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginTop: 6 }}>
                    Held station in open water {h.loitering.length} time{h.loitering.length > 1 ? "s" : ""}, last {fmtWhen(h.loitering[0].start, { precision: "day" })}.
                </div>
            )}
            {h.identities.length > 1 && (
                <>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", margin: "8px 0 2px" }}>Names and flags broadcast</div>
                    {h.identities.map((i) => (
                        <Row key={`${i.name}${i.flag}`} main={`${i.name || "—"} · ${i.flag || "—"}`} sub={[i.from, i.to].filter(Boolean).join(" → ")} />
                    ))}
                </>
            )}
        </div>
    )
}
