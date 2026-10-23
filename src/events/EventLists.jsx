/**
 * EventLists.jsx — Home leads with the event model (owner, 2026-10-23: "I don't see the Dataminr-ization"):
 *
 *   DevelopingList   "Developing in your areas": the events that concern the user (GET /api/events), ranked by
 *                    status then THEIR priority, each with its status chip, priority, one-line brief, why and age
 *   FollowingList    what the user follows (GET /api/follows): status, last update age, one-line brief, Unfollow
 *
 * Both poll every 30 s while mounted, on desktop and phone (variant), and open an item with onOpen(item).
 */
import { useEffect, useState } from "react"
import { getEvents, getFollows, onFollowsChanged, unfollow } from "./eventApi.js"
import { rankEvents } from "./eventLogic.js"
import { PriorityChip, StatusChip } from "./EventDetail.jsx"
import { agoLabel } from "../utils/formatTime.js"
import "./events.css"

const arr = (v) => (Array.isArray(v) ? v : [])

function usePolled(load, deps = [], every = 30_000) {
    const [data, setData] = useState(null)
    useEffect(() => {
        let live = true
        const run = () => load().then((d) => { if (live) setData(d || { items: [] }) })
        run()
        const t = setInterval(run, every)
        const off = onFollowsChanged(run)
        return () => { live = false; clearInterval(t); off() }
    }, deps) // eslint-disable-line react-hooks/exhaustive-deps
    return data
}

export function EventRow({ ev, onOpen }) {
    const line = ev.brief?.summary && ev.brief.summary !== ev.headline ? ev.brief.summary : (ev.corroboration?.line || "")
    return (
        <button type="button" className="evl-row" data-testid="evl-row" onClick={() => onOpen?.(ev)}>
            <span className="evl-head">
                <StatusChip status={ev.status} />
                <PriorityChip item={ev} />
                {ev.brief?.version > 1 && <span className="evl-counts">v{ev.brief.version}</span>}
            </span>
            <span style={{ minWidth: 0 }}>
                <span className="evl-title" style={{ display: "block" }}>{ev.headline}</span>
                {line && <span className="evl-line">{line}</span>}
            </span>
            <span className="evl-when">{agoLabel(ev.last_update) || ""}</span>
            {ev.why && <span className="evl-why">{ev.why}</span>}
        </button>
    )
}

export function DevelopingList({ variant = "desk", onOpen, limit = 6, data: given = null }) {
    const polled = usePolled(() => (given ? Promise.resolve(given) : getEvents("?hours=12&limit=30")), [given])
    const data = given || polled
    const items = rankEvents(arr(data?.items)).slice(0, limit)
    const c = data?.counts || {}
    return (
        <div className={`evl evl-${variant}`} data-testid="developing">
            {data && (c.developing || c.ongoing) ? (
                <span className="evl-counts" style={{ marginBottom: 4 }}>
                    {[c.developing ? `${c.developing} developing` : null, c.ongoing ? `${c.ongoing} ongoing` : null, c.ended ? `${c.ended} ended today` : null].filter(Boolean).join(" · ")}
                </span>
            ) : null}
            {data === null && <div className="ev-empty">Loading…</div>}
            {data && !items.length && <div className="ev-empty">{data.note || "Nothing developing in your areas."}</div>}
            {items.map((ev) => <EventRow key={ev.id} ev={ev} onOpen={onOpen} />)}
        </div>
    )
}

export function FollowingList({ variant = "desk", onOpen, data: given = null }) {
    const polled = usePolled(() => (given ? Promise.resolve(given) : getFollows()), [given])
    const data = given || polled
    const items = arr(data?.items)
    if (data && !items.length) {
        return <div className={`evl evl-${variant}`} data-testid="following"><div className="ev-empty">Follow an event or a protest and its updates gather here.</div></div>
    }
    return (
        <div className={`evl evl-${variant}`} data-testid="following">
            {items.map((f) => (
                <div key={f.target} className="evl-row" style={{ cursor: "default" }} data-testid="following-row">
                    <span className="evl-head">
                        <StatusChip status={f.status} />
                        {f.n_movements > 0 && <span className="evl-counts">{f.n_movements} {f.n_movements === 1 ? "track" : "tracks"} moving</span>}
                    </span>
                    <button type="button" style={{ all: "unset", cursor: "pointer", minWidth: 0 }}
                        onClick={() => onOpen?.({ ...f, id: f.lead_event_id || f.target, event_id: f.lead_event_id || (f.target.startsWith("ev_") ? f.target : null),
                                                   headline: f.headline || f.label, followed: true, kind: f.kind === "event" ? "event" : f.kind })}>
                        <span className="evl-title" style={{ display: "block" }}>{f.headline || f.label}</span>
                        <span className="evl-line">{f.line}</span>
                    </button>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <span className="evl-when">{agoLabel(f.last_update) || ""}</span>
                        <button type="button" className="evl-x" onClick={() => unfollow(f.target)} data-testid="unfollow">Unfollow</button>
                    </span>
                </div>
            ))}
        </div>
    )
}
