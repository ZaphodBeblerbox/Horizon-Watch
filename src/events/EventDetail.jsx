/**
 * EventDetail.jsx — one event (or any point with a place), as the desktop inspector and the phone sheet show it
 * (DATAMINR_PLAN B1-B4; owner 2026-10-23: "clicking a point must show everything relevant around it", "tapping a
 * Home item must open what happened, how it is connected to me and why it is on my Home").
 *
 *   status and priority      Developing · Urgent for you
 *   why it is here           the user's priority and its reason, the nearest asset and the distance, followed
 *   the evolving brief       the summary, facts each citing its sources (a chip opens the post), what changed,
 *                            "Updated 14:32 · v3", first seen, last report, the corroboration line
 *   Follow / Mute            a followed event's updates reach the user whatever their thresholds
 *   timeline                 reports, brief versions, status, the crowd's and police's positions (a followed protest)
 *   around it                the related items near it in space and time from every domain, ranked
 *
 * Our own design: the desktop's glass and hairlines (desktopV4.css tokens) and the phone's m2 tokens, from one
 * stylesheet (events.css) keyed on the variant.
 */
import { useEffect, useMemo, useState } from "react"
import { follow, getAround, getEvent, getFollows, getTimeline, muteEvent, myAssets, onFollowsChanged, unfollow, unmuteEvent } from "./eventApi.js"
import { assetConnection, eventIdOf, firstSeenLine, followTargetOf, homeReasons, lastUpdateLine, priorityOf, statusChip, timelineLine, updatedLine } from "./eventLogic.js"
import { setAttention } from "../state/attention.js"
import "./events.css"

const arr = (v) => (Array.isArray(v) ? v : [])

export function StatusChip({ status }) {
    const s = statusChip(status)
    if (!s) return null
    return <span className={`ev-chip ev-${s.tone}`} data-testid="ev-status">{s.label}</span>
}

export function PriorityChip({ item }) {
    const p = priorityOf(item)
    if (!p) return null
    return <span className={`ev-chip ev-p-${p.key}`} data-testid="ev-priority">{p.label}</span>
}

function Facts({ brief }) {
    const facts = arr(brief?.facts)
    if (!facts.length) return null
    return (
        <ul className="ev-facts" data-testid="ev-facts">
            {facts.map((f, i) => (
                <li key={i}>
                    <span>{f.text}</span>
                    {arr(f.sources).map((s, j) => s.url
                        ? <a key={j} className="ev-cite" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
                        : <span key={j} className="ev-cite">{s.label}</span>)}
                </li>
            ))}
        </ul>
    )
}

export function BriefBlock({ ev, compact = false }) {
    const b = ev?.brief
    if (!b && !ev?.headline) return null
    return (
        <section className="ev-brief" data-testid="ev-brief">
            {b?.what_changed && b.version > 1 && <div className="ev-changed" data-testid="ev-changed">Update: {b.what_changed}</div>}
            {b?.summary && <p className="ev-summary">{b.summary}</p>}
            {!compact && <Facts brief={b} />}
            <div className="ev-meta">
                {[updatedLine(b), b ? (b.by === "model" ? "rewritten by the model, every fact checked against its sources" : "written from the reports") : null]
                    .filter(Boolean).join(" · ")}
            </div>
        </section>
    )
}

function FollowButton({ item, onChange }) {
    const t = useMemo(() => followTargetOf(item), [item])
    const [on, setOn] = useState(!!item?.followed)
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        if (!t) return undefined
        let live = true
        const check = () => getFollows().then((d) => {
            if (!live || !d) return
            const eid = eventIdOf(item)
            setOn(arr(d.items).some((f) => f.target === t.target || (eid && arr(f.event_ids).includes(eid) && f.target === eid)))
        })
        check()
        const off = onFollowsChanged(check)
        return () => { live = false; off() }
    }, [t?.target]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!t) return null
    const click = async () => {
        setBusy(true)
        const r = on ? await unfollow(t.target) : await follow(t)
        setBusy(false)
        if (r) { setOn(!on); onChange?.(!on, t) }
    }
    return (
        <button type="button" className={`ev-btn${on ? " on" : ""}`} onClick={click} disabled={busy} data-testid="ev-follow" aria-pressed={on}>
            {on ? "Following" : "Follow"}
        </button>
    )
}

function Timeline({ entries }) {
    const rows = arr(entries).map(timelineLine).filter(Boolean)
    if (!rows.length) return null
    return (
        <section className="ev-sec" data-testid="ev-timeline">
            <div className="ev-h">Timeline</div>
            <ol className="ev-tl">
                {rows.slice(0, 30).map((r, i) => (
                    <li key={i} className={`ev-tl-${r.kind}`}>
                        <time>{r.time}</time>
                        <span><b>{r.text}</b>{r.sub && <small>{r.sub}</small>}</span>
                    </li>
                ))}
            </ol>
        </section>
    )
}

function Around({ data, onOpenItem }) {
    const rel = arr(data?.related)
    if (!data) return null
    return (
        <section className="ev-sec" data-testid="ev-around">
            <div className="ev-h">Around it <small>{rel.length ? `${rel.length} within ${data.radius_km} km and ${data.hours} h` : ""}</small></div>
            {!rel.length && <div className="ev-empty">Nothing else reported within {data.radius_km} km and {data.hours} h. An absence of reporting, not an absence of events.</div>}
            {rel.slice(0, 12).map((r) => (
                <button type="button" key={`${r.domain}:${r.id}`} className="ev-row" onClick={() => onOpenItem?.(r)}>
                    <span className="ev-dom">{r.domain_label}</span>
                    <span className="ev-row-main"><b>{r.title}</b><small>{[r.why, r.source].filter(Boolean).join(" · ")}</small></span>
                    {r.url && <a className="ev-cite" href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>source</a>}
                </button>
            ))}
        </section>
    )
}

