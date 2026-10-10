/**
 * Analytics.jsx — charts of everything the console records, in one place.
 *
 * One row of filters on top (window, country, kind of alert); every chart
 * below answers to it. Headline numbers with their trend; alerts per day by
 * severity (click a day for its most serious alerts, click one to see it on
 * the map); what kinds and which countries (click either to filter the whole
 * page); ships and aircraft seen per day (two charts: different scales,
 * never one dual axis); fusions; Telegram reports by what happened and the
 * busiest channels; each war's reports per day; and the forecast record.
 * Backend: analytics_dashboard.py via /api/analytics/dashboard and /day.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Columns, { BarList } from "../charts/Columns.jsx"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }
const CHIP = (on) => ({
    height: 28, padding: "0 12px", border: `1px solid ${on ? "var(--acchi)" : "var(--gline2)"}`, background: on ? "var(--accdim)" : "transparent",
    color: on ? "var(--txt)" : "var(--txt2)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
})
// Severity is a status, so it wears the console's status colours.
const SEVERITY = [
    { key: "low", label: "Low", color: "#9AA9BC" },
    { key: "moderate", label: "Moderate", color: "#8FB4E8" },
    { key: "high", label: "High", color: "#F5A524" },
    { key: "critical", label: "Critical", color: "#E5484D" },
]
// Telegram, by what happened. Categorical, in the validated order
// (validate_palette.js, dark and light: all checks pass).
const TG_GROUPS = [
    { key: "violence", label: "Strikes, attacks, clashes", color: "#d95926", of: ["strike", "attack", "clash"] },
    { key: "movement", label: "Movements", color: "#3987e5", of: ["movement"] },
    { key: "unrest", label: "Unrest", color: "#24a89c", of: ["unrest"] },
    { key: "other", label: "Other", color: "#b26fd6", of: ["other"] },
]
const BAND_COLOR = Object.fromEntries(SEVERITY.map((s) => [s.key, s.color]))

const flyTo = (c, altitude) => {
    const lat = c.lat ?? c[0], lon = c.lon ?? c[1]
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } })), 300)
}
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })
const fmt = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0))

function Spark({ values }) {
    if (!values || values.length < 2) return null
    const max = values.reduce((m, v) => Math.max(m, v), 1)
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - (v / max) * 20}`).join(" ")
    return (
        <svg viewBox="0 0 100 24" width="100%" height="24" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
            <polyline points={pts} fill="none" stroke="var(--acc-hi, var(--acchi))" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
    )
}

function Kpi({ k, active, onClick }) {
    const up = k.delta != null && k.delta > 0
    return (
        <button onClick={onClick} aria-pressed={active} data-testid={`kpi-${k.key}`}
                style={{ ...CARD, gap: 6, textAlign: "left", cursor: onClick ? "pointer" : "default", font: "inherit",
                         borderColor: active ? "var(--acchi)" : "var(--gline)" }}>
            <span style={EYE}>{k.label}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ font: "600 26px/1 var(--font)", color: "var(--txt)" }}>{fmt(k.value)}</b>
                {k.delta != null && (
                    <span style={{ font: "400 11.5px var(--mono)", color: "var(--txt3)" }}>
                        {up ? "▲" : k.delta < 0 ? "▼" : "■"} {Math.abs(k.delta)}% vs the period before
                    </span>
                )}
            </span>
            <Spark values={k.spark} />
        </button>
    )
}

function Card({ title, sub, children, style }) {
    return (
        <section style={{ ...CARD, ...style }}>
            <header>
                <h3 style={{ margin: 0, font: "600 14px var(--font)", color: "var(--txt)" }}>{title}</h3>
                {sub && <div style={{ font: "400 11.5px var(--font)", color: "var(--txt3)", marginTop: 2 }}>{sub}</div>}
            </header>
            {children}
        </section>
    )
}

function DayDetail({ date, country, kind, onClose }) {
    const [rows, setRows] = useState(null)
    useEffect(() => {
        setRows(null)
        const q = new URLSearchParams({ date, country: country || "", kind: kind || "" })
        fetch(`${API_BASE}/api/analytics/day?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : { alerts: [] })).then((d) => setRows(d.alerts || [])).catch(() => setRows([]))
    }, [date, country, kind])
    const show = (a) => { if (a.lat != null && a.lon != null) flyTo({ lat: a.lat, lon: a.lon }, 400_000) }
    return (
        <div data-testid="analytics-day" style={{ borderTop: "1px solid var(--gline)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ font: "600 12.5px var(--font)", color: "var(--txt)" }}>Most serious on {day(date)}</span>
                <button onClick={onClose} aria-label="Close the day" style={{ ...CHIP(false), height: 24, padding: "0 8px" }}>✕</button>
            </div>
            {rows == null ? <div style={{ fontSize: 12, color: "var(--txt4)" }}>Loading…</div>
                : !rows.length ? <div style={{ fontSize: 12, color: "var(--txt4)" }}>No alerts recorded that day.</div>
                : rows.map((a) => (
                    <button key={a.id} onClick={() => show(a)} disabled={a.lat == null}
                            title={a.lat != null ? "See it on the map" : undefined}
                            style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto", gap: 8, alignItems: "baseline", width: "100%",
                                     padding: "5px 0", border: 0, borderBottom: "1px solid var(--gline)", background: "none", textAlign: "left",
                                     cursor: a.lat != null ? "pointer" : "default", font: "inherit" }}>
                        <i style={{ width: 8, height: 8, borderRadius: 2, background: BAND_COLOR[a.band] || BAND_COLOR.moderate }} />
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12.5, color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title || a.kind}</span>
                            <span style={{ fontSize: 11, color: "var(--txt3)" }}>{[a.kind, a.country].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span style={{ font: "400 11px var(--mono)", color: "var(--txt4)" }}>{String(a.at || "").slice(11, 16)}</span>
                    </button>
                ))}
        </div>
    )
}

export default function Analytics() {
    const [days, setDays] = useState(30)
    const [country, setCountry] = useState(null)       // { key, label }
    const [kind, setKind] = useState(null)             // { key, label }
    const [data, setData] = useState(null)
    const [err, setErr] = useState(null)
    const [picked, setPicked] = useState(null)         // a date

    useEffect(() => {
        let live = true
        setErr(null)
        const q = new URLSearchParams({ days: String(days), country: country?.key || "", kind: kind?.key || "" })
        fetch(`${API_BASE}/api/analytics/dashboard?${q}`, { credentials: "include" })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
            .then((d) => { if (live) setData(d) })
            .catch((e) => { if (live) setErr(e.message) })
        return () => { live = false }
    }, [days, country, kind])
    useEffect(() => { setPicked(null) }, [days, country, kind])

    const alertCols = useMemo(() => (data?.alerts_per_day || []).map((r) => ({
        key: r.date, label: day(r.date),
        value: SEVERITY.reduce((s, p) => s + (r[p.key] || 0), 0),
        parts: SEVERITY.map((p) => ({ key: p.key, value: r[p.key] || 0 })),
    })), [data])
    const single = (rows, field) => (rows || []).map((r) => ({ key: r.date, label: day(r.date), value: r[field] || 0 }))
    const tgCols = useMemo(() => (data?.telegram_per_day || []).map((r) => {
        const parts = TG_GROUPS.map((g) => ({ key: g.key, value: g.of.reduce((s, t) => s + (r[t] || 0), 0) }))
        return { key: r.date, label: day(r.date), value: parts.reduce((s, p) => s + p.value, 0), parts }
    }), [data])

    const f = data?.forecasts
    return (
        <div data-testid="analytics-page" style={{ flex: 1, minWidth: 0, overflow: "auto", padding: "22px 26px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
            <header style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                <div>
                    <div style={EYE}>Analytics</div>
                    <h1 style={{ margin: "4px 0 0", font: "600 24px var(--font)", color: "var(--txt)" }}>
                        {kind ? kind.label : "Everything recorded"}{country ? ` · ${country.label}` : ""}
                    </h1>
                    {data && <div style={{ fontSize: 12, color: "var(--txt3)", marginTop: 3 }}>{day(data.span[0])} – {day(data.span[1])} · click any bar to look closer</div>}
                </div>
                {/* ONE ROW OF FILTERS; every chart below answers to it */}
                <div role="toolbar" aria-label="Filters" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[7, 30, 90].map((d) => <button key={d} style={CHIP(days === d)} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}
                    {country && <button style={CHIP(true)} onClick={() => setCountry(null)} data-testid="filter-country">{country.label} ✕</button>}
                    {kind && <button style={CHIP(true)} onClick={() => setKind(null)} data-testid="filter-kind">{kind.label} ✕</button>}
                </div>
            </header>

            {err && !data && <div style={{ ...CARD, color: "var(--txt2)", fontSize: 13 }}>Could not load the figures ({err}). They are counted every five minutes; try again shortly.</div>}
            {!data && !err && <div style={{ fontSize: 13, color: "var(--txt4)" }}>Counting…</div>}

            {data && (<>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                    {data.kpis.map((k) => <Kpi key={k.key} k={k} />)}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 12 }}>
                    <Card title="Alerts per day" sub="By severity. Click a day for its most serious alerts." style={{ gridColumn: "1 / -1" }}>
                        <Columns data={alertCols} parts={SEVERITY} height={150} selected={picked} onSelect={setPicked}
                                 label="Alerts per day by severity" tip={(d) => d.label} />
                        {picked && <DayDetail date={picked} country={country?.key} kind={kind?.key} onClose={() => setPicked(null)} />}
                    </Card>

                    <Card title="What kind" sub="Click one to filter the whole page.">
                        <BarList rows={data.kinds} selected={kind?.key ?? null}
                                 onSelect={(k) => setKind(k ? data.kinds.find((x) => x.key === k) : null)} />
                    </Card>
                    <Card title="Where" sub="Countries with the most alerts. Click one to filter.">
                        <BarList rows={data.countries} selected={country?.key ?? null}
                                 onSelect={(c) => setCountry(c ? data.countries.find((x) => x.key === c) : null)} />
                    </Card>

                    <Card title="Ships seen per day" sub="Distinct AIS positions recorded, worldwide.">
                        <Columns data={single(data.activity, "ais")} height={90} label="Ships per day" />
                    </Card>
                    <Card title="Aircraft seen per day" sub="Distinct ADS-B positions recorded, worldwide.">
                        <Columns data={single(data.activity, "adsb")} height={90} label="Aircraft per day" />
                    </Card>

                    <Card title="Fusions per day" sub="Separate sources agreeing on the same place and time.">
                        <Columns data={single(data.fusions_per_day, "n")} height={90} label="Fusions per day" />
                    </Card>
                    <Card title="Telegram reports per day" sub="By what happened. Point at a day for its mix.">
                        <Columns data={tgCols} parts={TG_GROUPS} height={90} label="Telegram reports per day" />
                    </Card>

                    <Card title="Busiest Telegram channels" sub={country ? `Reporting on ${country.label}` : "In this window"}>
                        <BarList rows={data.channels} />
                    </Card>
                    {f && !f.made && (
                        <Card title="The forecast record" sub="What we said would happen, and how it turned out.">
                            <div style={{ fontSize: 12.5, color: "var(--txt3)" }}>No forecasts recorded yet. Each one Insight makes appears here, and how it turned out once its date passes.</div>
                        </Card>
                    )}
                    {f?.made > 0 && (
                        <Card title="The forecast record" sub="What we said would happen, and how it turned out.">
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 10 }}>
                                {[["Made", f.made], ["Still open", f.open], ["Happened", f.happened], ["Did not", f.did_not]].map(([l, v]) => (
                                    <div key={l}><div style={EYE}>{l}</div><b style={{ font: "600 22px var(--font)", color: "var(--txt)" }}>{v}</b></div>
                                ))}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--txt3)" }}>
                                {f.resolved ? `${Math.round((100 * f.happened) / f.resolved)}% of resolved forecasts happened.` : "None resolved yet."}
                            </div>
                        </Card>
                    )}

                    {data.wars?.length > 0 && (
                        <Card title="The wars, reports per day" sub="Each on its own scale. Click a war to go to it on the map." style={{ gridColumn: "1 / -1" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                                {data.wars.map((w) => (
                                    <div key={w.id} data-testid="analytics-war">
                                        <button onClick={() => w.center && flyTo(w.center, 1_800_000)}
                                                style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "600 12.5px var(--font)", color: "var(--txt)", textAlign: "left" }}>
                                            {w.name}
                                        </button>
                                        <div style={{ font: "400 11px var(--font)", color: "var(--txt3)", marginBottom: 4 }}>{w.n} reports{w.trend ? ` · ${w.trend}` : ""}</div>
                                        <Columns data={w.days.map((x) => ({ key: x.date, label: day(x.date), value: x.n }))} height={44} label={`${w.name} reports per day`} />
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>
            </>)}
        </div>
    )
}
