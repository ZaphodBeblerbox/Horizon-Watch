/**
 * LiveFootage.jsx — Home's one strip of Telegram footage, on the phone and
 * the desktop (owner, 2026-10-18: "'Live from Telegram' and 'From the
 * ground' should just be replaced by one unified feed I can swipe sideways
 * to show the latest Telegram videos").
 *
 * The newest videos first (pictures after them only while videos are few),
 * one card per video however many chats carried it: its still with a play
 * mark and its length, how long ago and in which chat, one line in English,
 * the place when known, and a quiet "on the ground" for footage from street
 * reports and self-reported positions. A tap opens it full screen
 * (mobile/MediaViewer.jsx), where a sideways swipe goes on to the next, and
 * "Show on map" takes you to its place.
 *
 * FRESH: read every 20 s and the moment the app is back on screen. New
 * cards slide in at the start only while the strip is at its start; scrolled
 * along, nothing moves under the thumb and a small "N new" pill waits.
 *
 * Phone: native scroll-snap (.m2-hscroll, which the phone's own swipes
 * leave alone). Desktop: arrow buttons, the trackpad, and shift + wheel.
 * Nothing is downloaded here: the stills are the server's thumbnails, and a
 * video is fetched only when opened.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { openMedia } from "../mobile/MediaViewer.jsx"
import { videoSrc, warnFor } from "../components/TelegramMedia.jsx"
import { agoLabel } from "../utils/formatTime.js"
import { dedupe, durLabel, footageFromPosts, order, reconcile, shortPlace } from "./liveFootage.js"
import "./liveFootage.css"

export const POLL_MS = 20_000
const abs = (u) => (!u ? null : /^https?:/.test(u) ? u : `${API_BASE}${u}`)
const arr = (v) => (Array.isArray(v) ? v : [])
const getJSON = (p) => fetch(`${API_BASE}${p}`, { credentials: "include" })

/** The strip's items, every 20 s and on return; null until the first answer. */
export function useLiveFootage(everyMs = POLL_MS, enabled = true) {
    const [items, setItems] = useState(null)
    useEffect(() => {
        if (!enabled) return undefined
        let live = true
        let merged = false              // the server has no /footage yet: merge here
        let busy = false
        const load = async () => {
            if (busy || (typeof document !== "undefined" && document.visibilityState === "hidden")) return
            busy = true
            try {
                if (!merged) {
                    const r = await getJSON("/api/telegram/footage")
                    if (r.status === 404) merged = true
                    else if (r.ok) { const d = await r.json(); if (live && d) setItems(order(dedupe(arr(d.items)))); return }
                    else return
                }
                const [a, b] = await Promise.all([
                    getJSON("/api/telegram/feed?limit=60").then((r) => (r.ok ? r.json() : null)).catch(() => null),
                    getJSON("/api/telegram/posts?hours=48").then((r) => (r.ok ? r.json() : null)).catch(() => null),
                ])
                if (live && (a || b)) setItems(footageFromPosts(arr(a?.posts), arr(b?.posts)))
            } catch { /* a failed poll keeps what is on screen */ } finally { busy = false }
        }
        load()
        const t = setInterval(load, everyMs)
        const vis = () => { if (document.visibilityState === "visible") load() }
        document.addEventListener("visibilitychange", vis)
        window.addEventListener("focus", vis)
        window.addEventListener("m2:refresh", load)         // the phone's pull to refresh
        return () => {
            live = false; clearInterval(t)
            document.removeEventListener("visibilitychange", vis)
            window.removeEventListener("focus", vis)
            window.removeEventListener("m2:refresh", load)
        }
    }, [everyMs, enabled])
    return items
}

const AT_START = 8

/**
 * The strip itself. `variant`: "phone" | "desk". `onShowOnMap(item)` takes
 * the reader to a card's place (only offered when it has one). `items`
 * overrides the poll (tests).
 */
