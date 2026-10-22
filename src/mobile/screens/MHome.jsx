/**
 * MHome.jsx — Home on the phone. The same rules as desktop Home, laid out
 * for a thumb:
 *
 *   Most urgent for you   signals near the user's assets, then the most
 *                         severe in their theaters and interests; every 30 s
 *   Live footage          the newest Telegram videos from every chat, street
 *                         reports and self-reported positions, one card per
 *                         video, swiped sideways; every 20 s (home/LiveFootage)
 *   The brief            what happened (overnight / this morning / this
 *                         afternoon) and what may follow, the user's first;
 *                         both turn at 05, 12 and 18 (home/dayPart.js)
 */
import { LiveNow } from "../../telegram/LivePlayer.jsx"
import { useEffect, useMemo, useRef, useState } from "react"
import LiveFootage from "../../home/LiveFootage.jsx"
import { slotOf, useFrozen } from "../../home/dayPart.js"
import { getCurrentUser, subscribeAuth } from "../../state/authStore.js"
import { greetingFor } from "../../data/greetings.js"
import { useMine, usePoll, arr } from "../useMine.js"
import { Row, ScopeChips, Sheet, SignalSheet, sevColor, when, ago, Icon } from "./common.jsx"
import { inTheater, setTheaterScope, useTheaterScope } from "../theaterScope.js"
import OutlookExplain from "../../insight/OutlookExplain.jsx"
import { attachPullToRefresh } from "../gesture.js"
import { relevance } from "../../state/interests.js"
import { hmZone } from "../../utils/clock.js"
import { getSettings, subscribeSettings } from "../../state/settingsStore.js"

function useHere() {
    const [h, setH] = useState(() => getSettings()?.interests?.here || null)
    useEffect(() => subscribeSettings((st) => setH(st?.interests?.here || null)), [])
    return h
}
import { devicePosition, saveHere } from "../../components/LocationPrompt.jsx"
import { dropStaleDemos } from "../../globe/freshness.js"

const SEVR = { critical: 0, significant: 1, high: 1, elevated: 2, moderate: 2, medium: 2, low: 3 }

