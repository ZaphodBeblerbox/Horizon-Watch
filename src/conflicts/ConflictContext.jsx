/**
 * ConflictContext.jsx — the wars behind what is on screen, folded until
 * asked for.
 *
 * One line per conflict ("Sudan civil war · SAF vs RSF · since 2023 ·
 * escalating"); open it for who fights, why, what is at stake, and where it
 * stands now — the last from this system's own reports, each sentence with
 * the reports it rests on (backend/conflict_context.py). Folded by default
 * so the context is there when wanted, not in the way; what was opened
 * stays open on this device.
 *
 *   <ConflictContext near="camera" />          the conflicts around the map's view
 *   <ConflictContext countries={["sd"]} names={["Sudan"]} />   one item's country
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import SectionLabel from "../inspector/SectionLabel.jsx"
import { fmtWhen } from "../utils/formatTime.js"

let cache = null, loading = null, loadedAt = 0
async function loadConflicts() {
    if (cache && Date.now() - loadedAt < 30 * 60_000) return cache
    if (!loading) {
        loading = fetch(`${API_BASE}/api/conflicts`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.conflicts) { cache = d.conflicts; loadedAt = Date.now() } return cache || [] })
            .catch(() => cache || [])
            .finally(() => { loading = null })
    }
    return loading
}

const OPEN_KEY = "plx-conflict-open"
const readOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")) } catch { return new Set() } }
const writeOpen = (s) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])) } catch { /* private mode */ } }

function km(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h))
}

/** The conflicts a camera looks at, nearest first (same reach as a theater). */
export function conflictsNear(list, cam) {
    if (!cam || !Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) return []
    const reach = Math.max(350, (Number(cam.height) || 2_000_000) / 1000 * 0.9)
    return (list || [])
        .map((c) => ({ c, d: Array.isArray(c.center) ? km([cam.lat, cam.lon], c.center) : Infinity }))
        .filter(({ c, d }) => d <= reach + (c.radius_km || 300))
        .sort((a, b) => a.d - b.d)
        .map(({ c }) => c)
}

/** The conflicts in a country, by ISO code or by name. */
export function conflictsIn(list, codes = [], names = []) {
    const cs = new Set(codes.filter(Boolean).map((x) => String(x).toLowerCase()))
    const ns = new Set(names.filter(Boolean).map((x) => String(x).toLowerCase()))
    return (list || []).filter((c) => (c.countries || []).some((x) => cs.has(x)) || (c.country_names || []).some((x) => ns.has(x)))
}

function useCamera(active) {
    const [cam, setCam] = useState(() => (typeof window !== "undefined" ? window.__akiliCamera : null))
    useEffect(() => {
        if (!active) return undefined
        const t = setInterval(() => {
            const v = window.__akiliCamera
            setCam((p) => (v && (!p || Math.abs(p.lat - v.lat) > 0.5 || Math.abs(p.lon - v.lon) > 0.5
                || Math.abs((p.height || 0) - (v.height || 0)) > (p.height || 1) * 0.2) ? { ...v } : p))
        }, 1500)
        return () => clearInterval(t)
    }, [active])
    return cam
}

const TREND = { escalating: "var(--red)", "de-escalating": "var(--green, #4b8b5a)", steady: "var(--txt-3)", unclear: "var(--txt-4)" }
const T = { body: { font: "400 12px/1.55 var(--font)", color: "var(--txt-2)" }, sub: { font: "600 10px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--txt-3)", margin: "12px 0 5px" } }

function Sources({ sources }) {
    const [open, setOpen] = useState(false)
    if (!sources?.length) return null
    return (
        <>
            <button onClick={() => setOpen(!open)} title={sources.map((s) => s.headline).join("\n")}
                    style={{ border: 0, background: "none", padding: 0, marginLeft: 6, cursor: "pointer", font: "400 10.5px var(--mono)", color: "var(--acc-hi, var(--acchi))" }}>
                {sources.length} report{sources.length === 1 ? "" : "s"}{open ? " ▴" : " ▾"}
            </button>
            {open && (
                <div style={{ margin: "4px 0 2px 10px", borderLeft: "1px solid var(--gline)", paddingLeft: 8 }}>
                    {sources.map((s) => (
                        <div key={s.id} style={{ font: "400 11px/1.45 var(--font)", color: "var(--txt-3)", padding: "2px 0" }}>
                            {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--txt-2)" }}>{s.headline}</a> : s.headline}
                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}> · {[s.source, s.when ? fmtWhen(s.when) : null].filter(Boolean).join(" · ")}</span>
                        </div>
                    ))}
                </div>
            )}
        </>
    )
}