export default function LiveFootage({ variant = "phone", onShowOnMap = null, items: given = undefined }) {
    const polled = useLiveFootage(POLL_MS, given === undefined)
    const latest = given !== undefined ? given : polled
    const [shown, setShown] = useState([])
    const [pending, setPending] = useState(0)
    const [fresh, setFresh] = useState(() => new Set())
    const [revealed, setRevealed] = useState(() => new Set())
    const [edges, setEdges] = useState({ prev: false, next: false })
    const strip = useRef(null)
    const shownRef = useRef(shown); shownRef.current = shown
    const latestRef = useRef(latest); latestRef.current = latest
    const [, tick] = useState(0)
    useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [])

    const atStart = () => !strip.current || strip.current.scrollLeft <= AT_START
    const apply = (atS) => {
        const r = reconcile(shownRef.current, arr(latestRef.current), atS)
        setShown(r.shown); setPending(r.pending)
        if (r.fresh.length) setFresh(new Set(r.fresh))
    }
    useEffect(() => { if (latest) apply(atStart()) }, [latest]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!fresh.size) return undefined; const t = setTimeout(() => setFresh(new Set()), 700); return () => clearTimeout(t) }, [fresh])

    const measure = () => {
        const el = strip.current
        if (!el) return
        setEdges({ prev: el.scrollLeft > AT_START, next: el.scrollLeft + el.clientWidth < el.scrollWidth - AT_START })
    }
    useEffect(measure, [shown])
    const onScroll = () => {
        measure()
        // back at the start by hand: what was waiting comes in
        if (pending > 0 && atStart()) apply(true)
    }
    const toStart = () => {
        strip.current?.scrollTo?.({ left: 0, behavior: "smooth" })
        apply(true)
    }
    const page = (dir) => {
        const el = strip.current
        if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" })
    }

    // SHIFT + WHEEL on the desktop: a mouse wheel scrolls the strip sideways.
    useEffect(() => {
        const el = strip.current
        if (!el || variant !== "desk") return undefined
        const wheel = (e) => {
            if (!e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
            el.scrollLeft += e.deltaY
            e.preventDefault()
        }
        el.addEventListener("wheel", wheel, { passive: false })
        return () => el.removeEventListener("wheel", wheel)
    }, [variant, shown.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

    const cardEl = (id) => [...(strip.current?.querySelectorAll("[data-lf-id]") || [])].find((n) => n.getAttribute("data-lf-id") === String(id)) || null
    const open = (it) => {
        const list = shown.filter((x) => !warnFor(x) || revealed.has(x.id))
        const index = list.findIndex((x) => x.id === it.id)
        if (index < 0) return
        const meta = (x) => [agoLabel(x.posted_at), x.channel_title, shortPlace(x.place)].filter(Boolean).join(" · ")
        openMedia({
            index,
            list: list.map((x) => ({
                src: x.media === "video" ? videoSrc(x) : abs(x.thumb_url), type: x.media === "video" ? "video" : "image",
                poster: abs(x.thumb_url), fromEl: () => cardEl(x.id)?.querySelector("img"),
                title: x.caption, meta: meta(x), ground: x.on_ground,
                onMap: onShowOnMap && Number.isFinite(+x.lat) && x.lat !== null ? () => onShowOnMap(x) : null,
            })),
            // swiped on in the viewer: its card comes into view, so closing flies back to it
            onIndex: (i) => { const c = cardEl(list[i]?.id); if (c && strip.current) strip.current.scrollLeft = Math.max(0, c.offsetLeft - strip.current.offsetLeft - 14) },
        })
    }
    const tap = (it) => {
        if (warnFor(it) && !revealed.has(it.id)) { setRevealed((s) => new Set([...s, it.id])); return }
        open(it)
    }

    if (latest === null && !shown.length) {
        return (
            <section className={`lf ${variant}${variant === "phone" ? " m2-section" : ""}`} data-screen-label="Live footage" data-testid="live-footage">
                <Head variant={variant} />
                <div className="lf-empty">Loading…</div>
            </section>
        )
    }
    if (!shown.length) return null
    return (
        <section className={`lf ${variant}${variant === "phone" ? " m2-section" : ""}`} data-screen-label="Live footage" data-testid="live-footage">
            <Head variant={variant} n={shown.length}>
                {variant === "desk" && (
                    <span className="lf-arrows">
                        <button aria-label="Newer" disabled={!edges.prev} onClick={() => page(-1)}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
                        </button>
                        <button aria-label="Older" disabled={!edges.next} onClick={() => page(1)}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </span>
                )}
            </Head>
            <div className="lf-wrap">
                {pending > 0 && (
                    <button className="lf-pill" onClick={toStart} data-testid="lf-new-pill">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
                        {pending} new
                    </button>
                )}
                <div ref={strip} className={`lf-strip${variant === "phone" ? " m2-hscroll" : ""}`} onScroll={onScroll} data-testid="lf-strip">
                    {shown.map((it) => {
                        const blur = warnFor(it) && !revealed.has(it.id)
                        const dur = it.media === "video" ? durLabel(it.duration) : null
                        const place = shortPlace(it.place)
                        const ago = agoLabel(it.posted_at)
                        return (
                            <article key={it.id} data-lf-id={it.id} className={`lf-card${fresh.has(it.id) ? " lf-new" : ""}`}>
                                <button className="lf-media" onClick={() => tap(it)} aria-label={blur ? "Show sensitive footage" : `Open ${it.media === "video" ? "video" : "picture"}`}>
                                    {it.thumb_url && <img src={abs(it.thumb_url)} alt="" loading="lazy" draggable={false} className={blur ? "blur" : ""} />}
                                    {blur
                                        ? <span className="lf-warn">Sensitive · tap to show</span>
                                        : it.media === "video" && <span className="lf-play" aria-hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></span>}
                                    {dur && !blur && <span className="lf-dur">{dur}</span>}
                                    {it.on_ground && <span className="lf-ground" title={it.ground_kind === "position" ? "Posted by people there, saying where they are" : "From a street report"}>
                                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="10" r="3" /><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /></svg>
                                        on the ground</span>}
                                </button>
                                <button className="lf-text" onClick={() => tap(it)}>
                                    <span className="lf-meta"><b>{ago}</b><span>{it.channel_title}{it.also_in?.length ? ` +${it.also_in.length}` : ""}</span></span>
                                    <span className="lf-cap">{it.caption || "Footage"}</span>
                                    {place && <span className="lf-place">{place}</span>}
                                </button>
                                {variant === "desk" && place && onShowOnMap && Number.isFinite(+it.lat) && it.lat !== null && (
                                    <button className="lf-map" onClick={() => onShowOnMap(it)}>Show on map</button>
                                )}
                            </article>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}

function Head({ variant, n = 0, children = null }) {
    return (
        <header className="lf-head">
            <span className={variant === "phone" ? "m2-eyebrow" : "lf-title"}>Live footage</span>
            <span className={variant === "phone" ? "m2-when" : "lf-sub"}>{n ? "newest first · every 20 s" : ""}</span>
            <span style={{ flex: 1 }} />
            {children}
        </header>
    )
}
