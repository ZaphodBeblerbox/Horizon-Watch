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
import TelegramMedia from "../components/TelegramMedia.jsx"
import LocateButton from "../locate/LocateButton.jsx"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import {
    COLUMNS, SEV_COLOR, toInboxRow, nextSort, sortRows, applyFilters,
    emptyStateMessage, severityDistribution, distribution, unreadCount, hhmm,
} from "./inboxLogic.js"
import { subscribeLive } from "../state/liveEvents.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import Loading from "../ui/Loading.jsx"
import { whenLabel } from "../utils/formatTime.js"

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
    useEffect(() => {
        load()
        // The timer is the floor. The stream refetches the moment the
        // pipeline writes a signal, so the working record and the map stop
        // disagreeing for half a minute at a time; the interval covers the
        // stream being down, asleep or buffered by a proxy.
        const iv = setInterval(load, 30_000)
        let pending = null
        const off = subscribeLive(() => {
            if (pending) return
            pending = setTimeout(() => { pending = null; load() }, 400)
        }, ["alert.created", "signal.created", "fusion.created", "surge.created",
            "news_article.created"])
        return () => {
            clearInterval(iv)
            if (pending) clearTimeout(pending)
            off()
        }
    }, [load])

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

    /* ── v6 ▣ Inbox · LIST AND READER, NOT A TABLE WITH TWO SIDEBARS ──
       The old shape was three panes: a distributions sidebar, a sortable
       table, and an inspector. It came from an earlier spec whose argument
       was "triage is comparison, not reading" — true of a queue you are
       sorting, and wrong about this one. The rows carry a headline written
       by a journalist; the thing you do with one is read it.

       v6 puts the filters inline above the list as counted chips, the list
       in a 260–360px column, and gives the rest of the window to the
       signal itself at a 30px headline. Sorting moves to the chips, which
       is the only sort anyone used.

       THE LOCATOR STAYS. It is not in the spec's reader, and it is the one
       thing this screen had that answered "where is this" without a camera
       move, so it sits at the top of the reader where the eye lands before
       the body text. */
    const FILTERS = [
        ["all", "all", allRows.length],
        ["new", "unread", allRows.filter((r) => (r.status || "new") === "new").length],
        ["ack", "acknowledged", allRows.filter((r) => r.status === "ack").length],
        ["esc", "escalated", allRows.filter((r) => r.status === "esc").length],
    ]
    const sevC = (k) => SEV_COLOR[k] || "var(--steel)"

    return (
        <section data-testid="view-root-inbox" data-screen-label="Inbox" style={{
            ...MODE_SURFACE,
            display: "grid",
            gridTemplateColumns: "minmax(280px,340px) minmax(0,1fr)",
        }}>
            {/* ── the queue ─────────────────────────────────────────── */}
            <div style={{
                display: "flex", flexDirection: "column", minHeight: 0,
                borderRight: "1px solid var(--gline)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, height: 36, flex: "none",
                    padding: "0 12px", borderBottom: "1px solid var(--gline)",
                }}>
                    <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Inbox</h3>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                        {rows.length} shown · {unread} unread
                    </span>
                    <button onClick={load} disabled={loading} title="Refresh the queue now" style={{
                        marginLeft: "auto", height: 22, padding: "0 8px",
                        border: "1px solid var(--gline2)", background: "transparent",
                        color: "var(--txt3)", font: "inherit", fontSize: 11,
                        cursor: loading ? "default" : "pointer", borderRadius: 0,
                    }}>{loading ? <Loading size={11} inline label="refreshing" labelHidden /> : "refresh"}</button>
                </div>

                <div style={{
                    display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 12px",
                    borderBottom: "1px solid var(--gline)", flex: "none",
                }}>
                    {FILTERS.map(([k, label, n]) => (
                        <button key={k} onClick={() => setStatus(k)} style={{
                            display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px",
                            border: "1px solid var(--gline2)",
                            background: status === k ? "var(--accdim)" : "transparent",
                            color: status === k ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 0,
                        }}>
                            {label}
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{n}</span>
                        </button>
                    ))}
                    {SEV_FLOORS.filter((f) => f.key).map((f) => (
                        <button key={f.key} onClick={() => setSevFloor(sevFloor === f.key ? null : f.key)} style={{
                            display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px",
                            border: `1px solid ${sevFloor === f.key ? sevC(f.key) : "var(--gline2)"}`,
                            background: sevFloor === f.key ? "var(--accdim)" : "transparent",
                            color: sevFloor === f.key ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 0,
                        }}>
                            <i style={{ width: 6, height: 6, background: sevC(f.key) }} />{f.label}
                        </button>
                    ))}
                </div>

                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--gline)", flex: "none" }}>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter signals…" style={{
                        width: "100%", height: 28, padding: "0 9px", border: "1px solid var(--gline2)",
                        background: "var(--canvas)", color: "var(--txt)", fontSize: 12,
                        outline: "none", borderRadius: 0,
                    }} />
                </div>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                    {!loaded && <Loading size={18} inline label="Reading the queue" style={{ padding: "16px 12px" }} />}
                    {loaded && rows.length === 0 && (
                        <div style={{ padding: "16px 12px", color: "var(--txt3)" }}>
                            <b style={{ display: "block", fontWeight: 600, color: "var(--txt)" }}>{empty.headline}</b>
                            {empty.detail && <span style={{ fontSize: 12 }}>{empty.detail}</span>}
                        </div>
                    )}
                    {rows.map((r) => {
                        const isSel = r.id === sel
                        const isNew = (r.status || "new") === "new"
                        return (
                            <button key={r.id} data-id={r.id} onClick={() => select(r)} style={{
                                display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px",
                                width: "100%", padding: "10px 12px", border: 0,
                                borderBottom: "1px solid var(--gline)",
                                background: isSel ? "var(--accdim)" : "transparent",
                                color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                opacity: r.status === "ack" && !isSel ? 0.72 : 1,
                            }}>
                                <b style={{
                                    fontWeight: isNew ? 600 : 400, minWidth: 0,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{r.title}</b>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                    {r.ts ? whenLabel(r.ts) : hhmm(r.ts)}
                                </span>
                                <span style={{
                                    fontSize: 11, color: "var(--txt3)", minWidth: 0,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{r.place || r.source}</span>
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                    letterSpacing: ".06em", color: sevC(r.sev),
                                }}>{r.sev}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* ── the reader ────────────────────────────────────────── */}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 6, height: 36, flex: "none",
                    padding: "0 8px 0 20px", borderBottom: "1px solid var(--gline)", overflow: "hidden",
                }}>
                    {[["acknowledge", () => { setStatusFor(sel, "ack"); toast("Acknowledged", { icon: "i-check" }) }],
                      ["escalate", () => { setStatusFor(sel, "esc"); toast("Escalated", { icon: "i-up" }) }],
                      ["+ briefing", () => {
                          /* The record is in hand here, so the sidebar gets
                             the whole thing rather than a label and a
                             coordinate pair — headline, where, who and
                             when are what you write a briefing from. */
                          addToBriefing(sel, selected?.title || sel, {
                              kind: "signal",
                              headline: selected?.title || null,
                              region: selected?.place || null,
                              source: selected?.source || null,
                              severity: selected?.sev || null,
                              when: selected?.ts ? new Date(selected.ts).toISOString() : null,
                              lat: selected?.row?.lat ?? null,
                              lon: selected?.row?.lon ?? null,
                              url: selected?.row?.raw?.url || null,
                          })
                          toast("Added to briefing basket", { icon: "i-add-brief" })
                      }],
                      ...(imageryTarget(selected) ? [["open imagery →", () => window.dispatchEvent(
                          new CustomEvent("akili:imagery-open-scene", { detail: imageryTarget(selected) }))]] : []),
                      ...(selected?.row?.lat != null ? [["show on map →", () => window.dispatchEvent(
                          new CustomEvent("akili:fly-to", { detail: { lat: selected.row.lat, lon: selected.row.lon } }))]] : []),
                    ].map(([k, go]) => (
                        <button key={k} onClick={go} disabled={!selected} style={{
                            height: 24, padding: "0 10px", border: "1px solid var(--gline2)",
                            background: "transparent", color: selected ? "var(--txt2)" : "var(--txt4)",
                            font: "inherit", fontSize: 11, whiteSpace: "nowrap",
                            cursor: selected ? "pointer" : "default", borderRadius: 0,
                        }}>{k}</button>
                    ))}
                    <span style={{
                        marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                        fontSize: 10, color: "var(--txt4)", whiteSpace: "nowrap", paddingRight: 8,
                    }}>
                        {loading
                            ? <Loading size={12} inline label="refreshing" />
                            : lastLoad ? `updated ${freshnessLabel(lastLoad, nowTick)}` : ""}
                    </span>
                </div>

                {!selected ? (
                    <div style={{ padding: "22px 28px", color: "var(--txt3)" }}>
                        <b style={{ display: "block", fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>
                            Nothing selected
                        </b>
                        <span>Pick a signal to read it.</span>
                    </div>
                ) : (
                    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 32px 40px" }}>
                        <div>
                            <div style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em",
                                textTransform: "uppercase", color: "var(--txt4)",
                            }}>
                                {[selected.source, hhmm(selected.ts), selected.sev].filter(Boolean).join(" · ")}
                            </div>
                            {/* The spec sets this at 30px against a 720px
                                measure. The reader is far wider than that
                                here, and a headline has to grow with its
                                column or it reads as a caption on a page. */}
                            <h2 style={{
                                margin: "10px 0 16px", fontFamily: "var(--mz-font-body)",
                                fontSize: "clamp(30px, 2.6vw, 42px)",
                                fontWeight: 600, lineHeight: 1.04, letterSpacing: "-.015em",
                                textWrap: "pretty", maxWidth: 1100,
                            }}>{selected.title}</h2>

                            {/* A Telegram report leads with its footage. */}
                            {selected.row?.raw?.source_type === "telegram" && (selected.row.raw.thumb_url || selected.row.raw.media === "video") && (
                                <div style={{ marginBottom: 18, maxWidth: 900 }}><TelegramMedia post={selected.row.raw} maxHeight="56vh" /><LocateButton post={selected.row.raw} /></div>
                            )}

                            {/* The locator, before the body — "where in the
                                world is this, and what is near it" is the
                                question you ask before you read a word. */}
                            <div style={{ border: "1px solid var(--gline)", marginBottom: 18 }}>
                                <Minimap
                                    focus={selected.row?.lat != null ? { lat: selected.row.lat, lon: selected.row.lon } : null}
                                    context={rows.filter((r) => r.id !== sel && r.row?.lat != null)
                                        .map((r) => ({ id: r.id, lat: r.row.lat, lon: r.row.lon, ts: r.ts, severity: r.sev, title: r.title }))}
                                    framing="signal"
                                    width={1180}
                                    height={260}
                                    label={String(selected.title).slice(0, 26)}
                                    title={selected.place || "Locator"}
                                    subtitle={selected.row?.lat == null ? "this signal has no location" : ""}
                                />
                            </div>

                            <div style={{ borderTop: "1px solid var(--gline)", paddingTop: 14 }}>
                                <InspectorPanel
                                    bare
                                    entityType={selected.row.kind === "fusion" ? "fusion" : "event"}
                                    entityId={selected.id}
                                    data={selected.row.raw}
                                    onClose={() => setSel(null)}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}

