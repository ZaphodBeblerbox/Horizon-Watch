/**
 * WhatChanged.jsx — Insight's first tab: what is different from the window
 * before, by name and by number (backend insight_changes.py).
 *
 * The headline is three sentences assembled from the numbers. Below it,
 * the countries where the evidence of fighting rose, each with how much
 * and the events behind it; beside them, places that lit up, ground that
 * changed hands, countries that went quieter, and — kept apart, because
 * our instruments' reach changes as much as the world does — air and
 * electronic activity. The footnote says which kinds of evidence were
 * compared and which have no baseline yet.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { agoLabel } from "../utils/formatTime.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }
const EVENT_KINDS = new Set(["verified", "ground", "claims", "fusions", "heat"])
const SPAN = { "24h": "the 24 hours before", "7d": "the 7 days before", "30d": "the 30 days before" }

const flyTo = (lat, lon, altitude = 120_000) => {
    if (lat == null || lon == null) return
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } })), 300)
}

function Indicator({ i }) {
    const up = i.dir !== "down"
    const col = up ? (i.dir === "new" ? "#F5A524" : "#E5484D") : "#4CAF7A"
    const max = Math.max(i.cur, i.prev, 1)
    return (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, max-content) minmax(80px, 1fr) max-content", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "var(--txt2)" }}>{i.label}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <i style={{ height: 5, width: `${(i.cur / max) * 100}%`, background: col, display: "block", minWidth: 2 }} title={`now: ${i.cur}`} />
                <i style={{ height: 5, width: `${(i.prev / max) * 100}%`, background: "var(--txt4)", opacity: 0.6, display: "block", minWidth: 2 }} title={`before: ${i.prev}`} />
            </span>
            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11.5, color: col, whiteSpace: "nowrap" }}>
                {i.dir === "new" ? `${i.cur} · new` : `${i.cur} vs ${Math.round(i.prev)}${i.ratio ? ` · ${i.ratio}×` : ""}`}
            </span>
        </div>
    )
}

function CountryCard({ c }) {
    const first = c.examples?.find((e) => e.lat != null)
    return (
        <div style={CARD}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{c.country}</span>
                {c.driven_by?.length > 0 && <span style={{ fontSize: 12, color: "var(--txt3)" }}>mostly {c.driven_by.join(", ").toLowerCase()}</span>}
                {first && <button onClick={() => flyTo(first.lat, first.lon)} style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", fontSize: 12, cursor: "pointer" }}>map →</button>}
            </div>
            {c.indicators.map((i) => <Indicator key={i.key} i={i} />)}
            {c.examples?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--gline)", paddingTop: 10 }}>
                    {c.examples.map((e, k) => (
                        <button key={k} onClick={() => flyTo(e.lat, e.lon, 60_000)} disabled={e.lat == null} style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1fr) max-content", gap: 10, textAlign: "left", border: 0, background: "transparent",
                            color: "var(--txt)", font: "inherit", padding: 0, cursor: e.lat != null ? "pointer" : "default",
                        }}>
                            <span style={{ fontSize: 13, lineHeight: 1.45 }}>{e.title}</span>
                            <span style={{ fontSize: 11.5, color: "var(--txt3)", whiteSpace: "nowrap" }}>{e.when ? agoLabel(e.when) : ""}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function WhatChanged() {
    const [range, setRange] = useState("7d")
    const [d, setD] = useState(null)
    useEffect(() => {
        let live = true
        setD(null)
        fetch(`${API_BASE}/api/insight/changes?range=${range}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((x) => { if (live) setD(x) }).catch((e) => { if (live) setD({ error: String(e.message || e) }) })
        return () => { live = false }
    }, [range])
    const events = (d?.escalating || []).filter((c) => c.indicators.some((i) => EVENT_KINDS.has(i.key)))
    const instruments = (d?.escalating || []).filter((c) => !c.indicators.some((i) => EVENT_KINDS.has(i.key)))
    const notCompared = Object.entries(d?.coverage || {}).filter(([, v]) => !v.compared).map(([k]) => k)
    const LABEL = { verified: "verified events", ground: "reports from the ground", claims: "official claims", military: "military flights", jamming: "GPS jamming", heat: "new heat", fusions: "fusions" }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                <div>
                    <span style={EYE}>What changed · against {SPAN[range]}</span>
                    <h3 style={{ margin: "6px 0 0", fontWeight: 600, fontSize: 28, lineHeight: 1.1 }}>
                        {d?.headline ? "" : "Comparing the two windows…"}
                    </h3>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                    {[["24 h", "24h"], ["7 days", "7d"], ["30 days", "30d"]].map(([l, k]) => (
                        <button key={k} onClick={() => setRange(k)} style={{
                            height: 28, padding: "0 12px", border: 0, background: range === k ? "var(--accdim)" : "transparent",
                            color: range === k ? "var(--txt)" : "var(--txt3)", font: "inherit", cursor: "pointer",
                        }}>{l}</button>
                    ))}
                </div>
            </div>
            {!d && <Loading size={20} inline label="Comparing this window with the one before" />}
            {d?.error && <span style={{ color: "#FF6B6B" }}>Could not compare: {d.error}</span>}
            {d?.headline && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {d.headline.length === 0 && <p style={{ margin: 0, fontSize: 20, color: "var(--txt2)" }}>Nothing measurably different from {SPAN[range]}.</p>}
                    {d.headline.map((h, i) => (
                        <p key={i} style={{ margin: 0, fontSize: i === 0 ? 22 : 18, lineHeight: 1.35, color: i === 0 ? "var(--txt)" : "var(--txt2)", textWrap: "pretty", maxWidth: 1200 }}>{h}</p>
                    ))}
                </div>
            )}
            {d && !d.error && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(320px, 1fr)", gap: 20, alignItems: "start" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                        <span style={EYE}>Where the fighting picked up · {events.length}</span>
                        {events.length === 0 && <div style={{ ...CARD, color: "var(--txt3)" }}>No country shows measurably more evidence of fighting than in {SPAN[range]}.</div>}
                        {events.map((c) => <CountryCard key={c.country} c={c} />)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                        <div style={CARD}>
                            <span style={EYE}>Places that lit up · activity where there was none</span>
                            {(d.lit_up || []).length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>None.</span>}
                            {(d.lit_up || []).map((h, i) => (
                                <button key={i} onClick={() => flyTo(h.lat, h.lon, 80_000)} style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", border: 0, borderTop: i ? "1px solid var(--gline)" : 0, padding: "8px 0 0", background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer" }}>
                                    <span style={{ fontSize: 13.5 }}>{h.place} <span style={{ color: "var(--txt3)" }}>· {h.count} reports</span></span>
                                    <span style={{ fontSize: 12, color: "var(--txt3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.examples?.[0]?.title}</span>
                                </button>
                            ))}
                        </div>
                        <div style={CARD}>
                            <span style={EYE}>Front lines · ground that changed hands</span>
                            {(d.frontlines || []).length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>No recorded change of control.</span>}
                            {(d.frontlines || []).map((f, i) => (
                                <button key={i} onClick={() => flyTo(f.lat, f.lon, 150_000)} style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", border: 0, borderTop: i ? "1px solid var(--gline)" : 0, padding: "8px 0 0", background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer" }}>
                                    <span style={{ fontSize: 13.5 }}>{f.title}</span>
                                    {f.sub && <span style={{ fontSize: 12, color: "var(--txt3)" }}>{f.sub}</span>}
                                </button>
                            ))}
                        </div>
                        <div style={CARD}>
                            <span style={EYE}>Calmer than before</span>
                            {(d.calmer || []).length === 0 && <span style={{ fontSize: 13, color: "var(--txt3)" }}>None.</span>}
                            {(d.calmer || []).map((c) => (
                                <div key={c.country} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.country}</span>
                                    {c.indicators.map((i) => <Indicator key={i.key} i={i} />)}
                                </div>
                            ))}
                        </div>
                        {instruments.length > 0 && (
                            <div style={CARD}>
                                <span style={EYE}>Air and electronic activity · read with care</span>
                                <span style={{ fontSize: 12, color: "var(--txt3)", lineHeight: 1.45 }}>Compared by each country's share of the worldwide total; the detectors' reach changes too.</span>
                                {instruments.slice(0, 8).map((c) => (
                                    <div key={c.country} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{c.country}</span>
                                        {c.indicators.map((i) => <Indicator key={i.key} i={i} />)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
            {d?.coverage && (
                <span style={{ fontSize: 12, color: "var(--txt4)", lineHeight: 1.5 }}>
                    Counted per day of collection, so a gap in our feeds is not read as calm.
                    {notCompared.length > 0 && ` Not compared — no baseline yet in ${SPAN[range]}: ${notCompared.map((k) => LABEL[k]).join(", ")}.`}
                    {" "}Verified events lag by two days (GeoConfirmed publishes after the fact).
                </span>
            )}
        </div>
    )
}
