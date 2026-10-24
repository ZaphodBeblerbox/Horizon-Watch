/**
 * MDesk.jsx — the desk on the phone: the team's feed, and posting from the
 * field — a photo or video from the camera, where you are (only if you say
 * so), and the words. A tick says you have seen a post; comments discuss it.
 * Same posts as the desktop Desk (routers/desk.py).
 */
import GeneralFeed from "../../general/GeneralFeed.jsx"
import SourceLink from "../../components/SourceLink.jsx"
import { useEffect, useMemo, useRef, useState } from "react"
import { Attachment } from "../../desk/deskAttachments.jsx"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import API_BASE from "../../apiBase.js"
import { addDeskMembers, createPost, listDeskMembers, listPosts, listReplies, markDeskRead, removeDeskMember, toggleAck, uploadDeskFile } from "../../lib/deskApi.js"
import { getInboxUnread, refreshInboxUnread, setViewingDesk, takeOpenDeskPost } from "../../notify/inbox.js"
import MMembers from "./MMembers.jsx"
import { Icon, when, ago } from "./common.jsx"
import { useMine } from "../useMine.js"
import { inTheater, setTheaterScope, useTheaterScope } from "../theaterScope.js"
import { attachDrag, attachPullToRefresh, swallowClickAfterDrag } from "../gesture.js"
import { captureMedia } from "../MediaViewer.jsx"
import { itemStatusLabel } from "../../globe/protests.js"
import { ageLabel } from "../../lib/liveIncident.js"
import { getCurrentUser } from "../../state/authStore.js"
import { audienceLabel } from "../../desk/Desk.jsx"
import { dropStaleDemos } from "../../globe/freshness.js"
import TheaterTabs from "../../desk/TheaterTabs.jsx"
import PostView from "../../desk/PostView.jsx"
import { isCardClick, nextTab, scrollMemo, teamPostIn, theaterTabs } from "../../desk/deskFeed.js"

const URG = ["routine", "elevated", "high", "critical"]

function Composer({ onPosted, parentId = null, placeholder = null }) {
    const me = getCurrentUser() || {}
    // Your company by default (routers/desk.py); without one, everyone.
    const [audience, setAudience] = useState(me.company ? "company" : "everyone")
    const [text, setText] = useState("")
    const [att, setAtt] = useState(null)
    const [urgency, setUrgency] = useState("routine")
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState(null)
    const file = useRef(null)
    const pickFile = async (f) => {
        if (!f) return
        setBusy(true); setMsg("Uploading…")
        try { setAtt(await uploadDeskFile(f)); setMsg(null) } catch (e) { setMsg(e.message || "Could not attach that") }
        setBusy(false)
    }
    const here = () => {
        if (!navigator.geolocation) { setMsg("This device cannot tell where it is."); return }
        setMsg("Finding where you are…")
        navigator.geolocation.getCurrentPosition(
            (p) => { setAtt({ kind: "place", name: "Where I am", lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), zoom: 14 }); setMsg(null) },
            () => setMsg("Location was not allowed."), { enableHighAccuracy: true, timeout: 15000 })
    }
    const post = async () => {
        if (!text.trim() && !att) return
        setBusy(true)
        try {
            await createPost({ body: text.trim(), attachment: att || undefined, urgency: parentId ? undefined : urgency, parent_id: parentId || undefined,
                               audience: parentId ? undefined : audience })
            setText(""); setAtt(null); setMsg(null); onPosted?.()
        } catch (e) { setMsg(e.message || "Could not post") }
        setBusy(false)
    }
    return (
        <div className="m2-card" style={{ padding: 12, marginBottom: 14 }}>
            <textarea className="m2-input" rows={parentId ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)}
                      placeholder={placeholder || `What did you see? It goes to ${audience === "company" ? `${me.company} only` : "everyone on Parallax"}.`} />
            {att && <div style={{ marginTop: 8 }}><Attachment att={att} compact /><button className="m2-chip" style={{ marginTop: 6 }} onClick={() => setAtt(null)}>Remove</button></div>}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                {!parentId && <>
                    <input ref={file} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
                    <button className="m2-chip" onClick={() => file.current?.click()}><Icon id="g-camera" size={14} />Photo / video</button>
                    <button className="m2-chip" onClick={here}><Icon id="g-pin" size={14} />Where I am</button>
                    <select className="m2-chip" value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ appearance: "none" }}>
                        {URG.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <select className="m2-chip" value={audience} onChange={(e) => setAudience(e.target.value)} style={{ appearance: "none" }} aria-label="Who reads this post">
                        {me.company && <option value="company">{me.company}</option>}
                        <option value="everyone">Everyone</option>
                    </select>
                </>}
                <span style={{ flex: 1 }} />
                <button className="m2-btn" disabled={busy} onClick={post} style={{ height: 36 }}>{parentId ? "Reply" : "Post"}</button>
            </div>
            {msg && <div className="m2-sub" style={{ marginTop: 6 }}>{msg}</div>}
        </div>
    )
}