/**
 * item: anything with a place (an event, a live signal, a card, a Protests item, an alert).
 * variant: "desk" | "phone". embedded: inside another panel (the inspector, the signal sheet): no title.
 */
export default function EventDetail({ item, variant = "desk", embedded = false, onShowOnMap, onOpenItem, here = null }) {
    const eid = eventIdOf(item)
    const [ev, setEv] = useState(null)
    const [around, setAround] = useState(null)
    const [assets, setAssets] = useState([])
    const [followTl, setFollowTl] = useState(null)
    const [muted, setMuted] = useState(false)
    const lat = Number(item?.lat ?? ev?.lat), lon = Number(item?.lon ?? ev?.lon)
    useEffect(() => { myAssets().then(setAssets) }, [])
    useEffect(() => {
        if (!eid) { setEv(null); return undefined }
        let live = true
        const load = () => getEvent(eid).then((d) => { if (live && d) { setEv(d); setMuted(!!d.muted) } })
        load()
        setAttention({ open_event_id: eid })
        const t = setInterval(load, 30_000)
        return () => { live = false; clearInterval(t); setAttention({ open_event_id: null }) }
    }, [eid])
    useEffect(() => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
        let live = true
        const at = item?.event_time || item?.first_seen || item?.published_at || item?.posted_at || item?.created_at || null
        const load = () => getAround({ lat, lon, at, eventId: eid, domain: item?.kind === "live_signal" ? "live_signal" : null }).then((d) => { if (live) setAround(d) })
        load()
        const t = setInterval(load, 60_000)
        return () => { live = false; clearInterval(t) }
    }, [eid, lat, lon]) // eslint-disable-line react-hooks/exhaustive-deps
    // a followed protest or place: its own timeline (the crowd's and the police's positions)
    const target = followTargetOf(item)?.target
    const loadFollowTl = () => {
        if (!target || eid) return
        getTimeline(target).then((d) => setFollowTl(d?.items || null))
    }
    useEffect(() => {
        loadFollowTl()
        const t = setInterval(loadFollowTl, 30_000)
        return () => clearInterval(t)
    }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

    const v = { ...(item || {}), ...(ev || {}), priority: ev?.priority ?? item?.priority, why: ev?.why ?? item?.why ?? item?._whyMine ?? item?.reason }
    const conn = assetConnection({ lat, lon }, assets, here)
    const reasons = homeReasons({ ...v, corroboration: v.corroboration || item?.event?.corroboration }, conn)
    const title = v.headline || v.title || "Signal"
    const brief = ev?.brief || item?.event?.brief || null
    const evForBrief = { ...v, brief }
    return (
        <div className={`ev ev-${variant}${embedded ? " ev-embedded" : ""}`} data-testid="event-detail">
            <div className="ev-top">
                <StatusChip status={v.status || item?.event?.status || item?.event_status} />
                <PriorityChip item={v} />
                {v.followed && <span className="ev-chip ev-cold">Following</span>}
            </div>
            {!embedded && <h2 className="ev-title" data-testid="ev-title">{title}</h2>}
            {reasons.length > 0 && (
                <section className="ev-why" data-testid="ev-why">
                    <div className="ev-h">Why it is here</div>
                    {reasons.map((r, i) => <div key={i}>{r}</div>)}
                    {conn.length > 1 && <div className="ev-sub">Also {conn.slice(1, 4).map((c) => `${Math.round(c.km * 10) / 10} km from ${c.me ? "where you are" : c.name}`).join(", ")}</div>}
                </section>
            )}
            <BriefBlock ev={evForBrief} />
            <div className="ev-meta" data-testid="ev-times">
                {[firstSeenLine(v), lastUpdateLine(v), (v.corroboration || item?.event?.corroboration)?.line].filter(Boolean).join(" · ")}
            </div>
            <div className="ev-acts">
                <FollowButton item={{ ...item, ...(eid ? { event_id: eid } : {}) }} onChange={loadFollowTl} />
                {eid && <button type="button" className={`ev-btn${muted ? " on" : ""}`} data-testid="ev-mute"
                    onClick={async () => { const r = muted ? await unmuteEvent(eid) : await muteEvent(eid, 24); if (r) setMuted(!muted) }}>
                    {muted ? "Muted for 24 h" : "Mute 24 h"}</button>}
                {onShowOnMap && Number.isFinite(lat) && <button type="button" className="ev-btn" onClick={() => onShowOnMap({ ...item, lat, lon })}>Show on the map</button>}
            </div>
            {arr(ev?.sources).length > 0 && (
                <section className="ev-sec">
                    <div className="ev-h">Sources <small>{ev.members_count} {ev.members_count === 1 ? "report" : "reports"}</small></div>
                    <div className="ev-srcs">
                        {ev.sources.map((s) => s.url
                            ? <a key={s.ref} className="ev-cite" href={s.url} target="_blank" rel="noreferrer">{s.label} · {s.act ? s.act.replace(/_/g, " ") : s.kind}</a>
                            : <span key={s.ref} className="ev-cite">{s.label}</span>)}
                    </div>
                </section>
            )}
            <Timeline entries={eid ? ev?.timeline : followTl} />
            <Around data={around} onOpenItem={onOpenItem} />
        </div>
    )
}
