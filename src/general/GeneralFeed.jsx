/**
 * GeneralFeed.jsx — what is generally happening, as a timeline.
 *
 * The Desk's General tab on the desktop and the phone (owner, 2026-10-10):
 * our own alerts (imagery, heat, sanctioned ships, loitering — never news:
 * news is for a country's page, owner 2026-10-11), GeoConfirmed's verified
 * events with the X post each cites, and the Telegram posts we publish,
 * one card per event ("+3 reports"), newest first, read like a
 * Twitter timeline — a round avatar for the source, the source's name, the
 * place and the time, the post, its media, and what can be done with it.
 * Backend: /api/general (general_feed.py). It loads more as you scroll, and
 * offers what has come in since at the top rather than moving the list
 * under the reader.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import TelegramMedia from "../components/TelegramMedia.jsx"
import XPost from "../components/XPost.jsx"
import SourceLink from "../components/SourceLink.jsx"
import { agoLabel } from "../utils/formatTime.js"
import { ageLabel } from "../lib/liveIncident.js"
import { dropStaleDemos } from "../globe/freshness.js"

const SEV = { critical: "#E5484D", high: "#F5A524", significant: "#F5A524", elevated: "#F5A524", moderate: "#8FB4E8" }
// "signal" is the backend's kind for our own alerts
const FILTERS = [["all", "All"], ["signal", "Alerts"], ["geoconfirmed", "GeoConfirmed"], ["telegram", "Telegram"]]

const ago = (iso) => (agoLabel(iso) || "").replace(/ ago$/, "")
// A GeoConfirmed event is known to the DAY (general_feed.gc_event_at): one
// stored weeks after its day reads as its date, never "just now".
export const whenOf = (it) => {
    if (!it?.at) return ""
    if (it.at_precision === "day") {
        const d = new Date(`${String(it.at).slice(0, 10)}T12:00:00Z`)
        return Number.isNaN(d.getTime()) ? String(it.at).slice(0, 10) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
    }
    return ago(it.at)
}
const shownIds = (list) => new Set((list || []).flatMap((x) => [x.id, ...(Array.isArray(x.also) ? x.also.map((a) => a.id) : [])]))

function Avatar({ it }) {
    const base = { width: 40, height: 40, borderRadius: 20, flex: "none", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, color: "#fff" }
    if (it.kind === "telegram") {
        const name = String(it.channel_title || it.channel || "T")
        const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
        return <span style={{ ...base, background: `hsl(${hue} 45% 38%)` }}>{name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "T"}</span>
    }
    if (it.kind === "geoconfirmed") return <span style={{ ...base, background: "#2f6f4f", fontSize: 12 }}>GC</span>
    return (
        <span style={{ ...base, background: "rgba(255,255,255,.06)", border: "1px solid var(--gline2)" }}>
            <i style={{ width: 12, height: 12, transform: "rotate(45deg)", background: SEV[it.severity] || "#8FB4E8", display: "block" }} />
        </span>
    )
}

// What a feed is called, in words — never its internal code ("gdelt", "ais").
const SOURCE_NAME = { ais: "Ship tracking", adsb: "Air tracking", firms: "Heat (satellite)", gps: "GPS watch", "sat-task": "Imagery",
                      corroborated: "Our sensors agree", fusion: "Fusion", imagery: "Imagery", sentinel: "Imagery", telegram: "Telegram", forge: "Analysis" }
function sourceName(it) {
    if (it.kind === "telegram") return it.channel_title || it.channel
    if (it.kind === "geoconfirmed") return "GeoConfirmed"
    const s = String(it.source || "").toLowerCase()
    const key = Object.keys(SOURCE_NAME).find((k) => s.includes(k))
    return key ? SOURCE_NAME[key] : it.source ? String(it.source).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "Signal"
}

export function GeneralItem({ it, onMap, onShare, compact = false }) {
    // ONLY THE POST IN VIEW PLAYS (owner, 2026-10-10): the video starts when
    // most of it is on screen and stops when it scrolls away.
    const media = useRef(null)
    const [inView, setInView] = useState(false)
    useEffect(() => {
        const el = media.current
        if (!el || typeof IntersectionObserver === "undefined") return undefined
        const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] })
        io.observe(el)
        return () => io.disconnect()
    }, [])
    const place = String(it.place || "").split(",").slice(0, 2).join(",")
    const kindLabel = it.kind === "geoconfirmed" ? "verified" : it.kind === "telegram" ? (it.role === "official" ? "official" : "Telegram") : (it.severity || "alert")
    const [openAlso, setOpenAlso] = useState(false)
    const also = Array.isArray(it.also) ? it.also : []
    return (
        <article data-testid="general-item" className="plx-gi" style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 12, padding: compact ? "12px 0" : "14px 4px",
                                                                      borderBottom: "1px solid var(--gline)" }}>
            <Avatar it={it} />
            <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, fontSize: 14 }}>
                    <b style={{ fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flex: "0 0 auto", maxWidth: "55%" }}>{sourceName(it)}</b>
                    <span style={{ color: "var(--txt4)", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        · {kindLabel}{place ? ` · ${place}` : ""} · {it.event_time ? ageLabel(it).replace(/ ago$/, "") : whenOf(it)}
                    </span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.45, marginTop: 3, color: "var(--txt)", overflowWrap: "anywhere" }}>{it.headline}</div>
                {it.kind === "geoconfirmed" && (it.faction || it.event_date) && (
                    <div data-testid="gc-meta" style={{ fontSize: 12.5, marginTop: 3, color: "var(--txt4)" }}>
                        {/* GeoConfirmed files civilian and infrastructure pins under "Neutral": not a side */}
                        {[it.faction && !/^(neutral|unknown)/i.test(it.faction) && `Side: ${it.faction}`, it.event_date && `Event of ${it.event_date}`].filter(Boolean).join(" · ")}
                    </div>
                )}
                {it.text && <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 4, color: "var(--txt2)", overflowWrap: "anywhere",
                                          display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.text}</div>}
                {it.kind === "telegram" && (it.media === "video" || it.media === "photo") && (
                    <div ref={media} style={{ marginTop: 10, borderRadius: 14, overflow: "hidden", border: "1px solid var(--gline)" }}>
                        <TelegramMedia post={{ ...it, id: it.id }} maxHeight={compact ? "300px" : "420px"} radius="0" active={inView} />
                    </div>
                )}
                {it.x_url && <div ref={it.media === "video" ? undefined : media} style={{ marginTop: 10 }}><XPost url={it.x_url} active={inView} /></div>}
                {also.length > 0 && (
                    <div data-testid="general-also" style={{ marginTop: 8 }}>
                        <button onClick={() => setOpenAlso((o) => !o)} aria-expanded={openAlso}
                                style={{ ...ACT, minHeight: 26, padding: "0 10px", borderRadius: 13, border: "1px solid var(--gline2)", color: "var(--txt2)" }}>
                            +{also.length} {also.length === 1 ? "report" : "reports"}
                            {it.also_sources?.length ? <span style={{ color: "var(--txt4)", marginLeft: 6 }}>{it.also_sources.slice(0, 3).join(", ")}</span> : null}
                        </button>
                        {openAlso && (
                            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: "0 0 0 10px", borderLeft: "2px solid var(--gline2)", display: "grid", gap: 6 }}>
                                {also.map((a) => (
                                    <li key={a.id} style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--txt2)", overflowWrap: "anywhere" }}>
                                        <span style={{ color: "var(--txt4)" }}>{a.source}{a.at ? ` · ${whenOf(a)}` : ""} · </span>{a.headline}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                <div style={{ display: "flex", gap: 22, marginTop: 8, alignItems: "center", fontSize: 13 }}>
                    {Number.isFinite(+it.lat) && it.lat !== null && (
                        <button onClick={() => onMap?.(it)} style={ACT}>On the map</button>
                    )}
                    {it.url && !it.x_url && <SourceLink url={it.url} style={{ ...ACT, color: "var(--txt3)", textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Original</SourceLink>}
                    {onShare && <button onClick={() => onShare(it)} style={ACT}>Share</button>}
                </div>
            </div>
        </article>
    )
}
const ACT = { border: 0, background: "none", padding: 0, minHeight: 30, color: "var(--txt3)", font: "inherit", fontSize: 13, cursor: "pointer",
              display: "inline-flex", alignItems: "center", lineHeight: 1 }

export default function GeneralFeed({ onMap, onShare, compact = false, keep = null }) {
    const [kind, setKind] = useState("all")
    const [items, setItems] = useState(null)
    const [next, setNext] = useState(null)
    const [fresh, setFresh] = useState([])           // arrived since, offered at the top
    const [loading, setLoading] = useState(false)
    const sentinel = useRef(null)
    const kinds = kind === "all" ? "signal,geoconfirmed,telegram" : kind

    const get = (before) => fetch(`${API_BASE}/api/general?limit=30&kinds=${kinds}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { items: [], next: null }))

    useEffect(() => {
        let live = true
        setItems(null); setFresh([])
        get().then((d) => { if (live) { setItems(dropStaleDemos(d.items || [])); setNext(d.next) } }).catch(() => live && setItems([]))
        return () => { live = false }
    }, [kinds]) // eslint-disable-line react-hooks/exhaustive-deps

    // THE NEWEST, ALWAYS (owner, 2026-10-18: "signals 2 hours old as the
    // latest on the desk is impossible"): every 20 s, and the moment the app
    // comes back to the screen (a phone pauses timers while it is away), what
    // arrived goes straight in at the top when the reader is at the top;
    // only someone reading further down is offered it instead of having the
    // list moved under them.
    const root = useRef(null)
    const itemsRef = useRef(items)
    itemsRef.current = items
    const freshRef = useRef(fresh)
    freshRef.current = fresh
    useEffect(() => {
        if (!items) return undefined
        const atTop = () => {
            let n = root.current?.parentElement
            while (n && n !== document.body) { if (n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n.scrollTop < 120; n = n.parentElement }
            return (window.scrollY || 0) < 120
        }
        const check = () => {
            if (document.visibilityState === "hidden") return
            get().then((d) => {
                const have = shownIds([...(itemsRef.current || []), ...freshRef.current])
                const nw = (d.items || []).filter((x) => !have.has(x.id))
                if (!nw.length) return
                if (atTop()) { setItems((cur) => [...nw, ...freshRef.current, ...(cur || [])]); setFresh([]) }
                else setFresh((f) => [...nw, ...f])
            }).catch(() => {})
        }
        const t = setInterval(check, 20_000)
        const vis = () => { if (document.visibilityState === "visible") check() }
        document.addEventListener("visibilitychange", vis)
        window.addEventListener("focus", vis)
        window.addEventListener("m2:refresh", check)
        return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", vis); window.removeEventListener("m2:refresh", check) }
    }, [items === null]) // eslint-disable-line react-hooks/exhaustive-deps

    const more = useCallback(() => {
        if (!next || loading) return
        setLoading(true)
        get(next).then((d) => {
            // an event already shown (as itself or as one of a card's other
            // reports) is not shown again on the next page
            setItems((cur) => { const have = shownIds(cur); return [...(cur || []), ...dropStaleDemos(d.items || []).filter((x) => !have.has(x.id))] })
            setNext(d.next)
        }).finally(() => setLoading(false))
    }, [next, loading]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const el = sentinel.current
        if (!el || typeof IntersectionObserver === "undefined") return undefined
        // one page at a time, and only once the reader has scrolled: media
        // still loading leaves the list short, and the sentinel would otherwise
        // stay in view and pull page after page
        let scrolled = false
        const onScroll = () => { scrolled = true }
        window.addEventListener("scroll", onScroll, { capture: true, passive: true })
        const io = new IntersectionObserver((es) => { if (scrolled && es.some((e) => e.isIntersecting)) { scrolled = false; more() } }, { rootMargin: "400px" })
        io.observe(el)
        return () => { io.disconnect(); window.removeEventListener("scroll", onScroll, { capture: true }) }
    }, [more])

    return (
        <div data-testid="general-feed" ref={root}>
            <div role="tablist" style={{ display: "flex", gap: 6, padding: compact ? "0 0 6px" : "4px 0 8px", flexWrap: "wrap" }}>
                {FILTERS.map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
                            style={{ height: 30, padding: "0 13px", borderRadius: 15, border: `1px solid ${kind === k ? "var(--acchi)" : "var(--gline2)"}`,
                                     background: kind === k ? "var(--accdim)" : "transparent", color: kind === k ? "var(--txt)" : "var(--txt2)",
                                     font: "inherit", fontSize: 13, cursor: "pointer", transition: "background .18s ease, border-color .18s ease" }}>{l}</button>
                ))}
            </div>
            {fresh.length > 0 && (
                <button onClick={() => { setItems((cur) => [...fresh, ...(cur || [])]); setFresh([]) }}
                        style={{ display: "block", margin: "6px auto 2px", height: 32, padding: "0 16px", borderRadius: 16, border: 0, background: "var(--acc, #3d7bf0)",
                                 color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", animation: "plx-fade-in .25s ease" }}>
                    {fresh.length} new
                </button>
            )}
            {items === null ? <div style={{ padding: "20px 0", color: "var(--txt3)", fontSize: 13 }}>Reading what is happening…</div>
                : !items.length ? <div style={{ padding: "20px 0", color: "var(--txt3)", fontSize: 13 }}>Nothing in this window.</div>
                : (keep ? items.filter(keep) : items).map((it) => <GeneralItem key={it.id} it={it} onMap={onMap} onShare={onShare} compact={compact} />)}
            <div ref={sentinel} style={{ height: 1 }} />
            {loading && <div style={{ padding: 14, textAlign: "center", color: "var(--txt4)", fontSize: 12.5 }}>Loading more…</div>}
        </div>
    )
}
