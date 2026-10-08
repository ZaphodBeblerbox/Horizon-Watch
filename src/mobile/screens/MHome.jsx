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
import { useEffect, useMemo, useRef, useState } from "react"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import { slotOf, useFrozen } from "../../home/dayPart.js"
import { getCurrentUser, subscribeAuth } from "../../state/authStore.js"
import { greetingFor } from "../../data/greetings.js"
import { useMine, usePoll, arr } from "../useMine.js"
import { Row, SignalSheet, sevColor, when } from "./common.jsx"

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

    const first = String(user?.name || user?.display_name || "").split(" ")[0]
    const greet = greetingFor(first, { seed })
    return (
        <div className="m2-scroll" data-screen-label="Phone home">
            {/* WHO YOU ARE AND A WELCOME, as on the desktop: the header and
                picture from the profile, the greeting for the time of day. */}
            <div className="m2-card" style={{ overflow: "hidden", margin: "0 0 16px" }} data-screen-label="Phone welcome">
                {user?.cover && <img src={user.cover} alt="" style={{ display: "block", width: "100%", height: 96, objectFit: "cover", objectPosition: user.cover_pos || "50% 50%" }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginTop: user?.cover ? -34 : 0 }}>
                    {user?.avatar
                        ? <img src={user.avatar} alt="" style={{ width: 56, height: 56, borderRadius: 28, objectFit: "cover", objectPosition: user.avatar_pos || "50% 50%", border: "2px solid var(--bg-0, #0f1115)", flex: "none" }} />
                        : <span style={{ width: 56, height: 56, borderRadius: 28, display: "grid", placeItems: "center", background: user?.color || "#334", fontWeight: 700, fontSize: 18, border: "2px solid var(--bg-0, #0f1115)", flex: "none" }}>{user?.initials || "?"}</span>}
                    <div style={{ minWidth: 0, alignSelf: "flex-end" }}>
                        <div className="m2-eyebrow">{greet.kicker}</div>
                        <div style={{ fontSize: 19, fontWeight: 650, lineHeight: 1.25 }}>{greet.lead}</div>
                    </div>
                </div>
                <div className="m2-sub" style={{ padding: "0 14px 12px" }}>
                    {mine.has ? `Built on your ${[mine.theaters.length && `${mine.theaters.length} theater${mine.theaters.length === 1 ? "" : "s"}`, mine.assets.length && `${mine.assets.length} asset${mine.assets.length === 1 ? "" : "s"}`].filter(Boolean).join(" and ") || "interests"}. ${greet.sub || ""}`
                        : "Nothing is yours yet — add a theater or an asset and Home follows them."}
                </div>
            </div>

            <section className="m2-section" data-screen-label="Phone urgent">
                <header><span className="m2-eyebrow">Most urgent for you</span><span className="m2-when">live · 30 s</span></header>
                <div className="m2-card">
                    {!mine.has ? <div className="m2-empty">Create a theater on the desktop or register an asset under More › Assets, and what concerns them appears here first.</div>
                        : urgent.length === 0 ? <div className="m2-empty">{surface === null ? "Loading…" : "Nothing urgent in your theaters or near your assets right now."}</div>
                        : urgent.map((u) => <Row key={u.id ?? u.title} s={u} title={u.headline || u.title}
                            sub={u._asset ? u.reason : (u._why || u.location || "")} when={when(u.published_at || u.created_at)}
                            onClick={() => (u._asset && u.asset_id ? onOpen?.("assets", { asset: u.asset_id }) : setOpen(u))} />)}
                </div>
            </section>

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
                            <button key={i} className="m2-row" onClick={() => o.lat != null && onShowOnMap?.({ lat: o.lat, lon: o.lon, headline: o.statement })}>
                                <span className="m2-when" style={{ color: o.probability >= 60 ? "var(--red, #e5484d)" : "var(--amber, #f5a623)", alignSelf: "baseline" }}>{o.probability}%</span>
                                <span style={{ minWidth: 0 }}>
                                    <span className="m2-t">{[o.place, o.statement].filter(Boolean).join(" · ")}</span>
                                    <span className="m2-sub">{[o.because, o.resolves_by && `by ${o.resolves_by}`].filter(Boolean).join(" · ")}</span>
                                </span>
                                <span />
                            </button>
                        ))}
                </div>
            </section>

            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={onShowOnMap} />}
        </div>
    )
}
