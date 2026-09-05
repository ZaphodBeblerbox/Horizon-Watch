import { useState, useEffect, useMemo, useRef } from "react"
import { scaleLinear, scaleTime } from "d3-scale"
import { area as d3area, curveMonotoneX } from "d3-shape"
import API_BASE from "../apiBase.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { replayOnMap } from "../services/replayOnMap.js"

// Dossiers — page-by-page rebuild, §8.4. Genuinely new module (no prior
// implementation existed — only a PlaceholderModule). Layout 238px/1fr/292px,
// both side panes real frosted glass reusing the exact .pane-glass/.panetab
// mechanism + entered/leftMin/rightMin state pattern already built in
// Situation.jsx — not a page-specific reimplementation.
//
// Trackable entities are real WatchZone + StrategicZone rows (backend/
// exposure_index.py) — the spec's own "reuse existing watch areas plus any
// other real trackable entity" — StrategicZone has by far the richer real
// linked-signal history today (thousands of real OntologyLink rows vs.
// WatchZone's single pilot AOI). The exposure score/delta/ring-signal set
// all come from one real backend computation shared by every tab, per §7.

const SEV_COLOR = { critical: "var(--sev-critical)", high: "var(--sev-high)", moderate: "var(--sev-moderate)", low: "var(--sev-low)" }
const TABS = ["Overview", "Exposure", "Risk drivers", "History", "Linked entities"]

function bandLabel(band) { return band.charAt(0).toUpperCase() + band.slice(1) }

function DeltaTriangle({ delta }) {
    if (delta > 0.05) return <span style={{ color: "var(--delta-worse)" }}>▲</span>
    if (delta < -0.05) return <span style={{ color: "var(--delta-better)" }}>▼</span>
    return <span style={{ color: "var(--txt-4)" }}>—</span>
}

function Gauge({ score, band, size = 96, thickness = 6 }) {
    const r = (size - thickness) / 2
    const c = 2 * Math.PI * r
    const frac = Math.max(0, Math.min(1, score / 100))
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={thickness} />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SEV_COLOR[band]} strokeWidth={thickness}
                strokeDasharray={`${c * frac} ${c}`} strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <text x={size / 2} y={size / 2} textAnchor="middle" dy="0.35em" style={{ font: "400 20px var(--mono)", fill: "var(--txt)" }}>
                {Math.round(score)}
            </text>
        </svg>
    )
}

function Sparkline({ history, width = 168, height = 42 }) {
    const points = history.map((p) => ({ date: new Date(p.date), score: p.score }))
    const x = scaleTime().domain([points[0].date, points[points.length - 1].date]).range([2, width - 2])
    const yMax = Math.max(1, ...points.map((p) => p.score))
    const y = scaleLinear().domain([0, yMax]).range([height - 4, 4])
    const areaGen = d3area().x((p) => x(p.date)).y0(height - 4).y1((p) => y(p.score)).curve(curveMonotoneX)
    const min = Math.min(...points.map((p) => p.score))
    const max = yMax
    const now = points[points.length - 1].score
    return (
        <div>
            <svg width={width} height={height}>
                <path d={areaGen(points)} fill="var(--chart-area-fill)" stroke="var(--chart-area-stroke)" strokeWidth={1.25} />
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", font: "400 9.5px var(--mono)", color: "var(--txt-4)", width }}>
                <span>min {min.toFixed(0)}</span><span>max {max.toFixed(0)}</span><span>now {now.toFixed(0)}</span>
            </div>
        </div>
    )
}

function OverviewTab({ profile }) {
    const stats = [
        { label: "Signals in ring", value: profile.signal_count },
        { label: "Critical signals", value: profile.critical_count },
        { label: "Index change (14d)", value: `${profile.delta > 0 ? "+" : ""}${profile.delta}` },
        { label: "Related entities", value: profile.linked_entities.length },
        { label: "Nearby signals (1400km)", value: profile.nearby_signals.length },
        { label: "Domains present", value: Object.keys(profile.domain_mix).length },
    ]
    const mixTotal = Object.values(profile.domain_mix).reduce((a, b) => a + b, 0) || 1
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="statgrid">
                {stats.map((s) => (
                    <div className="stat" key={s.label}>
                        <span className="value">{s.value}</span>
                        <span className="label">{s.label}</span>
                    </div>
                ))}
            </div>
            <div>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Signal mix by domain</div>
                {Object.entries(profile.domain_mix).map(([domain, count]) => (
                    <div key={domain} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ width: 70, font: "400 12px var(--font)", color: "var(--txt-2)", textTransform: "capitalize" }}>{domain}</span>
                        <div className="bar" style={{ flex: 1 }}><span style={{ width: `${(count / mixTotal) * 100}%` }} /></div>
                        <span style={{ width: 30, textAlign: "right", font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{count}</span>
                    </div>
                ))}
            </div>
            <div>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Analyst judgement</div>
                <p style={{ font: "400 12.5px/1.6 var(--font)", color: "var(--txt-2)", margin: 0 }}>{profile.analyst_judgement}</p>
            </div>
        </div>
    )
}