export default function MHome({ onShowOnMap, onOpen }) {
    const mine = useMine()
    const [user, setUser] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setUser), [])
    const seed = useRef(Math.floor(Math.random() * 997)).current
    const surface = usePoll("/api/surface", 30_000, (d) => arr(d?.items ?? d))
    const notes = usePoll("/api/notifications?limit=40", 30_000, (d) => dropStaleDemos(arr(d?.items ?? d)))
    // Telegram's located posts, for "For you" (the footage strip reads its own)
    const posts = usePoll("/api/telegram/posts?hours=48", 30_000, (d) => dropStaleDemos(arr(d?.posts)))
    const outlook = usePoll("/api/enrich/outlook", 20 * 60_000)
    const [open, setOpen] = useState(null)
    const [why, setWhy] = useState(null)               // a line of the outlook, opened on its reasoning
    const slot = slotOf(new Date())
    const split = useMemo(() => mine.split(surface || []), [surface, mine.w]) // eslint-disable-line react-hooks/exhaustive-deps

    // FOR YOU, FROM EVERY SOURCE (owner, 2026-10-17: "'for you' is everything
    // from GDELT; it should be independent of whether it's GDELT, Telegram,
    // whatever"): what the server judged relevant to you (the notification
    // feed, every kind — escalations, confirmed events, Telegram, fusion,
    // your assets), plus Telegram posts and news in your theaters and
    // interests; one row per headline, assets first, then severity, then time.
    const tgMine = useMemo(() => mine.split(arr(posts).filter((x) => Number.isFinite(+x.lat)).map((x) => ({
        ...x, headline: x.headline || String(x.summary_en || x.text || "").slice(0, 140), published_at: x.event_time || x.posted_at,
        source: `Telegram · ${x.channel_title || x.channel}`, location: x.place }))).mine, [posts, mine.w]) // eslint-disable-line react-hooks/exhaustive-deps
    const urgent = useMemo(() => {
        const fromFeed = arr(notes).map((n) => ({ ...n, headline: n.title, severity_tier: n.sev, published_at: n.created_at, _asset: n.kind === "asset", _why: n.reason }))
        const seen = new Set()
        return [...fromFeed, ...tgMine, ...split.mine]
            .filter((x) => { const t = String(x.headline || x.title || "").trim().toLowerCase(); if (!t || seen.has(t)) return false; seen.add(t); return true })
            .sort((a, b) => (b._asset ? 1 : 0) - (a._asset ? 1 : 0) || (SEVR[a.severity_tier] ?? 9) - (SEVR[b.severity_tier] ?? 9)
                || String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || "")))
            .slice(0, 8)
    }, [notes, split, tgMine])

    const happenedNow = useMemo(() => {
        const base = mine.has ? split.mine : arr(surface)
        return [...base].filter((x) => !x.published_at || Date.parse(x.published_at) >= slot.since - 6 * 3600_000)
            .sort((a, b) => (SEVR[a.severity_tier] ?? 9) - (SEVR[b.severity_tier] ?? 9) || String(b.published_at || "").localeCompare(String(a.published_at || "")))
            .slice(0, 5)
    }, [surface, split, mine.has, slot.since]) // eslint-disable-line react-hooks/exhaustive-deps
    const happened = useFrozen(`m-happened:${slot.key}`, happenedNow, (a) => mine.ready && a.length > 0)

    const aheadNow = useMemo(() => {
        const names = [...mine.w.countries.keys()].map((c) => String(c).toLowerCase())
        const isMine = (o) => names.some((c) => `${o.place || ""} ${o.statement || ""}`.toLowerCase().includes(c))
        return [...arr(outlook?.outlook)].sort((a, b) => isMine(b) - isMine(a)).slice(0, 4)
    }, [outlook, mine.w])
    const ahead = useFrozen(`m-ahead:${slot.key}`, aheadNow, (a) => mine.ready && a.length > 0)

    // FOR YOU: what is near you, your assets and in your theaters, each with why
    const here = useHere()
    // the theater you are looking at, when one is chosen (mobile/theaterScope.js)
    const scope = useTheaterScope()
    const scopeT = mine.theaters.find((t) => t.id === scope) || null
    const inScope = useMemo(() => inTheater(scopeT, mine.countries, mine.iso2Name), [scopeT, mine.countries, mine.iso2Name])
    const forYou = useMemo(() => urgent.filter(inScope).map((u) => ({ ...u, _why: u._why || relevance(u, mine.w).reason || null })).slice(0, 6), [urgent, mine.w, inScope])
    const worldwide = useMemo(() => forYou.length ? [] : [...arr(surface)].sort((a, b) => (SEVR[a.severity_tier] ?? 9) - (SEVR[b.severity_tier] ?? 9)
        || String(b.published_at || "").localeCompare(String(a.published_at || ""))).slice(0, 4), [forYou, surface])
    const iosBrowser = (() => { try { const { platform } = window.__plxClosedNotify || {}; return platform === "ios-browser" } catch { return false } })()
        || (typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia?.("(display-mode: standalone)").matches)
    const askHere = async () => {
        const asked = devicePosition()          // inside the tap, before any await (location/geo.js)
        try { const p = await asked; await saveHere(p.lat, p.lon, p.label || null) } catch (e) { window.alert(e.message) }
    }
    // PULLED DOWN FROM THE TOP: a short pull refreshes; thrown down hard,
    // Home slides away to the bottom and the map behind it is the screen
    // (owner, 2026-10-17: "swipe down very strongly … the map becomes visible")
    const scroller = useRef(null)
    useEffect(() => attachPullToRefresh(scroller.current, {
        onRefresh: () => new Promise((r) => { window.dispatchEvent(new CustomEvent("m2:refresh")); setTimeout(r, 700) }),
        onPull: ({ dy, vy }) => {
            if (!(dy > 190 || (dy > 90 && vy > 1.1))) return false
            const pane = scroller.current?.closest(".m2-pane")
            if (pane) {
                pane.style.transition = "transform .42s cubic-bezier(.3,.7,.3,1), opacity .42s ease"
                pane.style.transform = "translateY(100%)"
                pane.style.opacity = "0.4"
            }
            setTimeout(() => { if (pane) { pane.style.transition = ""; pane.style.transform = ""; pane.style.opacity = "" } onOpen?.("map") }, 400)
            return true
        },
    }), []) // eslint-disable-line react-hooks/exhaustive-deps
    const first = String(user?.name || user?.display_name || "").split(" ")[0]
    const greet = greetingFor(first, { seed })
    return (
        <div ref={scroller} className="m2-scroll" data-screen-label="Phone home">
            {/* WHO AND WHERE YOU ARE, then what is yours — the first thing you see */}
            <div className="m2-hero">
                {user?.avatar
                    ? <img className="m2-avatar" src={user.avatar} alt="" style={{ objectPosition: user.avatar_pos || "50% 50%" }} />
                    : <span className="m2-avatar" style={{ background: "#2a2e36", color: "var(--txt2)" }}>{user?.initials || "?"}</span>}
                <div style={{ alignSelf: "end" }} className="m2-eyebrow">{greet.kicker}</div>
                <h1 style={{ alignSelf: "start" }}>{greet.lead}</h1>
                <span className="m2-sub">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · {hmZone(new Date())}</span>
                <button className="m2-here" onClick={() => (here ? onShowOnMap?.({ lat: here.lat, lon: here.lon }) : askHere())}>
                    <span className="m2-here-dot" />
                    {here ? (String(here.label || "Your location").split(",").slice(-2).join(",").trim()) : "Use my location"}
                </button>
                <AlertsOffer />
                {iosBrowser && (
                    <div className="m2-ios" data-testid="m2-ios-push">
                        <span style={{ fontSize: 20, lineHeight: 1 }}>🔔</span>
                        <span><b style={{ color: "var(--txt)" }}>Alerts on your iPhone.</b> Apple sends web alerts only to apps on the Home Screen: tap
                            <b> Share</b> <span aria-hidden>⎋</span>, then <b>Add to Home Screen</b>, open Parallax from there and turn on alerts in Profile.</span>
                    </div>
                )}
            </div>

            <div className="m2-h" style={{ marginTop: 4 }}>{forYou.length ? "For you" : mine.has || here ? "Nothing near you — the most severe worldwide" : "Most severe right now"}</div>
            <ScopeChips theaters={mine.theaters} scope={scopeT ? scope : null} onPick={setTheaterScope} />
            <div className="m2-foryou" data-testid="m2-foryou">
                {(forYou.length ? forYou : worldwide).map((u) => (
                    <button key={u.id ?? u.title} className="m2-fy" onClick={() => setOpen({ ...u, _whyMine: u._why || u.reason || null })}>
                        <span style={{ minWidth: 0 }}>
                            <b>{u.headline || u.title}</b>
                            <small>{[u._why || String(u.location || u.place || "").split(",").slice(0, 2).join(","), String(u.source || "").replace(/^news_event$/, "News")].filter(Boolean).join(" · ")}</small>
                        </span>
                        <span className="m2-when"><i className="m2-sev" style={{ background: sevColor(u.severity_tier || u.sev) }} />{ago(u.published_at || u.created_at || u.posted_at)}</span>
                    </button>
                ))}
                {!forYou.length && !worldwide.length && <div className="m2-empty">{surface === null ? "Loading…" : "Nothing reported right now."}</div>}
                {!mine.has && !here && (
                    <div className="m2-sub" style={{ margin: "2px 2px 0", fontSize: 13 }}>
                        Share your location, or add a theater or an asset, and this shows what concerns you first.
                    </div>
                )}
            </div>
            <button className="m2-cta" onClick={() => onOpen?.("map")} data-testid="m2-open-map"><Icon id="g-globe" size={22} />Open the map</button>

            <LiveNow compact />
            {/* ONE STRIP OF FOOTAGE (owner, 2026-10-18), in place of Live from
                Telegram and From the ground: the newest videos, swiped sideways */}
            <LiveFootage variant="phone" onShowOnMap={(x) => onShowOnMap?.({
                lat: +x.lat, lon: +x.lon, headline: x.caption, title: x.caption, location: x.place,
                source: `Telegram · ${x.channel_title || x.channel}`, url: x.url })} />

            <section className="m2-section" data-screen-label="Phone brief">
                <header><span className="m2-eyebrow">{slot.happened}</span></header>
                <div className="m2-card">
                    {happened.length === 0 ? <div className="m2-empty">{surface === null ? "Loading…" : "Quiet in your areas since the last turn."}</div>
                        : happened.map((s) => <Row key={s.id ?? s.headline} s={s} title={s.headline || s.title} sub={[s.location, s.source].filter(Boolean).join(" · ")}
                            when={when(s.published_at)} onClick={() => setOpen(s)} />)}
                </div>
            </section>

            <section className="m2-section">
                <header><span className="m2-eyebrow">{slot.ahead}</span></header>
                <div className="m2-card">
                    {ahead.length === 0 ? <div className="m2-empty">{outlook === null ? "Loading…" : "Nothing specific enough to forecast right now."}</div>
                        : ahead.map((o, i) => (
                            <button key={i} className="m2-ahead" onClick={() => setWhy(o)}>
                                <b style={{ fontVariantNumeric: "tabular-nums" }}>{o.probability}%</b>
                                <span style={{ minWidth: 0 }}>
                                    <span className="m2-t">{[o.place, o.statement].filter(Boolean).join(" · ")}</span>
                                    <span className="m2-sub">{[o.because, o.resolves_by && `by ${o.resolves_by}`].filter(Boolean).join(" · ")}</span>
                                </span>
                            </button>
                        ))}
                </div>
            </section>

            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
            {why && (
                <Sheet onClose={() => setWhy(null)}>
                    <OutlookExplain o={why} onShowPlace={(c) => { setWhy(null); onShowOnMap?.({ lat: c.lat, lon: c.lon, headline: c.headline, title: c.headline, location: c.location, source: c.source, url: c.url }) }} />
                </Sheet>
            )}
        </div>
    )
}