const repliesOf = async (id) => { try { const d = await listReplies(id); return Array.isArray(d) ? d : (d?.replies || []) } catch { return [] } }
const handle = (who) => (who?.email ? `@${String(who.email).split("@")[0]}` : "")

function Face({ who, size = 40 }) {
    return who?.avatar
        ? <img src={who.avatar} alt="" style={{ width: size, height: size, borderRadius: size / 2, objectFit: "cover", objectPosition: who.avatar_pos || "50% 50%", flex: "none" }} />
        : <span style={{ width: size, height: size, borderRadius: size / 2, display: "grid", placeItems: "center", background: "#2a2e36", color: "var(--txt2)", fontSize: size * 0.36, fontWeight: 650, flex: "none" }}>{who?.initials || "?"}</span>
}

/* ONE POST, AS A FEED READS IT: the face in its own column, name, handle
   and time on one line, the words, the attachment, then the actions —
   comment, seen, and where it was posted to. */
function PostCard({ p, onChanged, onOpen }) {
    const [acked, setAcked] = useState(!!p.acked)
    const [acks, setAcks] = useState(p.acks || 0)
    const [replies, setReplies] = useState(null)
    // a tap on the post opens its full view; the comment button there too, like X
    const open = async () => (onOpen ? onOpen() : setReplies(replies ? null : await repliesOf(p.id)))
    const ack = async () => {
        setAcked(!acked); setAcks(acks + (acked ? -1 : 1))
        try { await toggleAck(p.id) } catch { setAcked(acked); setAcks(acks) }
    }
    const who = p.author || {}
    return (
        <article className={`m2-post${onOpen ? " dk-openable" : ""}`} data-testid="m2-post" id={`m2-post-${p.id}`}
                 onClick={onOpen ? (e) => { if (isCardClick(e) && !p.deleted) onOpen() } : undefined}>
            <Face who={who} />
            <div style={{ minWidth: 0 }}>
                <div className="m2-post-head">
                    <b>{who.name || "Someone"}</b>
                    <span>{handle(who)}</span>
                    <span title={when(p.created_at)}>· {ago(p.created_at)}</span>
                </div>
                {(p.theater || (p.urgency && p.urgency !== "routine") || p.audience) && (
                    <div className="m2-when" style={{ marginTop: 1 }}>
                        {[p.theater, p.urgency && p.urgency !== "routine" ? p.urgency : null, p.audience ? audienceLabel(p.audience) : null].filter(Boolean).join(" · ")}
                    </div>
                )}
                {p.deleted ? <div className="m2-sub" style={{ fontStyle: "italic" }}>This post was deleted.</div> : <>
                    {p.body && <div className="m2-post-body">{p.body}</div>}
                    {p.attachment && <div style={{ marginTop: 8 }} onClickCapture={captureMedia}><Attachment att={p.attachment} postId={p.id} /></div>}
                </>}
                <div className="m2-post-acts">
                    <button onClick={open} aria-label="Comments"><Icon id="g-comment" size={16} />{p.replies || ""}</button>
                    <button onClick={ack} aria-pressed={acked} aria-label="Seen"><span style={{ fontSize: 15 }}>✓</span>{acks || ""}</button>
                </div>
                {replies && (
                    <div style={{ marginTop: 6 }}>
                        {replies.map((r) => (
                            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 8, padding: "8px 0", borderTop: "1px solid var(--gline, rgba(255,255,255,.08))" }}>
                                <Face who={r.author} size={28} />
                                <div style={{ minWidth: 0 }}>
                                    <div className="m2-post-head"><b>{r.author?.name || "Someone"}</b><span>· {ago(r.created_at)}</span></div>
                                    <div style={{ fontSize: 14, overflowWrap: "anywhere" }}>{r.body}</div>
                                </div>
                            </div>
                        ))}
                        <Composer parentId={p.id} placeholder="Reply" onPosted={async () => { setReplies(await repliesOf(p.id)); onChanged?.() }} />
                    </div>
                )}
            </div>
        </article>
    )
}

