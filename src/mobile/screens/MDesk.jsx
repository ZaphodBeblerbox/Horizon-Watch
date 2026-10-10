/**
 * MDesk.jsx — the desk on the phone: the team's feed, and posting from the
 * field — a photo or video from the camera, where you are (only if you say
 * so), and the words. A tick says you have seen a post; comments discuss it.
 * Same posts as the desktop Desk (routers/desk.py).
 */
import { useEffect, useRef, useState } from "react"
import { Attachment } from "../../desk/deskAttachments.jsx"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import API_BASE from "../../apiBase.js"
import { createPost, listPosts, listReplies, toggleAck, uploadDeskFile } from "../../lib/deskApi.js"
import { Icon, when, ago } from "./common.jsx"
import { getCurrentUser } from "../../state/authStore.js"
import { audienceLabel } from "../../desk/Desk.jsx"

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
        : <span style={{ width: size, height: size, borderRadius: size / 2, display: "grid", placeItems: "center", background: who?.color || "#334", fontSize: size * 0.36, fontWeight: 700, flex: "none" }}>{who?.initials || "?"}</span>
}

/* ONE POST, AS A FEED READS IT: the face in its own column, name, handle
   and time on one line, the words, the attachment, then the actions —
   comment, seen, and where it was posted to. */
function PostCard({ p, onChanged }) {
    const [acked, setAcked] = useState(!!p.acked)
    const [acks, setAcks] = useState(p.acks || 0)
    const [replies, setReplies] = useState(null)
    const open = async () => setReplies(replies ? null : await repliesOf(p.id))
    const ack = async () => {
        setAcked(!acked); setAcks(acks + (acked ? -1 : 1))
        try { await toggleAck(p.id) } catch { setAcked(acked); setAcks(acks) }
    }
    const who = p.author || {}
    return (
        <article className="m2-post" data-testid="m2-post">
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
                    {p.attachment && <div style={{ marginTop: 8 }}><Attachment att={p.attachment} postId={p.id} /></div>}
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
                           background: t.role === "official" ? "#5b4a1f" : t.role === "partisan" ? "#4a2a2a" : "#1f3a4a", flex: "none" }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
                <div className="m2-post-head">
                    <b>{t.channel_title || t.channel}</b>
                    <span>{ROLE_SHORT[t.role] || "aggregator"}</span>
                    <span title={when(t.posted_at)}>· {ago(t.posted_at)}</span>
                </div>
                {t.headline && <div className="m2-post-body" style={{ fontWeight: 600 }}>{t.headline}</div>}
                {body && body !== t.headline && <div className="m2-post-body" style={{ color: "var(--txt2, #c3c7cf)", fontSize: 14 }}>{body.length > 420 ? body.slice(0, 420) + "…" : body}</div>}
                {orig && t.text && t.lang && t.lang !== "en" && <div className="m2-post-body" dir="auto" style={{ fontSize: 13.5, color: "var(--txt3, #8a909b)" }}>{t.text}</div>}
                {(t.media === "video" || t.media === "photo") && <div style={{ marginTop: 8 }}><TelegramMedia post={t} maxHeight="320px" radius="0" /></div>}
                <div className="m2-post-acts">
                    {t.on_map && <button onClick={() => onShowOnMap?.(t)}><Icon id="g-pin" size={15} />{String(t.place || "").split(",")[0]}</button>}
                    {t.text && t.lang && t.lang !== "en" && <button onClick={() => setOrig(!orig)}>{orig ? "hide original" : "original"}</button>}
                    {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer">Telegram ↗</a>}
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
        setItems(d?.posts || []); setNext(d?.next || null); setNewer(0)
    }
    const more = async () => {
        if (!next || loading) return
        setLoading(true)
        const d = await fetch(`${API_BASE}/api/telegram/feed?limit=30&before=${encodeURIComponent(next)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        setItems((p) => [...(p || []), ...(d?.posts || [])]); setNext(d?.next || null); setLoading(false)
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
    return (
        <div className="m2-scroll" data-screen-label="Phone desk" style={{ paddingTop: 0 }}>
            <div className="m2-seg" role="tablist">
                <button role="tab" aria-selected={tab === "team"} onClick={() => setTab("team")}>Team</button>
                <button role="tab" aria-selected={tab === "telegram"} onClick={() => setTab("telegram")}>Telegram</button>
            </div>
            {tab === "team" ? (<>
                <Composer onPosted={load} />
                {posts === null ? <div className="m2-empty">Loading the desk…</div>
                    : posts.length === 0 ? <div className="m2-empty">Nothing on the desk yet. What you post goes to your company unless you choose otherwise.</div>
                    : posts.map((p) => <PostCard key={p.id} p={p} onChanged={load} />)}
            </>) : <TelegramFeed active={active && tab === "telegram"} onShowOnMap={onShowOnMap} />}
        </div>
    )
}