function Conflict({ c, open, onToggle }) {
    const since = c.since ? new Date(c.since).getFullYear() : null
    return (
        <div style={{ borderBottom: "1px solid var(--gline)" }}>
            <button onClick={onToggle} aria-expanded={open}
                    style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "8px 0", border: 0, background: "none", cursor: "pointer", textAlign: "left", color: "var(--txt)" }}>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", width: 10 }}>{open ? "▾" : "▸"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", font: "600 12.5px var(--font)" }}>{c.name}</span>
                    <span style={{ display: "block", font: "400 11px var(--font)", color: "var(--txt-3)", marginTop: 1 }}>
                        {c.sides_line}{since ? ` · since ${since}` : ""}
                    </span>
                </span>
                {c.trend && c.trend !== "unclear" && (
                    <span title={c.trend_why || ""} style={{ font: "500 9.5px var(--mono)", letterSpacing: ".08em", textTransform: "uppercase", color: TREND[c.trend] }}>{c.trend}</span>
                )}
            </button>
            {open && (
                <div style={{ padding: "0 0 12px 18px" }}>
                    <p style={{ ...T.body, margin: 0 }}>{c.summary}</p>

                    <div style={T.sub}>Where it stands now{c.as_of ? ` · ${fmtWhen(c.as_of)}` : ""}</div>
                    {c.now?.length ? (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {c.now.map((n, i) => (
                                <li key={i} style={{ ...T.body, marginBottom: 3 }}>{n.text}<Sources sources={n.sources} /></li>
                            ))}
                        </ul>
                    ) : (
                        <div style={{ ...T.body, color: "var(--txt-4)" }}>No report in our feeds about this conflict in the last two weeks.</div>
                    )}
                    {c.trend_why && <div style={{ ...T.body, marginTop: 4, color: "var(--txt-3)" }}><b style={{ color: TREND[c.trend] }}>{c.trend}</b> — {c.trend_why}<Sources sources={c.trend_sources} /></div>}

                    <div style={T.sub}>Who fights</div>
                    {(c.factions || []).map((f) => (
                        <div key={f.name} style={{ marginBottom: 7 }}>
                            <div style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>
                                {f.name}<span style={{ fontWeight: 400, color: "var(--txt-3)" }}>{f.leader ? ` · ${f.leader}` : ""}</span>
                            </div>
                            {f.aims && <div style={T.body}>{f.aims}</div>}
                            {f.holds && <div style={{ ...T.body, color: "var(--txt-3)" }}>Holds: {f.holds}</div>}
                            {f.backers?.length > 0 && <div style={{ ...T.body, color: "var(--txt-3)" }}>Backed by: {f.backers.join("; ")}</div>}
                        </div>
                    ))}

                    <div style={T.sub}>Why they fight</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>{(c.drivers || []).map((d) => <li key={d} style={T.body}>{d}</li>)}</ul>

                    <div style={T.sub}>What is at stake</div>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>{(c.stakes || []).map((d) => <li key={d} style={T.body}>{d}</li>)}</ul>

                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginTop: 10 }}>
                        Background reviewed {c.reviewed}{c.n_reports ? ` · current picture from ${c.n_reports} reports in our feeds` : ""}
                    </div>
                </div>
            )}
        </div>
    )
}

export default function ConflictContext({ near = null, countries = [], names = [], label = "Conflicts here", max = 5 }) {
    const [all, setAll] = useState(cache)
    const [open, setOpen] = useState(readOpen)
    const [more, setMore] = useState(false)
    const cam = useCamera(near === "camera")
    useEffect(() => { let live = true; loadConflicts().then((d) => { if (live) setAll(d) }); return () => { live = false } }, [])
    const list = useMemo(() => (near === "camera" ? conflictsNear(all, cam) : conflictsIn(all, countries, names)),
        [all, cam, near, countries.join(","), names.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!list.length) return null
    const shown = more ? list : list.slice(0, max)
    const toggle = (id) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); writeOpen(n); return n })
    return (
        <div data-testid="conflict-context" style={{ marginBottom: 12 }}>
            <SectionLabel meta={list.length > 1 ? String(list.length) : null}>{label}</SectionLabel>
            {shown.map((c) => <Conflict key={c.id} c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} />)}
            {list.length > max && (
                <button onClick={() => setMore(!more)} style={{ border: 0, background: "none", padding: "6px 0", cursor: "pointer", font: "400 11px var(--font)", color: "var(--acc-hi, var(--acchi))" }}>
                    {more ? "fewer" : `${list.length - max} more`}
                </button>
            )}
        </div>
    )
}