/* TELEGRAM, IN ORDER. Every relevant post, newest first — not only those
   with a place, which is the map's rule — read as a timeline: the channel
   in its own column, what it is (official, local, partisan…), the English
   first and the original a tap away, the picture or video inline. More
   load at the bottom; newer ones are offered at the top, never pushed in
   under the reader's thumb. */
const ROLE_SHORT = { official: "official", local: "local", outlet: "outlet", aggregator: "aggregator", partisan: "partisan" }
function TelegramCard({ t, onShowOnMap }) {
    const [orig, setOrig] = useState(false)
    const initials = String(t.channel_title || t.channel || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "TG"
    const body = t.summary_en || t.text
    return (
        <article className="m2-post" data-testid="m2-tg">
            <span style={{ width: 40, height: 40, borderRadius: 20, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700,
                           background: "#2a2e36", color: "var(--txt2)", flex: "none" }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
                <div className="m2-post-head">
                    <b>{t.channel_title || t.channel}</b>
                    <span>{ROLE_SHORT[t.role] || "aggregator"}</span>
                    {/* an announced protest: where it stands now, never "announced 14 h ago" */}
                    <span title={when(t.event_time || t.posted_at)}>· {itemStatusLabel(t) || (t.event_time ? ageLabel(t) : null) || ago(t.posted_at)}</span>
                </div>
                {t.headline && <div className="m2-post-body" style={{ fontWeight: 600 }}>{t.headline}</div>}
                {body && body !== t.headline && <div className="m2-post-body" style={{ color: "var(--txt2, #c3c7cf)", fontSize: 14 }}>{body.length > 420 ? body.slice(0, 420) + "…" : body}</div>}
                {orig && t.text && t.lang && t.lang !== "en" && <div className="m2-post-body" dir="auto" style={{ fontSize: 13.5, color: "var(--txt3, #8a909b)" }}>{t.text}</div>}
                {(t.media === "video" || t.media === "photo") && <div style={{ marginTop: 8 }} onClickCapture={captureMedia}><TelegramMedia post={t} maxHeight="320px" radius="0" /></div>}
                <div className="m2-post-acts">
                    {t.on_map && <button onClick={() => onShowOnMap?.(t)}><Icon id="g-pin" size={15} />{String(t.place || "").split(",")[0]}</button>}
                    {t.text && t.lang && t.lang !== "en" && <button onClick={() => setOrig(!orig)}>{orig ? "hide original" : "original"}</button>}
                    {t.url && <SourceLink url={t.url}>Telegram post</SourceLink>}
                </div>
                <div className="m2-when" style={{ marginTop: 2 }}>{t.verification}</div>
            </div>
        </article>
    )
}

function TelegramFeed({ active, onShowOnMap }) {
    const [items, setItems] = useState(null)
    const [next, setNext] = useState(null)
    const [newer, setNewer] = useState(0)
    const [loading, setLoading] = useState(false)
    const end = useRef(null)
    const first = async () => {
        const d = await fetch(`${API_BASE}/api/telegram/feed?limit=30`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        setItems(dropStaleDemos(d?.posts || [])); setNext(d?.next || null); setNewer(0)
    }
    const more = async () => {
        if (!next || loading) return
        setLoading(true)
        const d = await fetch(`${API_BASE}/api/telegram/feed?limit=30&before=${encodeURIComponent(next)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        setItems((p) => [...(p || []), ...dropStaleDemos(d?.posts || [])]); setNext(d?.next || null); setLoading(false)
    }
    useEffect(() => { if (active && items === null) first() }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
    // newer posts are counted, not inserted
    useEffect(() => {
        if (!active || !items?.length) return undefined
        const t = setInterval(() => fetch(`${API_BASE}/api/telegram/feed?limit=30`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null))
            .then((d) => { const top = items[0]?.posted_at; setNewer((d?.posts || []).filter((x) => x.posted_at > top).length) }).catch(() => {}), 60_000)
        return () => clearInterval(t)
    }, [active, items])
    useEffect(() => {
        if (!end.current) return undefined
        const ob = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more() }, { rootMargin: "400px" })
        ob.observe(end.current)
        return () => ob.disconnect()
    }) // re-armed each render: `more` reads the latest cursor
    if (items === null) return <div className="m2-empty">Loading Telegram…</div>
    return (
        <>
            {newer > 0 && <button className="m2-btn" style={{ width: "100%", marginBottom: 10 }} onClick={first}>{newer} newer post{newer === 1 ? "" : "s"}</button>}
            {items.length === 0 ? <div className="m2-empty">No Telegram posts yet.</div> : items.map((t) => <TelegramCard key={t.id} t={t} onShowOnMap={onShowOnMap} />)}
            <div ref={end} className="m2-empty" style={{ textAlign: "center" }}>{next ? (loading ? "Loading older posts…" : " ") : items.length ? "That is everything kept." : ""}</div>
        </>
    )
}

/* WHO IS ON THE COMPANY DESK (owner, 2026-10-19: "I want to be able to add
   people to my company desk or remove them"). Everybody sees the list; the
   desk's owner and admins add and remove (routers/desk.py decides). */
export function DeskMembersBar() {
    const [d, setD] = useState(null)
    const [open, setOpen] = useState(false)
    const load = () => listDeskMembers().then(setD).catch(() => setD(null))
    useEffect(() => { load() }, [])
    if (!d?.company) return null
    const members = (d.members || []).map((m) => ({
        ...m, name: m.you ? `${m.name} (you)` : m.name,
        note: [m.owner ? "Owner" : m.manager ? "Admin" : null, m.title].filter(Boolean).join(" · ") || m.email,
    }))
    return (
        <>
            <button className="m2-card" data-testid="m2-desk-members" onClick={() => setOpen(true)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", marginBottom: 10,
                             border: 0, color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer" }}>
                <Icon id="g-user" size={18} />
                <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontWeight: 600 }}>{d.company}</b>
                    <span className="m2-sub" style={{ display: "block" }}>{d.members.length} {d.members.length === 1 ? "person" : "people"} on this desk</span>
                </span>
                <span className="m2-sub">{d.can_manage ? "Manage" : "Members"}</span>
            </button>
            {open && (
                <MMembers
                    title={`${d.company} desk`} members={members} testid="m2-desk-sheet"
                    note={d.can_manage ? "New people see the company's posts at once; removed people stop seeing them at once."
                        : "Only the desk's owner or an admin can add or remove people."}
                    canAdd={d.can_manage}
                    canRemove={(m) => d.can_manage && !m.you && !m.owner}
                    onAdd={async (ids) => setD(await addDeskMembers(ids))}
                    onRemove={async (m) => setD(await removeDeskMember(m.id))}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    )
}

export default function MDesk({ active, onShowOnMap }) {
    const [tab, setTab] = useState("team")
    // Home's "All posts" opens the Telegram tab
    useEffect(() => { if (active && window.__m2DeskTab) { setTab(window.__m2DeskTab); window.__m2DeskTab = null } }, [active])
    const [posts, setPosts] = useState(null)
    const load = () => listPosts({ limit: 40 }).then((d) => setPosts(Array.isArray(d) ? d : (d?.posts || []))).catch(() => setPosts([]))
    useEffect(() => {
        if (!active || tab !== "team") return undefined
        load()
        const t = setInterval(load, 30_000)
        return () => clearInterval(t)
    }, [active, tab])
    // THE DESK IS ON SCREEN: what is on it is read, and its posts do not also
    // pop up as notifications (notify/inbox.js; the server keeps the mark,
    // so the desktop's count goes too)
    const seeing = active && tab === "team"
    useEffect(() => {
        setViewingDesk(seeing)
        if (!seeing) return undefined
        const mark = () => { if (!document.hidden && getInboxUnread().desk > 0) markDeskRead().then(refreshInboxUnread).catch(() => {}) }
        markDeskRead().then(refreshInboxUnread).catch(() => {})
        const t = setInterval(mark, 15_000)
        return () => { clearInterval(t); setViewingDesk(false) }
    }, [seeing])
    // OPENED FROM A NOTIFICATION: the team's posts, at that post
    const [goPost, setGoPost] = useState(null)
    useEffect(() => {
        const take = () => { const ask = takeOpenDeskPost(); if (ask) { setTab("team"); setGoPost(ask.id) } }
        if (active) take()
        const h = (e) => { if (active) { takeOpenDeskPost(); setTab("team"); setGoPost(e.detail?.id || null) } }
        window.addEventListener("plx:open-desk-post", h)
        return () => window.removeEventListener("plx:open-desk-post", h)
    }, [active])
    useEffect(() => {
        if (!goPost || !posts) return
        const el = document.getElementById(`m2-post-${goPost}`)
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setGoPost(null) }
    }, [goPost, posts])
    // THE THEATRE TABS (owner, 2026-10-24: the desk like X): "All", then your
    // theatres, over the feed, the one choice of the whole phone
    // (mobile/theaterScope.js); a swipe on the feed moves to the next or the
    // previous tab, the content following the finger. Team and General are
    // the two buttons above.
    const mine = useMine()
    const scope = useTheaterScope()
    const tabs = useMemo(() => theaterTabs(mine.theaters), [mine.theaters])
    const scopeT = mine.theaters.find((t) => String(t.id) === String(scope)) || null
    const keep = useMemo(() => (scopeT ? inTheater(scopeT, mine.countries, mine.iso2Name) : null), [scopeT, mine.countries, mine.iso2Name])
    const tabId = scopeT ? String(scopeT.id) : null
    const tabsRef = useRef({ tabs, tabId })
    tabsRef.current = { tabs, tabId }
    const body = useRef(null)
    const [from, setFrom] = useState(null)
    const tabRef = useRef(tab)
    tabRef.current = tab
    // A POST OPENS IN THE DESK'S PANE (desk/PostView.jsx); the list stays
    // mounted under it, and Back returns to the same scroll position.
    const scroller = useRef(null)
    const [open, setOpen] = useState(null)
    const memo = useRef(scrollMemo()).current
    const openPost = (p) => { memo.save("list", scroller.current); setOpen(p); if (scroller.current) scroller.current.scrollTop = 0 }
    useEffect(() => { if (!open) memo.restore("list", scroller.current) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!active) setOpen(null) }, [active])
    useEffect(() => {
        const node = body.current
        if (!node) return undefined
        const off = attachDrag(node, {
            start: (t) => !t.closest?.("input, textarea, video, .m2-hscroll, .m2-chips, [data-nodrag]"),
            move: ({ dx, axis }) => {
                if (axis !== "x") return false
                const { tabs: ts, tabId: cur } = tabsRef.current
                const edge = nextTab(ts, cur, dx < 0 ? 1 : -1) === cur
                node.style.transition = ""
                node.style.transform = `translateX(${edge ? dx * 0.15 : dx * 0.5}px)`
                node.__dragged = true
                return true
            },
            end: ({ dx, vx, axis, moved }) => {
                node.style.transition = "transform .3s cubic-bezier(.22,1,.36,1)"
                node.style.transform = ""
                if (!moved || axis !== "x") return
                const go = Math.abs(dx) > 70 || Math.abs(vx) > 0.45
                if (!go) return
                const { tabs: ts, tabId: cur } = tabsRef.current
                const to = nextTab(ts, cur, dx < 0 ? 1 : -1)
                if (to === cur) return
                setFrom(dx < 0 ? "r" : "l")
                setTheaterScope(to)
            },
        })
        const offClick = swallowClickAfterDrag(node)
        return () => { off(); offClick() }
    }, [tab, tabId, !!open])       // the body is a new node for each tab and theatre (its key)
    const pick = (t) => { if (t === tab) return; setFrom(t === "general" ? "r" : "l"); setTab(t) }
    const pickTheatre = (id) => {
        const ids = tabs.map((t) => t.id)
        setFrom(ids.indexOf(id) > ids.indexOf(tabId) ? "r" : "l")
        setTheaterScope(id)
        if (scroller.current) scroller.current.scrollTop = 0
    }
    const shownPosts = (posts || []).filter((p) => teamPostIn(p, scopeT, keep))
    // PULL DOWN TO SEE THE NEWEST (owner: "like on Twitter"): the team's
    // posts fetched again, or the General feed started afresh
    const [fresh, setFresh] = useState(0)
    const loadRef = useRef(load)
    loadRef.current = load
    useEffect(() => attachPullToRefresh(scroller.current, {
        onRefresh: () => (tabRef.current === "team" ? loadRef.current() : new Promise((r) => { setFresh((n) => n + 1); setTimeout(r, 600) })),
    }), [])
    return (
        <div ref={scroller} className="m2-scroll m2-scroll-seg" data-screen-label="Phone desk">
            {open && <PostView post={open} variant="phone" onBack={() => setOpen(null)}
                               onMap={(it) => { setOpen(null); onShowOnMap?.(it) }} />}
            <div style={{ display: open ? "none" : "contents" }}>
            <div className="m2-seg" role="tablist">
                <button role="tab" aria-selected={tab === "team"} onClick={() => pick("team")}>Team</button>
                <button role="tab" aria-selected={tab === "general"} onClick={() => pick("general")}>General</button>
                <span className="m2-seg-mark" aria-hidden style={{ transform: `translateX(${tab === "general" ? 100 : 0}%)` }} />
            </div>
            {tab !== "telegram" && tabs.length > 1 && <TheaterTabs tabs={tabs} value={tabId} onChange={pickTheatre} variant="phone" />}
            <div ref={body} key={`${tab}:${tabId || "all"}`} className="m2-desk-body" style={from ? { animation: `m2-pane-from-${from} .34s cubic-bezier(.22,1,.36,1)` } : undefined}>
            {tab === "team" ? (<>
                <DeskMembersBar />
                <Composer onPosted={load} />
                {posts === null ? <div className="m2-empty">Loading the desk…</div>
                    : posts.length === 0 ? <div className="m2-empty">Nothing on the desk yet. What you post goes to your company unless you choose otherwise.</div>
                    : shownPosts.length === 0 ? <div className="m2-empty">Nothing posted to {scopeT?.name || "this theatre"} yet.</div>
                    : shownPosts.map((p) => <PostCard key={p.id} p={p} onChanged={load} onOpen={() => openPost({ type: "team", post: p })} />)}
            </>) : tab === "general" ? (
                // what is generally happening: signals, verified events, Telegram (general/GeneralFeed.jsx)
                <div style={{ display: "contents" }} onClickCapture={captureMedia}>
                    <GeneralFeed key={fresh} compact keep={keep} kindTabs={false} active={active && !open}
                                 onOpen={(it) => openPost({ type: "item", it })} onMap={(it) => onShowOnMap?.(it)} />
                </div>
            ) : <TelegramFeed active={active && tab === "telegram"} onShowOnMap={onShowOnMap} />}
            </div>
            </div>
        </div>
    )
}