function ExposureTab({ profile }) {
    return (
        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
            No real dependency/asset-linkage data is modeled for {profile.entity_type === "watch_zone" ? "watch zones" : "strategic zones"} yet
            — the backend's Asset register exists but is empty, and no infrastructure-dependency model has been built.
            The exposure score above therefore uses the reduced formula (severity + persistence + corroboration only,
            renormalized) rather than substituting a placeholder dependency value.
        </div>
    )
}

function RiskDriversTab({ profile }) {
    const c = profile.components
    const domainEntries = Object.entries(profile.domain_mix).sort((a, b) => b[1] - a[1])
    const topDomain = domainEntries[0]
    const total = Object.values(profile.domain_mix).reduce((a, b) => a + b, 0) || 1
    const bars = [
        { label: "Severity weight", value: c.severity },
        { label: "Persistence (14d)", value: c.persistence },
        { label: "Corroboration", value: c.corroboration },
        { label: "Dependency weight", value: c.dependency == null ? 0 : c.dependency, note: c.dependency == null ? "no real data" : null },
        { label: topDomain ? `Largest domain — ${topDomain[0]}` : "Largest domain", value: topDomain ? topDomain[1] / total : 0 },
    ]
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bars.map((b) => (
                <div key={b.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", font: "400 12px var(--font)", color: "var(--txt-2)", marginBottom: 3 }}>
                        <span>{b.label}{b.note ? <span style={{ color: "var(--txt-4)" }}> ({b.note})</span> : null}</span>
                        <span style={{ fontFamily: "var(--mono)", color: "var(--txt-3)" }}>{Math.round(b.value * 100)}%</span>
                    </div>
                    <div className="bar"><span style={{ width: `${b.value * 100}%` }} /></div>
                </div>
            ))}
        </div>
    )
}

