import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"

/**
 * CorroboratedPanel — places where more than one kind of source agrees.
 *
 * WHY THIS IS THE MOST IMPORTANT LIST IN THE APP. Every feed here is
 * individually inadequate, and in a different way: FIRMS is precise but
 * only ever says "hot"; GeoConfirmed is exact but overwhelmingly Ukraine;
 * GDELT is global but geocoded to a place named in an article; radar sees
 * through cloud but cannot say what changed. None is an answer. Two of them
 * on one coordinate within hours is a much better one, and it costs nothing
 * — these feeds have all been running for months without being compared.
 *
 * It shows the WORKING, not a score. "confidence 0.8" is not something a
 * person can act on; "a thermal hotspot and a geolocated report, 2.4 hours
 * apart" is, because they can judge it themselves.
 */
const REFRESH_MS = 2 * 60 * 1000

function ago(iso) {
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return ""
    const h = (Date.now() - t) / 3_600_000
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
    if (h < 48) return `${Math.round(h)}h ago`
    return `${Math.round(h / 24)}d ago`
}

export default function CorroboratedPanel({ hours = 168, onFocus = null }) {
    const [data, setData] = useState(null)
    const [err, setErr] = useState(null)

    useEffect(() => {
        let cancelled = false
        const load = () => {
            fetch(`${API_BASE}/api/corroborate?hours=${hours}&radius_km=10`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                .then((d) => { if (!cancelled) { setData(d); setErr(null) } })
                .catch((e) => { if (!cancelled) setErr(e.message) })
        }
        load()
        const h = setInterval(load, REFRESH_MS)
        return () => { cancelled = true; clearInterval(h) }
    }, [hours])

    if (err) {
        return <div style={{ padding: 10, font: "400 11px var(--mono)", color: "var(--sev-high)" }}>
            Corroboration unavailable: {err}
        </div>
    }
    if (!data) {
        return <div style={{ padding: 10, font: "400 11px var(--mono)", color: "var(--txt-4)" }}>
            reading every feed…
        </div>
    }

    const items = data.corroborated || []

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* The denominator, always. "3 findings" means nothing without
                how much was looked at to get them — and an empty list is a
                real answer, not a broken panel. */}
            <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)",
                          font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                {items.length} corroborated · {data.clusters_total} clusters from{" "}
                {data.observations_considered} observations ·{" "}
                {Object.entries(data.by_source || {})
                    .map(([k, v]) => `${k} ${v}`).join(" · ")}
            </div>

            {items.length === 0 ? (
                <div style={{ padding: 10, font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                    Nothing is corroborated in this window. That is a real
                    answer — most observations are seen by only one kind of
                    source.
                </div>
            ) : (
                <div style={{ overflowY: "auto", minHeight: 0 }}>
                    {items.map((c, i) => (
                        <div key={`${c.lat},${c.lon},${i}`}
                             role={onFocus ? "button" : undefined}
                             onClick={onFocus ? () => onFocus(c) : undefined}
                             style={{ padding: "7px 10px",
                                      borderBottom: "1px solid var(--line-soft)",
                                      cursor: onFocus ? "pointer" : "default" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                                {/* Independence, not a percentage. This is
                                    the number that decides whether to
                                    believe it. */}
                                <span style={{ font: "600 10px var(--mono)",
                                               color: c.independent_modalities >= 3
                                                   ? "var(--sev-critical)" : "var(--sev-high)" }}>
                                    {c.independent_modalities}×
                                </span>
                                <span style={{ flex: 1, font: "400 12px var(--font)",
                                               color: "var(--txt)" }}>
                                    {c.headline}
                                </span>
                            </div>
                            <div style={{ marginTop: 2, font: "400 10px var(--mono)",
                                          color: "var(--txt-4)" }}>
                                {c.lat.toFixed(4)}, {c.lon.toFixed(4)} · {ago(c.last_seen)}
                                {c.labels?.length ? ` · ${c.labels.slice(0, 3).join(", ")}` : ""}
                            </div>
                            {/* HOW UNUSUAL THIS IS, HERE. Three sources
                                agreeing means one thing in a district that
                                sees fifteen conflict events a month and
                                quite another in one that sees none — the
                                difference between a finding and a Tuesday. */}
                            {c.baseline ? (
                                <div style={{ marginTop: 2, font: "400 10px var(--mono)",
                                              color: c.baseline.events_per_month >= 1
                                                  ? "var(--txt-3)" : "var(--sev-high)" }}>
                                    normally {c.baseline.normally}
                                    {" "}({c.baseline.events_per_month}/mo within 50km,
                                    {" "}UCDP, lagged)
                                </div>
                            ) : null}
                            {c.urls?.length ? (
                                <a href={c.urls[0]} target="_blank" rel="noopener noreferrer"
                                   onClick={(e) => e.stopPropagation()}
                                   style={{ font: "400 10px var(--mono)", color: "var(--acc-hi)" }}>
                                    source
                                </a>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