/** ONCE, ON THE PHONE APP: turn on alerts. iPhone shows the permission
 *  prompt only from a tap, so it is a button — on Home, where it is seen,
 *  not only in Settings. Gone when alerts are on, blocked, or dismissed. */
function AlertsOffer() {
    const [st, setSt] = useState(null)
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState(null)
    const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("m2.alertsOffer") === "no" } catch { return false } })
    useEffect(() => { import("../../notify/closedNotifications.js").then((m) => m.closedNotifyStatus()).then(setSt).catch(() => {}) }, [])
    if (hidden || !st || st.platform !== "web" || st.on || st.blocked) return null
    const on = async () => {
        setBusy(true); setMsg(null)
        const m = await import("../../notify/closedNotifications.js")
        const r = await m.enableClosedNotify()
        setBusy(false)
        if (r.ok) { setSt({ ...st, on: true }); return }
        setMsg(r.error === "blocked" ? "Alerts are blocked for Parallax — allow them in the phone's Settings › Notifications." : `Not turned on: ${r.error}`)
    }
    return (
        <div className="m2-ios" data-testid="m2-alerts-offer">
            <span style={{ fontSize: 20, lineHeight: 1 }}>🔔</span>
            <span style={{ flex: 1 }}>
                <b style={{ color: "var(--txt)" }}>Get alerts on this phone</b> — what concerns you, even with Parallax closed.
                {msg && <span style={{ display: "block", marginTop: 4, color: "var(--txt)" }}>{msg}</span>}
                <span style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="m2-btn" style={{ height: 34, borderRadius: 17 }} disabled={busy} onClick={on}>{busy ? "Turning on…" : "Turn on alerts"}</button>
                    <button className="m2-btn ghost" style={{ height: 34, borderRadius: 17 }} onClick={() => { try { localStorage.setItem("m2.alertsOffer", "no") } catch { /* private */ } setHidden(true) }}>Not now</button>
                </span>
            </span>
        </div>
    )
}
