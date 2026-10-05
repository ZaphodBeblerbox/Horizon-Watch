/**
 * RiskRanking.jsx — Insight's "Risk ranking": countries by the risk index,
 * each with its reason, how much it rests on, and what is on the surface
 * there now. Clicking a row opens the country's explained risk on the map.
 * The logic is in riskRanking.js.
 */
import { Fragment, useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { rankCountries } from "./riskRanking.js"
import { places as loadPlaces } from "../voice/gazetteer.js"

const BAND = { 4: "var(--red)", 3: "var(--amber)", 2: "var(--steel, var(--txt3))", 1: "var(--txt4)" }
const EYEBROW = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)", overflow: "hidden" }
const COLS = "28px minmax(0,1fr) 150px 56px minmax(0,1.6fr) 70px"

let _names = null
function countryNames() {
    if (!_names) {
        const base = import.meta.env?.BASE_URL || "/"
        _names = fetch(`${base}data/world-countries.json`).then((r) => r.json()).then((d) => {
            const m = new Map()
            for (const f of d.features || []) { const p = f.properties || {}; if (p.a3 && p.a3 !== "-99") m.set(p.a3, p.n) }
            // Natural Earth files these as -99 (location_extract.py has the same list).
            for (const [a3, n] of [["FRA", "France"], ["NOR", "Norway"], ["XKX", "Kosovo"]]) if (!m.has(a3)) m.set(a3, n)
            return m
        }).catch(() => new Map())
    }
    return _names
}

export default function RiskRanking({ onOpenModule = () => {} }) {
    const [data, setData] = useState(null)
    const [names, setNames] = useState(new Map())
    const [surface, setSurface] = useState([])
    const [showAll, setShowAll] = useState(false)
    useEffect(() => {
        let live = true
        countryNames().then((m) => { if (live) setNames(m) })
        fetch(`${API_BASE}/api/risk-index/countries`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setData(d || { countries: [] }) })
            .catch(() => { if (live) setData({ countries: [] }) })
        fetch(`${API_BASE}/api/surface`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setSurface(Array.isArray(d?.items ?? d) ? (d.items ?? d) : []) })
            .catch(() => {})
        return () => { live = false }
    }, [])
    const rows = useMemo(() => rankCountries(data?.countries || [], names, surface), [data, names, surface])

    if (!data) return <div style={{ padding: 20 }}><Loading size={34} label="Loading the risk index" /></div>
    if (!rows.length) return <div style={{ ...CARD, padding: 18, color: "var(--txt3)" }}>The risk index has not been computed yet.</div>

    const top = rows.find((r) => !r.thin) || rows[0]
    const firstThin = rows.findIndex((r) => r.thin)
    const open = (r) => {
        onOpenModule("map")
        // The index carries no coordinates; the gazetteer has every country's
        // centre and a camera height for its size.
        loadPlaces().then((ps) => {
            const p = ps.find((x) => x.kind === "country" && x.name.toLowerCase() === r.name.toLowerCase())
            if (p) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude } }))
        }).catch(() => {})
        window.dispatchEvent(new CustomEvent("akili:open-inspector", {
            detail: { entityType: "country_risk", entityId: `risk-${r.iso3}`, data: { ...r.raw, iso3: r.iso3, name: r.name, country: r.name } },
        }))
    }
    const shown = showAll ? rows : rows.slice(0, 20)
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
            <div style={{ ...CARD, padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={EYEBROW}>Highest risk on solid evidence · {data.window_days || 30}-day window</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: "-.01em" }}>{top.name}</h3>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 28, color: BAND[top.band] || "var(--txt)" }}>{top.score.toFixed(1)}</span>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 12, color: "var(--txt3)" }}>band {top.band} of 4</span>
                </div>
                <span style={{ color: "var(--txt2)" }}>
                    Why: {top.why}{top.evidence != null ? `, from ${top.evidence} event${top.evidence === 1 ? "" : "s"}` : ""}.
                    {" "}{rows.filter((r) => !r.thin).length} countries ranked on enough evidence, {rows.length} scored.
                </span>
                <div><button onClick={() => open(top)} style={{
                    height: 28, padding: "0 12px", border: 0, background: "var(--acc)", color: "var(--mz-cream)",
                    font: "inherit", fontWeight: 600, cursor: "pointer",
                }}>Show {top.name} on the map</button></div>
            </div>

            <div style={CARD}>
                <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--gline)", ...EYEBROW, fontSize: 9 }}>
                    <span>#</span><span>Country</span><span>Risk</span><span>Band</span><span>Why</span><span title="Signals on the surface there now">Now</span>
                </div>
                {shown.map((r, i) => (
                    <Fragment key={r.iso3}>
                    {i === firstThin && (
                        <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid var(--gline)", ...EYEBROW, fontSize: 9.5 }}>
                            Too little evidence to rank · fewer than 10 events in the window — worth a look, not a finding
                        </div>
                    )}
                    <button onClick={() => open(r)} title={`Open ${r.name} on the map`} style={{
                        display: "grid", gridTemplateColumns: COLS, gap: 12, alignItems: "center", width: "100%",
                        padding: "9px 14px", border: 0, borderBottom: "1px solid var(--gline)", background: "transparent",
                        color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hov)" }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt4)" }}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <i style={{ flex: "none", height: 6, width: `${Math.max(4, r.score)}%`, maxWidth: 100, background: BAND[r.band] || "var(--txt4)" }} />
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11.5 }}>{r.score.toFixed(1)}</span>
                        </span>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: BAND[r.band] || "var(--txt3)" }}>{r.band}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.why}{r.thin ? ` · only ${r.evidence} event${r.evidence === 1 ? "" : "s"}` : ""}
                        </span>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: r.signals ? "var(--txt)" : "var(--txt4)" }}>{r.signals || "—"}</span>
                    </button>
                    </Fragment>
                ))}
                {rows.length > 20 && (
                    <button onClick={() => setShowAll((v) => !v)} style={{ width: "100%", padding: "9px 14px", border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", cursor: "pointer", textAlign: "left" }}>
                        {showAll ? "Show the top 20" : `Show all ${rows.length} countries`}
                    </button>
                )}
            </div>
        </div>
    )
}
