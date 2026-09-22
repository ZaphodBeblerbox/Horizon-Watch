/**
 * Inbox.jsx — PARALLAX addendum §S2 (which supersedes part 3 §22).
 *
 * The primary triage queue. Until now this module resolved to the old
 * WatchlistsPage — "a console whose primary queue is a placeholder is a demo".
 *
 * A TABLE, NOT CARDS. "Triage is comparison, not reading. A card list forces
 * a vertical scan through decoration to reach the one field you are comparing
 * on; a table puts severity, confidence and age in fixed columns so the eye
 * travels down a single axis."
 *
 * SELECTION IS ACKNOWLEDGEMENT (§S2.5). There is no second "mark read": "a
 * queue that needs two gestures per item to clear is a queue nobody clears."
 * Row click selects into the inspector WITHOUT navigating — that is what the
 * third pane is for.
 */
import { useState, useEffect, useMemo, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { freshnessLabel } from "./inboxFreshness.js"
import { safeArray } from "../utils/safeArray.js"
import { mergeNotificationItems } from "../components/notificationsNormalize.js"
import { buildWatchQueueRows } from "./dashboardLogic.js"
import InspectorPanel from "../components/InspectorPanel.jsx"
import Minimap from "../components/Minimap.jsx"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import {
    COLUMNS, SEV_COLOR, toInboxRow, nextSort, sortRows, applyFilters,
    emptyStateMessage, severityDistribution, distribution, unreadCount, hhmm,
} from "./inboxLogic.js"

const SEV_FLOORS = [
    { key: null, label: "all" },
    { key: "critical", label: "critical" },
    { key: "high", label: "high+" },
    { key: "elevated", label: "elevated+" },
]

/**
 * Which imagery scene, if any, a signal points at.
 *
 * Returns null for everything else, so the action is absent rather than
 * present-and-broken — a button that opens nothing teaches people to
 * distrust the ones that work.
 */
export function imageryTarget(signal) {
    const raw = signal?.row?.raw_json || signal?.raw?.raw_json || signal?.raw || null
    const src = signal?.source || signal?.raw?.source
    if (src !== "SAT-TASK" || !raw) return null
    const detail = {}
    if (raw.detection_id) detail.detectionId = raw.detection_id
    if (raw.scan_id) detail.scanId = raw.scan_id
    if (raw.zone_id) detail.systemId = raw.zone_id
    return (detail.detectionId || detail.scanId) ? detail : null
}

export default function Inbox() {
    const [items, setItems] = useState([])
    const [fusions, setFusions] = useState([])
    const [loaded, setLoaded] = useState(false)
    // Triage state lives here, not on the server: there is no per-analyst
    // read model in this backend, and inventing one client-side that pretends
    // to be shared would be worse than an honest session-local queue.
    const [statuses, setStatuses] = useState({})
    const [sel, setSel] = useState(null)
    const [status, setStatus] = useState("all")
    const [q, setQ] = useState("")
    const [sevFloor, setSevFloor] = useState(null)
    // §S2.4 — "Sort state is per-session, not per-visit. An analyst who sorts
    // by confidence means it."
    const [sort, setSort] = useState(() => {
        try {
            const s = JSON.parse(sessionStorage.getItem("inbox.sort") || "null")
            return s?.key ? s : { key: "ts", dir: "desc" }
        } catch { return { key: "ts", dir: "desc" } }
    })
    useEffect(() => {
        try { sessionStorage.setItem("inbox.sort", JSON.stringify(sort)) } catch { /* private window */ }
    }, [sort])

    // WHEN IT LAST ACTUALLY ARRIVED. The queue refreshed every thirty
    // seconds and said so nowhere, which is indistinguishable from a
    // queue that has stopped refreshing — and a working record that
    // might be stale is one nobody trusts. Both states are now on
    // screen: when the last load landed, and whether one is in flight.
    const [lastLoad, setLastLoad] = useState(0)
    const [loading, setLoading] = useState(false)

    const load = useCallback(() => {
        setLoading(true)
        Promise.all([
            fetch(`${API_BASE}/api/surface`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch(`${API_BASE}/api/fusions?status=active&limit=50`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]).then(([s, f]) => {
            setItems(safeArray(s?.items))
            setFusions(Array.isArray(f) ? f : [])
            setLoaded(true)
            setLastLoad(Date.now())
        }).finally(() => setLoading(false))
    }, [])
    // Two minutes was long enough that the inbox was reliably showing
    // something other than what the map was showing. It is the working
    // record and it has to keep up with the feed that fills it.
    useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv) }, [load])

    // The freshness label has to count up by itself; without its own
    // tick it only changed when a load happened, which is exactly the
    // moment it says "0s ago" and tells you nothing.
    const [nowTick, setNowTick] = useState(() => Date.now())
    useEffect(() => {
        const iv = setInterval(() => setNowTick(Date.now()), 5000)
        return () => clearInterval(iv)
    }, [])

    const allRows = useMemo(
        () => buildWatchQueueRows(mergeNotificationItems(items, fusions)).map((r) => toInboxRow(r, statuses)),
        [items, fusions, statuses],
    )

    const { rows: filtered, stages } = useMemo(
        () => applyFilters(allRows, { status, q, sevFloor }),
        [allRows, status, q, sevFloor],
    )
    const rows = useMemo(() => sortRows(filtered, sort), [filtered, sort])
    const unread = unreadCount(allRows)

    // §S2.5 — selection IS acknowledgement.
    const select = (r) => {
        setSel(r.id)
        if ((statuses[r.id] || "new") === "new") {
            setStatuses((p) => ({ ...p, [r.id]: "ack" }))
        }
    }

    const setStatusFor = (id, next) => setStatuses((p) => ({ ...p, [id]: next }))
    const selected = rows.find((r) => r.id === sel) || allRows.find((r) => r.id === sel) || null

    const sevDist = useMemo(() => severityDistribution(allRows), [allRows])
    const placeDist = useMemo(() => distribution(allRows, (r) => r.place.split(",").pop().trim()).slice(0, 8), [allRows])
    const empty = emptyStateMessage({ total: allRows.length, stages })

    const arrow = (key) => (sort.key !== key ? "" : sort.dir === "asc" ? "▲" : "▼")

    return (
        <div data-testid="view-root-inbox" className="inboxview">
            {/* ── left: distributions, not checkboxes (§S2.6) ── */}
            <aside className="pane">
                <div className="panehead"><h3>Triage</h3></div>
                <div className="scroll" id="inbox-filters">
                    <span className="tipl">Severity</span>
                    {sevDist.map((d) => (
                        <button key={d.key} type="button" className="distrow"
                                aria-pressed={sevFloor === d.key}
                                onClick={() => setSevFloor(sevFloor === d.key ? null : d.key)}>
                            <i className="dia" style={{ background: SEV_COLOR[d.key] || "var(--grey)" }} />
                            <span className="n">{d.key}</span>
                            <span className="bar"><i style={{ width: `${d.pct}%`, background: SEV_COLOR[d.key] || "var(--grey)" }} /></span>
                            <span className="c">{d.n}</span>
                        </button>
                    ))}

                    <span className="tipl" style={{ marginTop: 12 }}>Region</span>
                    {placeDist.map((d) => (
                        <button key={d.key} type="button" className="distrow" onClick={() => setQ(d.key)}>
                            <i className="dia" style={{ background: "var(--steel)" }} />
                            <span className="n">{d.key}</span>
                            <span className="bar"><i style={{ width: `${d.pct}%`, background: "var(--steel)" }} /></span>
                            <span className="c">{d.n}</span>
                        </button>
                    ))}

                    <span className="tipl" style={{ marginTop: 12 }}>Severity floor</span>
                    <div className="seg" style={{ margin: "0 9px" }}>
                        {SEV_FLOORS.map((f) => (
                            <button key={f.label} type="button" aria-pressed={sevFloor === f.key}
                                    onClick={() => setSevFloor(f.key)}>{f.label}</button>
                        ))}
                    </div>
                </div>
            </aside>

            {/* ── centre: toolbar + the table ── */}
            <div className="pane">
                <div className="toolbar">
                    <div className="seg" id="inbox-status">
                        {[["all", "all"], ["new", "unread"], ["ack", "acked"], ["esc", "escalated"]].map(([k, l]) => (
                            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>
                        ))}
                    </div>
                    <input className="input" id="inbox-q" placeholder="Filter signals…"
                           style={{ width: 200, height: 26 }} value={q} onChange={(e) => setQ(e.target.value)} />
                    <div className="sp" />
                    <span className="lbl" id="inbox-count">{rows.length} signals · {unread} unread</span>
                    <span className="lbl" id="inbox-freshness" title={lastLoad ? new Date(lastLoad).toLocaleTimeString() : ""}>
                        {loading ? "refreshing…"
                            : lastLoad ? `updated ${freshnessLabel(lastLoad, nowTick)}`
                            : ""}
                    </span>
                    <button className="btn sm" id="inbox-refresh" onClick={load} disabled={loading}
                            title="Refresh the queue now">
                        <svg className="icon sm"><use href="#i-refresh" /></svg> refresh
                    </button>
                    <button className="btn sm" disabled={!sel} onClick={() => { setStatusFor(sel, "ack"); toast("Acknowledged", { icon: "i-check" }) }}>acknowledge</button>
                    <button className="btn sm danger" disabled={!sel} onClick={() => { setStatusFor(sel, "esc"); toast("Escalated", { icon: "i-up" }) }}>escalate</button>
                    <button className="btn sm primary" disabled={!sel}
                            onClick={() => { addToBriefing(sel, selected?.title || sel); toast("Added to briefing basket", { icon: "i-add-brief" }) }}>
                        <svg className="icon sm"><use href="#i-add-brief" /></svg> brief
                    </button>
                </div>

                <div className="scroll">
                    {!loaded ? (
                        <div className="inboxempty"><b>Reading the queue…</b></div>
                    ) : rows.length === 0 ? (
                        // §S2.7 — name the stage that emptied it.
                        <div className="inboxempty">
                            <b>{empty.headline}</b>
                            {empty.detail && <span>{empty.detail}</span>}
                        </div>
                    ) : (
                        <table className="grid" id="inbox-table">
                            <thead>
                                <tr>
                                    {COLUMNS.map((c) => (
                                        <th key={c.key} style={c.width ? { width: c.width } : undefined}
                                            onClick={() => setSort((s) => nextSort(s, c.key))}>
                                            {c.label}<span className="ar">{arrow(c.key)}</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} data-id={r.id} aria-selected={r.id === sel}
                                        className={r.status === "ack" ? "ack" : ""}
                                        onClick={() => select(r)}>
                                        {/* .keep — acknowledged rows dim EXCEPT time and
                                            severity. You still need to scan when and how
                                            bad across handled items. */}
                                        <td className="mono dim keep">{hhmm(r.ts)}</td>
                                        <td className="keep">
                                            <span className="sev" style={{ color: SEV_COLOR[r.sev] }}>
                                                <i className="dia" style={{ background: SEV_COLOR[r.sev] }} />{r.sev}
                                            </span>
                                        </td>
                                        <td className="title">
                                            <div>
                                                {r.status === "esc" && <span className="tag red">ESC</span>}
                                                {r.title}
                                            </div>
                                        </td>
                                        <td><div className="clip">{r.place || "—"}</div></td>
                                        <td><span className="tag">{r.domain}</span></td>
                                        <td>
                                            {/* A bar for scanning the column, a number for
                                                quoting it. Neither alone does both jobs. */}
                                            <span className="conf">
                                                <span className="bar"><i style={{ width: `${(r.conf ?? 0) * 100}%`, background: "var(--grey)" }} /></span>
                                                {r.conf == null ? "—" : Math.round(r.conf * 100)}
                                            </span>
                                        </td>
                                        <td className="mono dim">{r.source}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* ── right: THE SAME inspector component as Situation ── */}
            <aside className="pane">
                <div className="panehead">
                    <h3>Signal detail</h3>
                    <div className="right">
                        {/* An imagery finding has a picture behind it. "Show
                            on map" answers where; this answers what it
                            actually looked like, landing on the detected
                            object itself rather than on a scene full of
                            boxes with no indication which one is meant. */}
                        {imageryTarget(selected) ? (
                            <button className="btn ghost sm"
                                    onClick={() => window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", {
                                        detail: imageryTarget(selected),
                                    }))}>open imagery →</button>
                        ) : null}
                        <button className="btn ghost sm" disabled={!selected?.row?.lat}
                                onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                    detail: { lat: selected.row.lat, lon: selected.row.lon },
                                }))}>show on map →</button>
                    </div>
                </div>
                {/* §S3.5's locator, the same component Replay and the
                    briefing reader use — "where in the world is this, and
                    what is near it", answered without a camera move. */}
                <Minimap
                    focus={selected?.row?.lat != null ? { lat: selected.row.lat, lon: selected.row.lon } : null}
                    // §M4 — the locator paints by heat (severity × recency),
                    // so it needs the timestamp and the tier, not a colour.
                    context={rows.filter((r) => r.id !== sel && r.row?.lat != null)
                                 .map((r) => ({ id: r.id, lat: r.row.lat, lon: r.row.lon, ts: r.ts, severity: r.sev, title: r.title }))}
                    framing="signal"
                    label={selected ? String(selected.title).slice(0, 26) : ""}
                    title="Locator"
                    subtitle={selected ? "" : "no signal selected"}
                />
                <div className="scroll" id="inbox-detail">
                    {!selected ? (
                        <div className="inboxempty"><b>Nothing selected</b><span>Pick a row to read it.</span></div>
                    ) : (
                        <InspectorPanel
                            bare
                            entityType={selected.row.kind === "fusion" ? "fusion" : "event"}
                            entityId={selected.id}
                            data={selected.row.raw}
                            onClose={() => setSel(null)}
                        />
                    )}
                </div>
            </aside>
        </div>
    )
}
