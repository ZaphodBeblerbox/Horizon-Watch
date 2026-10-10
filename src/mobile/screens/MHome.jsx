/**
 * MHome.jsx — Home on the phone. The same rules as desktop Home, laid out
 * for a thumb:
 *
 *   Most urgent for you   signals near the user's assets, then the most
 *                         severe in their theaters and interests; every 30 s
 *   From the ground       the three most breaking places for them, on
 *                         video (Telegram, 48 h, one per place) — swipe
 *   The brief             what happened (overnight / this morning / this
 *                         afternoon) and what may follow, the user's first;
 *                         both turn at 05, 12 and 18 (home/dayPart.js)
 */
import { LiveNow } from "../../telegram/LivePlayer.jsx"
import { useEffect, useMemo, useRef, useState } from "react"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import { slotOf, useFrozen } from "../../home/dayPart.js"
import { getCurrentUser, subscribeAuth } from "../../state/authStore.js"
import { greetingFor } from "../../data/greetings.js"
import { useMine, usePoll, arr } from "../useMine.js"
import { Row, SignalSheet, sevColor, when, ago, Icon } from "./common.jsx"
import { relevance } from "../../state/interests.js"
import { hmZone } from "../../utils/clock.js"
import { getSettings, subscribeSettings } from "../../state/settingsStore.js"

function useHere() {
    const [h, setH] = useState(() => getSettings()?.interests?.here || null)
    useEffect(() => subscribeSettings((st) => setH(st?.interests?.here || null)), [])
    return h
}
import API_BASE from "../../apiBase.js"

const SEVR = { critical: 0, significant: 1, high: 1, elevated: 2, moderate: 2, medium: 2, low: 3 }
const HARD = { strike: 0, attack: 0, explosion: 0, clash: 1, interception: 1, unrest: 2 }

function km(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h))
}

