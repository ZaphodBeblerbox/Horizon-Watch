/**
 * MaritimeAreaSection.jsx — what is in this water right now.
 *
 * Clicking an EEZ boundary used to return the names of the two countries
 * whose claim it separates; clicking a chokepoint returned a paragraph of
 * strategic description. Both are reference facts you read once. Neither
 * answers what someone clicking a piece of sea is actually asking: what is
 * in there, whose is it, and is any of it sanctioned.
 *
 * The inspector's adapters are synchronous and must not make the panel wait
 * on the network, so this is a component rather than adapter output: the
 * panel renders immediately and this section fills in underneath.
 *
 * CONGESTION IS SHOWN ONLY WHEN IT HAS A BASELINE. The server returns null
 * until it has watched an area long enough, and this renders that as the
 * sentence it is rather than as "1.0x", because "normal" and "we have not
 * watched long enough to know" are different answers and only one of them
 * is a measurement.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"

function Row({ label, value, mono = false }) {
    if (value === null || value === undefined || value === "") return null
    return (
        <div style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "baseline" }}>
            <span style={{ flex: "0 0 40%", font: "400 11px var(--font)", color: "var(--txt-4)" }}>{label}</span>
            <span style={{
                flex: 1, minWidth: 0,
                font: `400 11.5px ${mono ? "var(--mono)" : "var(--font)"}`,
                color: "var(--txt)", wordBreak: "break-word",
            }}>{value}</span>
        </div>
    )
}

export default function MaritimeAreaSection({ kind, id, bounds = null }) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!kind) return
        let cancelled = false
        const ctrl = new AbortController()
        setData(null); setError(null)

        const q = new URLSearchParams({ kind })
        if (id) q.set("id", id)
        if (bounds) {
            q.set("south", bounds.south); q.set("north", bounds.north)
            q.set("west", bounds.west);   q.set("east", bounds.east)
        }
        fetch(`${API_BASE}/api/maritime-area?${q}`, { signal: ctrl.signal, credentials: "include" })
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(d => { if (!cancelled) setData(d) })
            .catch(e => { if (!cancelled && e.name !== "AbortError") setError(e.message) })
        return () => { cancelled = true; ctrl.abort() }
    }, [kind, id, bounds?.south, bounds?.north, bounds?.west, bounds?.east])

    if (error) {
        return <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>
            Live traffic unavailable ({error}).
        </div>
    }
    if (!data) return <Loading size={18} inline label="Reading live traffic" />

    const c = data.congestion
    const sanctioned = data.sanctioned || []

    return (
        <div>
            <Row label="Vessels present" value={
                data.vessels_present > 0
                    ? `${data.vessels_present} (${data.under_way} under way, ${data.holding_station} holding station)`
                    // Zero is a real answer and has to read as one. This
                    // system's AIS coverage is a set of regional boxes, so an
                    // area outside them is genuinely unobserved, not empty.
                    : "none in the live feed — this area may be outside AIS coverage"
            } />
            {data.vessels_without_position > 0 && (
                <Row label="Not placeable"
                     value={`${data.vessels_without_position} hulls heard but without a position`} />
            )}
            <Row label="Congestion" value={
                c ? `${c.ratio}× this area's normal (${c.baseline_vessels} avg over ${c.samples} samples, ${c.window_hours}h)`
                  : data.congestion_note
            } />

            {data.flags?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: 4 }}>
                        Flags present
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {data.flags.map(f => (
                            <span key={f.iso2} title={`${f.name} — ${f.count} vessel${f.count === 1 ? "" : "s"}`}
                                  style={{
                                      display: "inline-flex", alignItems: "center", gap: 4,
                                      padding: "2px 6px", borderRadius: 3,
                                      background: "var(--bg-3)", font: "400 11px var(--font)",
                                      color: "var(--txt-2)",
                                  }}>
                                {f.image
                                    ? <img src={f.image} alt="" width={16} height={11}
                                           style={{ display: "block", objectFit: "cover" }} />
                                    : <span aria-hidden="true">{f.emoji}</span>}
                                <span>{f.iso2}</span>
                                <span style={{ color: "var(--txt-4)", fontFamily: "var(--mono)" }}>{f.count}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ marginTop: 10 }}>
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: 4 }}>
                    Sanctioned vessels
                </div>
                {!data.sanctions_checked ? (
                    <div style={{ font: "400 11px var(--font)", color: "var(--amber)" }}>
                        Could not be checked{data.sanctions_error ? ` (${data.sanctions_error})` : ""} — absence here is not evidence of absence.
                    </div>
                ) : sanctioned.length === 0 ? (
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>
                        None among the {data.vessels_present} hulls currently placed here.
                    </div>
                ) : sanctioned.map(v => (
                    <div key={v.mmsi} style={{
                        display: "flex", alignItems: "baseline", gap: 6, padding: "3px 0",
                        font: "400 11.5px var(--font)", color: "var(--txt)",
                    }}>
                        <span aria-hidden="true">{v.flag_emoji || "⚑"}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            {v.name || "unidentified hull"}
                            <span style={{ color: "var(--txt-4)", fontFamily: "var(--mono)" }}> · {v.mmsi}</span>
                            {v.programme ? <span style={{ color: "var(--txt-4)" }}> · {v.programme}</span> : null}
                        </span>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 10, font: "400 10px var(--font)", color: "var(--txt-4)", lineHeight: 1.5 }}>
                {data.method} Read at {data.as_of}.
            </div>
        </div>
    )
}