function HistoryTab({ profile }) {
    const points = profile.history.map((p) => ({ date: new Date(p.date), score: p.score }))
    const width = 420, height = 140, margin = { top: 8, right: 8, bottom: 18, left: 30 }
    const innerW = width - margin.left - margin.right, innerH = height - margin.top - margin.bottom
    const x = scaleTime().domain([points[0].date, points[points.length - 1].date]).range([0, innerW])
    const y = scaleLinear().domain([0, Math.max(1, ...points.map((p) => p.score))]).nice().range([innerH, 0])
    const areaGen = d3area().x((p) => x(p.date)).y0(innerH).y1((p) => y(p.score)).curve(curveMonotoneX)
    const recentSignals = profile.ring_signals.slice(0, 20)
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <svg width={width} height={height}>
                <g transform={`translate(${margin.left},${margin.top})`}>
                    {y.ticks(3).map((t) => (
                        <g key={t}>
                            <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                            <text x={-6} y={y(t)} dy="0.32em" textAnchor="end" style={{ font: "400 9.5px var(--mono)", fill: "var(--txt-4)" }}>{t}</text>
                        </g>
                    ))}
                    <path d={areaGen(points)} fill="var(--chart-area-fill)" stroke="var(--chart-area-stroke)" strokeWidth={1.25} />
                </g>
            </svg>
            <div>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Recent ring signals</div>
                {recentSignals.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No ring signals in this period.</div>
                ) : recentSignals.map((s) => (
                    <div className="evrow" key={s.id}>
                        <span className={`dia ${s.severity === "medium" ? "moderate" : s.severity === "info" ? "low" : s.severity}`} />
                        <div><div className="title">{s.title}</div><div className="meta"><span>{s.domain}</span></div></div>
                        {s.lat != null && s.lon != null && (
                            <button className="btn ghost sm" title="Replay on map" onClick={(e) => { e.stopPropagation(); replayOnMap({ lat: s.lat, lon: s.lon, publishedAt: s.created_at, title: s.title, severity: s.severity }) }} style={{ padding: 2 }}>
                                <svg className="icon sm"><use href="#i-clock" /></svg>
                            </button>
                        )}
                        <span className="time">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function LinkedEntitiesTab({ profile, onOpenEntity }) {
    if (profile.linked_entities.length === 0) {
        return <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>No real shared-evidence relationships found for this entity yet.</div>
    }
    return (
        <table className="grid" style={{ width: "100%" }}>
            <thead><tr><th>Entity</th><th>Type</th><th>Shared evidence</th><th /></tr></thead>
            <tbody>
                {profile.linked_entities.map((l) => (
                    <tr key={`${l.entity_type}-${l.entity_id}`}>
                        <td className="title"><div>{l.name}</div></td>
                        <td>{l.entity_type}</td>
                        <td style={{ fontFamily: "var(--mono)" }}>{l.shared_count}</td>
                        <td>
                            {(l.entity_type === "watch_zone" || l.entity_type === "strategic_zone") ? (
                                <button className="btn ghost sm" onClick={() => onOpenEntity(l.entity_type, l.entity_id)}>open →</button>
                            ) : <span style={{ color: "var(--txt-4)", font: "400 11px var(--font)" }}>no dossier for this type</span>}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

export default function Dossiers({ onOpenGenerate }) {
    const [entities, setEntities] = useState([])
    const [selected, setSelected] = useState(null) // {entity_type, code}
    const [profile, setProfile] = useState(null)
    const [tab, setTab] = useState("Overview")
    const [note, setNote] = useState("")
    const [noteDirty, setNoteDirty] = useState(false)
    const [entered, setEntered] = useState(false)
    const [leftMin, setLeftMin] = useState(false)
    const [rightMin, setRightMin] = useState(false)
    const noteRef = useRef(note); noteRef.current = note
    const dirtyRef = useRef(false)

    useEffect(() => {
        const t = setTimeout(() => setEntered(true), 20)
        return () => clearTimeout(t)
    }, [])

    useEffect(() => {
        fetch(`${API_BASE}/api/dossiers/entities`).then((r) => r.json()).then((rows) => {
            setEntities(rows)
            if (rows.length && !selected) setSelected({ entity_type: rows[0].entity_type, code: rows[0].code })
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!selected) return
        setProfile(null)
        fetch(`${API_BASE}/api/dossiers/${selected.entity_type}/${selected.code}`).then((r) => r.json()).then((p) => {
            setProfile(p); setNote(p.description || ""); setNoteDirty(false); dirtyRef.current = false
        })
    }, [selected])

    // Autosave the standing note — reuses the real WatchZone/StrategicZone
    // `description` field and its existing PUT endpoint, not a new one.
    useEffect(() => {
        if (!selected) return
        const iv = setInterval(async () => {
            if (!dirtyRef.current) return
            const path = selected.entity_type === "watch_zone" ? `/api/watch-zones/${selected.code}` : `/api/strategic-zones/${selected.code}`
            await fetch(`${API_BASE}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: noteRef.current }) })
            dirtyRef.current = false; setNoteDirty(false)
        }, 4000)
        return () => clearInterval(iv)
    }, [selected])

    function briefThisEntity() {
        if (!profile) return
        const rank = { critical: 0, high: 1, medium: 2, moderate: 2, info: 3, low: 3 }
        const top6 = [...profile.ring_signals].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)).slice(0, 6)
        top6.forEach((s) => addToBriefing(s.id, s.title))
        toast(`${top6.length} signals added to briefing basket`, { icon: "i-check" })
        onOpenGenerate?.()
    }

    function showOnMap() {
        if (!profile) return
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: profile.centroid.lat, lon: profile.centroid.lon, altitude: 400000 } }))
        }, 50)
    }

    async function toggleAlerting() {
        if (!profile) return
        const next = !profile.alerting_enabled
        setProfile((p) => ({ ...p, alerting_enabled: next }))
        await fetch(`${API_BASE}/api/dossiers/${selected.entity_type}/${selected.code}/alerting`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }),
        })
    }

    const leftStyle = {
        width: 238, flexShrink: 0, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(-14px)", opacity: entered ? 1 : 0,
    }
    const rightStyle = {
        width: 292, flexShrink: 0, borderLeft: "1px solid var(--line)", overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(14px)", opacity: entered ? 1 : 0,
    }

    return (
        <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            {leftMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setLeftMin(false)} title="Restore Watchlist">Watchlist</div>
            ) : (
                <div className="pane-glass" style={leftStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Watchlist</span>
                        <button onClick={() => setLeftMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0 }}>
                            <svg className="icon sm"><use href="#i-collapse-l" /></svg>
                        </button>
                    </div>
                    <div style={{ overflowY: "auto" }}>
                        {entities.map((e) => {
                            const active = selected && selected.entity_type === e.entity_type && selected.code === e.code
                            return (
                                <div key={`${e.entity_type}-${e.code}`} role="button"
                                    onClick={() => setSelected({ entity_type: e.entity_type, code: e.code })}
                                    style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: active ? "var(--bg-2)" : "transparent" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ font: "400 12px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                                        <DeltaTriangle delta={e.delta} />
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                                        <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{e.code} · {e.type_label}</span>
                                        <span style={{ font: "400 11px var(--mono)", color: SEV_COLOR[e.band] }}>{Math.round(e.score)}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 16 }}>
                {!profile ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Loading…</div>
                ) : (
                    <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                            <div>
                                <div style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{profile.code} · {selected.entity_type === "watch_zone" ? "Watch Zone" : "Strategic Zone"}</div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                                    <span style={{ font: "600 19px var(--font)", color: "var(--txt)" }}>{profile.name}</span>
                                    <span className="tag" style={{ color: profile.state === "Deteriorating" ? "var(--tag-red)" : profile.state === "Improving" ? "var(--tag-green)" : "var(--tag-blue)", borderColor: profile.state === "Deteriorating" ? "var(--tag-red-border)" : profile.state === "Improving" ? "var(--tag-green-border)" : "var(--tag-blue-border)" }}>
                                        {profile.state}
                                    </span>
                                </div>
                                <input className="input" style={{ marginTop: 8, width: 380 }} placeholder="Standing note…"
                                    value={note} onChange={(e) => { setNote(e.target.value); setNoteDirty(true); dirtyRef.current = true }} />
                            </div>
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <Gauge score={profile.score} band={profile.band} />
                                {profile.has_enough_history ? <Sparkline history={profile.history} /> : (
                                    <div style={{ width: 168, font: "400 11px var(--font)", color: "var(--txt-3)" }}>Insufficient history for a meaningful trend yet.</div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                            <button className="btn primary" onClick={briefThisEntity}>brief this entity</button>
                            <button className="btn" onClick={showOnMap}>show exposure on map</button>
                            <button className="btn" aria-pressed={profile.alerting_enabled} onClick={toggleAlerting}
                                style={{ background: profile.alerting_enabled ? "var(--bg-4)" : "var(--bg-3)" }}>
                                alerting {profile.alerting_enabled ? "on" : "off"}
                            </button>
                        </div>

                        <div className="seg" style={{ marginBottom: 14 }}>
                            {TABS.map((t) => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}
                        </div>

                        {tab === "Overview" && <OverviewTab profile={profile} />}
                        {tab === "Exposure" && <ExposureTab profile={profile} />}
                        {tab === "Risk drivers" && <RiskDriversTab profile={profile} />}
                        {tab === "History" && <HistoryTab profile={profile} />}
                        {tab === "Linked entities" && <LinkedEntitiesTab profile={profile} onOpenEntity={(et, id) => {
                            const match = entities.find((e) => e.entity_type === et && String(e.code) === String(id))
                            if (match) setSelected({ entity_type: et, code: match.code })
                        }} />}
                    </>
                )}
            </div>

            {rightMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setRightMin(false)} title="Restore Linked Signals">Linked Signals</div>
            ) : (
                <div className="pane-glass" style={rightStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Linked signals · 1,400km</span>
                        <button onClick={() => setRightMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0 }}>
                            <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                        </button>
                    </div>
                    <div style={{ overflowY: "auto", padding: "0 12px" }}>
                        {!profile ? null : profile.nearby_signals.length === 0 ? (
                            <div style={{ padding: "12px 0", font: "400 12px var(--font)", color: "var(--txt-3)" }}>No real signals within 1,400km yet.</div>
                        ) : profile.nearby_signals.map((s) => (
                            <div className="evrow" key={s.id}>
                                <span className={`dia ${s.severity === "medium" ? "moderate" : s.severity === "info" ? "low" : s.severity}`} />
                                <div><div className="title">{s.title}</div><div className="meta"><span>{s.domain} · {s.distance_km}km</span></div></div>
                                {s.lat != null && s.lon != null && (
                                    <button className="btn ghost sm" title="Replay on map" onClick={(e) => { e.stopPropagation(); replayOnMap({ lat: s.lat, lon: s.lon, publishedAt: s.created_at, title: s.title, severity: s.severity }) }} style={{ padding: 2 }}>
                                        <svg className="icon sm"><use href="#i-clock" /></svg>
                                    </button>
                                )}
                                <span className="time">{s.created_at ? new Date(s.created_at).toLocaleDateString() : ""}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