export default function MHome({ onShowOnMap, onOpen }) {
    const mine = useMine()
    const [user, setUser] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setUser), [])
    const seed = useRef(Math.floor(Math.random() * 997)).current
    const surface = usePoll("/api/surface", 30_000, (d) => arr(d?.items ?? d))
    const notes = usePoll("/api/notifications?limit=40", 30_000, (d) => arr(d?.items ?? d))
    const posts = usePoll("/api/telegram/posts?hours=48", 10 * 60_000, (d) => arr(d?.posts))
    const outlook = usePoll("/api/enrich/outlook", 20 * 60_000)
    const [open, setOpen] = useState(null)
    const slot = slotOf(new Date())
    const split = useMemo(() => mine.split(surface || []), [surface, mine.w]) // eslint-disable-line react-hooks/exhaustive-deps

    const urgent = useMemo(() => {
        const fromAssets = arr(notes).filter((n) => n.kind === "asset").map((n) => ({ ...n, headline: n.title, severity_tier: n.sev, _asset: true }))
        const seen = new Set()
        return [...fromAssets, ...split.mine]
            .filter((x) => { const t = x.headline || x.title; if (!t || seen.has(t)) return false; seen.add(t); return true })
            .sort((a, b) => (b._asset ? 1 : 0) - (a._asset ? 1 : 0) || (SEVR[a.severity_tier] ?? 9) - (SEVR[b.severity_tier] ?? 9)
                || String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || "")))
            .slice(0, 6)
    }, [notes, split])

    const pick = useMemo(() => {
        const vids = arr(posts).filter((x) => x.media === "video" && Number.isFinite(+x.lat))
        const yours = new Set(mine.split(vids).mine.map((m) => m.id))
        const ranked = [...vids].sort((a, b) => (yours.has(b.id) - yours.has(a.id)) || ((a.graphic ? 1 : 0) - (b.graphic ? 1 : 0))
            || ((SEVR[a.severity_tier] ?? 4) - (SEVR[b.severity_tier] ?? 4)) || ((HARD[a.event_type] ?? 3) - (HARD[b.event_type] ?? 3))
            || String(b.posted_at || "").localeCompare(String(a.posted_at || "")))
        const out = []
        for (const v of ranked) {
            if (out.some((o) => km({ lat: +o.lat, lon: +o.lon }, { lat: +v.lat, lon: +v.lon }) < 30)) continue
            out.push({ ...v, _mine: yours.has(v.id) })
            if (out.length === 3) break
        }
        return out
    }, [posts, mine.w]) // eslint-disable-line react-hooks/exhaustive-deps
    const videos = useFrozen(`m-ground:${slot.key}`, pick, (a) => mine.ready && a.length > 0 && a.length >= Math.min(3, pick.length))

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

    // LE DIRECT: the newest Telegram posts, a swipe away.
    const live = usePoll("/api/telegram/feed?limit=12", 2 * 60_000, (d) => arr(d?.posts))

    // FOR YOU: what is near you, your assets and in your theaters, each with why
    const here = useHere()
    const forYou = useMemo(() => urgent.map((u) => ({ ...u, _why: u._asset ? u.reason : relevance(u, mine.w).reason || u._why })).slice(0, 5), [urgent, mine.w])
    const worldwide = useMemo(() => forYou.length ? [] : [...arr(surface)].sort((a, b) => (SEVR[a.severity_tier] ?? 9) - (SEVR[b.severity_tier] ?? 9)
        || String(b.published_at || "").localeCompare(String(a.published_at || ""))).slice(0, 4), [forYou, surface])
    const iosBrowser = (() => { try { const { platform } = window.__plxClosedNotify || {}; return platform === "ios-browser" } catch { return false } })()
        || (typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone && !window.matchMedia?.("(display-mode: standalone)").matches)
    const askHere = async () => {
        try { const { devicePosition, saveHere } = await import("../../components/LocationPrompt.jsx"); const p = await devicePosition(); await saveHere(p.lat, p.lon) } catch { /* not allowed */ }
    }
    const first = String(user?.name || user?.display_name || "").split(" ")[0]
    const greet = greetingFor(first, { seed })
    return (
        <div className="m2-scroll" data-screen-label="Phone home">
            {/* WHO AND WHERE YOU ARE, then what is yours — the first thing you see */}
            <div className="m2-hero">
                {user?.avatar
                    ? <img className="m2-avatar" src={user.avatar} alt="" style={{ objectPosition: user.avatar_pos || "50% 50%" }} />
                    : <span className="m2-avatar" style={{ background: user?.color || "#334" }}>{user?.initials || "?"}</span>}
                <div style={{ alignSelf: "end" }} className="m2-eyebrow">{greet.kicker}</div>
                <h1 style={{ alignSelf: "start" }}>{greet.lead}</h1>
                <span className="m2-sub">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · {hmZone(new Date())}</span>
                <button className="m2-here" onClick={() => (here ? onShowOnMap?.({ lat: here.lat, lon: here.lon }) : askHere())}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: "#3b8cff", boxShadow: "0 0 8px #3b8cff" }} />
                    {here ? (String(here.label || "Your location").split(",").slice(-2).join(",").trim()) : "Use my location"}
                </button>
                {iosBrowser && (
                    <div className="m2-ios" data-testid="m2-ios-push">
                        <span style={{ fontSize: 20, lineHeight: 1 }}>🔔</span>
                        <span><b style={{ color: "var(--txt)" }}>Alerts on your iPhone.</b> Apple sends web alerts only to apps on the Home Screen: tap
                            <b> Share</b> <span aria-hidden>⎋</span>, then <b>Add to Home Screen</b>, open Parallax from there and turn on alerts in Profile.</span>
                    </div>
                )}
            </div>

            <div className="m2-h" style={{ marginTop: 4 }}>{forYou.length ? "For you" : mine.has || here ? "Nothing near you — the most severe worldwide" : "Most severe right now"}</div>
            <div className="m2-foryou" data-testid="m2-foryou">
                {(forYou.length ? forYou : worldwide).map((u) => (
                    <button key={u.id ?? u.title} className="m2-fy" onClick={() => (u._asset && u.asset_id ? onOpen?.("assets", { asset: u.asset_id }) : setOpen(u))}>
                        <span style={{ minWidth: 0 }}>
                            <b>{u.headline || u.title}</b>
                            <small>{u._why || [String(u.location || u.place || "").split(",").slice(0, 2).join(","), u.source].filter(Boolean).join(" · ")}</small>
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

            <div style={{ padding: "0 16px" }}><LiveNow compact /></div>
            {arr(live).length > 0 && (
                <section className="m2-section" data-screen-label="Phone live">
                    <header><span className="m2-eyebrow">Live from Telegram</span><span className="m2-when" style={{ flex: 1 }}>newest first</span>
                        <button className="m2-chip" onClick={() => { window.__m2DeskTab = "general"; onOpen?.("desk") }}>All posts</button></header>
                    <div className="m2-hscroll m2-live">
                        {arr(live).map((t) => (
                            <button key={t.id} className="m2-card m2-tap" onClick={() => setOpen(t)} style={{ textAlign: "left", padding: 0, cursor: "pointer", width: "72%", height: 236, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                {/* the same top band on every card, so the strip is even:
                                    the picture, or the place on a tint */}
                                {t.media === "video"
                                    ? <span style={{ display: "block", height: 120, overflow: "hidden", background: "#000" }} onClick={(e) => e.stopPropagation()}><TelegramMedia post={t} maxHeight="120px" radius="0" /></span>
                                    : t.thumb_url
                                    ? <img src={`${API_BASE}${t.thumb_url}`} alt="" style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }} />
                                    : <span style={{ height: 120, display: "flex", alignItems: "flex-end", padding: "10px 12px", background: "linear-gradient(160deg, rgba(122,167,255,.16), rgba(122,167,255,.03))",
                                                     fontSize: 17, fontWeight: 650, color: "var(--txt2, #c3c7cf)" }}>{String(t.place || t.channel_title || "Telegram").split(",")[0]}</span>}
                                <span style={{ padding: "10px 12px" }}>
                                    <span className="m2-eyebrow" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ago(t.posted_at)} · {t.channel_title || t.channel}</span>
                                    <span className="m2-t" style={{ marginTop: 4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.headline || String(t.summary_en || t.text || "").slice(0, 160)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            )}
            {videos.length > 0 && (
                <section className="m2-section" data-screen-label="Phone ground">
                    <header><span className="m2-eyebrow">From the ground</span><span className="m2-when">{mine.has ? "for you" : "worldwide"} · renewed {slot.part === "night" ? "tonight" : `this ${slot.part}`}</span></header>
                    <div className="m2-hscroll">
                        {videos.map((v) => (
                            <div key={v.id} className="m2-card" style={{ display: "flex", flexDirection: "column" }}>
                                <TelegramMedia post={v} maxHeight="230px" radius="0" />
                                <button className="m2-tap" onClick={() => setOpen(v)} style={{ textAlign: "left", border: 0, background: "transparent", padding: "10px 12px", cursor: "pointer" }}>
                                    <span className="m2-eyebrow" style={{ color: sevColor(v.severity_tier) }}>{when(v.posted_at)} · {v.channel_title || v.channel}{v._mine ? " · yours" : ""}</span>
                                    <span className="m2-t" style={{ marginTop: 4 }}>{v.headline}</span>
                                    <span className="m2-sub">{String(v.place || "").split(",").slice(0, 2).join(",")}</span>
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

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
                            <button key={i} className="m2-ahead" onClick={() => o.lat != null && onShowOnMap?.({ lat: o.lat, lon: o.lon, headline: o.statement })}>
                                <b style={{ color: o.probability >= 60 ? "var(--red, #e5484d)" : "var(--amber, #f5a623)", fontVariantNumeric: "tabular-nums" }}>{o.probability}%</b>
                                <span style={{ minWidth: 0 }}>
                                    <span className="m2-t">{[o.place, o.statement].filter(Boolean).join(" · ")}</span>
                                    <span className="m2-sub">{[o.because, o.resolves_by && `by ${o.resolves_by}`].filter(Boolean).join(" · ")}</span>
                                </span>
                            </button>
                        ))}
                </div>
            </section>

            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </div>
    )
}
