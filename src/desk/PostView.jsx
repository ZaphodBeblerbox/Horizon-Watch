/**
 * PostView.jsx — one post, opened from the Desk's feed like a post on X (owner, 2026-10-24): Back at the top, the
 * author or channel, the whole text (the original and its English), the exact date and time, the media at full size
 * with Download, the comments (a team post's replies; a General item's comments, routers/desk.py item-comments) and,
 * when it has a place, a small map of where it happened. The same view on the desktop (in the feed's column) and the
 * phone (in the Desk's pane); the list under it stays mounted, so Back returns to the same place.
 *
 *   post: {type: "team", post} | {type: "item", it}
 */
import { useEffect, useState } from "react"
import TelegramMedia from "../components/TelegramMedia.jsx"
import XPost, { PhotoGrid, xProxy } from "../components/XPost.jsx"
import { Attachment } from "./deskAttachments.jsx"
import MiniMap from "./MiniMap.jsx"
import { exactTime, itemKey, mediaOf, placeOf } from "./deskFeed.js"
import { addItemComment, createPost, deskFileUrl, listItemComments, listReplies, toggleAck } from "../lib/deskApi.js"
import { sourceCard, telegramUrl } from "../lib/sourceApi.js"
import { openSource } from "../inspector/sourceEmbed.js"
import { downloadMedia } from "../assistant/postDraft.js"
import { toast } from "../ui/toast.js"
import "./desk.css"

const arr = (v) => (Array.isArray(v) ? v : [])

function initialsOf(name) {
    return String(name || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
}

export function Avatar({ person, channel, size = 44 }) {
    const st = { width: size, height: size, borderRadius: size / 2, flex: "none", display: "grid", placeItems: "center", fontWeight: 700, fontSize: size * 0.34, color: "#fff", objectFit: "cover" }
    if (person?.avatar) return <img src={person.avatar} alt="" style={{ ...st, objectPosition: person.avatar_pos || "50% 50%" }} />
    const name = channel || person?.name || "?"
    const hue = [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
    return <span style={{ ...st, background: channel ? `hsl(${hue} 45% 38%)` : (person?.color || "#2a2e36") }}>{person?.initials || initialsOf(name)}</span>
}

/** Download the post's media through our proxy (postDraft.downloadMedia: the phone's share sheet takes the file). */
function DownloadButton({ media, title, phone }) {
    const [busy, setBusy] = useState(false)
    if (!media) return null
    return (
        <button type="button" className="dk-act" data-testid="post-download" disabled={busy} onClick={async () => {
            setBusy(true)
            const r = await downloadMedia(media, { title, phone })
            setBusy(false)
            if (r === "failed") toast("Could not download the media", { icon: "i-alert" })
        }}>{busy ? "Downloading…" : media.type === "video" ? "Download video" : "Download image"}</button>
    )
}

function Comments({ load, add, placeholder = "Add a comment" }) {
    const [rows, setRows] = useState(null)
    const [draft, setDraft] = useState("")
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        let live = true
        load().then((d) => { if (live) setRows(arr(d)) }).catch(() => { if (live) setRows([]) })
        return () => { live = false }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    const send = async () => {
        const text = draft.trim()
        if (!text || busy) return
        setBusy(true)
        try { const c = await add(text); setRows((r) => [...(r || []), c]); setDraft("") } catch (e) { toast(e.message || "That did not post", { icon: "i-alert" }) }
        setBusy(false)
    }
    return (
        <section className="dk-comments" data-testid="post-comments">
            <div className="dk-h">Comments{rows && rows.length ? ` · ${rows.length}` : ""}</div>
            <div className="dk-compose">
                <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} data-testid="post-comment-input"
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }} />
                <button type="button" className="dk-btn" disabled={!draft.trim() || busy} onClick={send} data-testid="post-comment-send">Reply</button>
            </div>
            {rows === null && <div className="dk-muted">Loading comments…</div>}
            {rows && !rows.length && <div className="dk-muted">No comments yet. Add what you know.</div>}
            {arr(rows).map((c) => (
                <div key={c.id} className="dk-comment" data-testid="post-comment">
                    <Avatar person={c.author} size={30} />
                    <div style={{ minWidth: 0 }}>
                        <div className="dk-comment-head"><b>{c.author?.name || "Someone"}</b><span>{exactTime(c.created_at)}</span></div>
                        <div className="dk-comment-body">{c.deleted ? "deleted" : c.body}</div>
                    </div>
                </div>
            ))}
        </section>
    )
}

export default function PostView({ post, variant = "desk", onBack, onMap, onShare }) {
    const phone = variant === "phone"
    const team = post?.type === "team" ? post.post : null
    const it = post?.type === "item" ? post.it : null
    // a Telegram item or a GeoConfirmed event's X post: the original text, its English and the media from the server
    const src = it ? (it.kind === "telegram" ? telegramUrl(it) : it.x_url || null) : null
    const [card, setCard] = useState(null)
    useEffect(() => {
        let live = true
        setCard(null)
        if (src) sourceCard(src).then((c) => { if (live) setCard(c) }).catch(() => {})
        return () => { live = false }
    }, [src])
    const [acked, setAcked] = useState(!!team?.acked)
    const [acks, setAcks] = useState(team?.acks || 0)

    if (!team && !it) return null
    const author = team ? team.author : null
    const name = team ? (author?.name || "Someone") : it.kind === "telegram" ? (it.channel_title || it.channel) : it.kind === "geoconfirmed" ? "GeoConfirmed" : (it.source || "Signal")
    const sub = team ? [author?.title, team.theater, team.urgency && team.urgency !== "routine" ? team.urgency : null].filter(Boolean).join(" · ")
        : [it.kind === "telegram" ? (it.role === "official" ? "official channel" : "Telegram") : it.kind === "geoconfirmed" ? "verified event" : (it.severity || "alert"),
           card?.handle ? `@${card.handle}` : null].filter(Boolean).join(" · ")
    const at = team ? team.created_at : (it.event_time || it.at)
    const precision = it?.at_precision === "day" ? "day" : "time"
    const original = card?.text || null
    const english = card?.english || (it?.kind === "telegram" && it.text && it.text !== original ? it.text : null)
    const where = placeOf(team || it)
    const tgMedia = it && it.kind === "telegram" && (it.media === "video" || it.media === "photo") ? { ...it, ...(card?.known ? { thumb_url: card.thumb_url || it.thumb_url, video_url: card.video_url } : {}) } : null
    const xMedia = card?.kind === "x" && card.known ? card : null
    const media = team ? (team.attachment?.kind === "telegram" ? mediaOf(team.attachment) : team.attachment?.kind === "file" && /^image\//.test(team.attachment.mime || "") ? { type: "photo", thumb: deskFileUrl(team.id), video: null } : null)
        : tgMedia ? mediaOf(tgMedia)
        : xMedia?.videos?.length ? { type: "video", thumb: xMedia.videos[0].poster, video: xProxy(xMedia.videos[0].mp4) }
        : xMedia?.photos?.length ? { type: "photo", thumb: xProxy(xMedia.photos[0]), video: null } : null
    const title = team ? (team.body || "").slice(0, 60) : it.headline
    const key = it ? itemKey(it) : null

    return (
        <article className={`dk-post dk-post-${variant}`} data-testid="post-view">
            <header className="dk-post-bar">
                <button type="button" className="dk-back" onClick={onBack} data-testid="post-back" aria-label="Back">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 5l-7 7 7 7" /></svg>
                </button>
                <b>Post</b>
            </header>
            <div className="dk-post-author">
                <Avatar person={author} channel={team ? null : name} size={46} />
                <div style={{ minWidth: 0 }}>
                    <div className="dk-post-name">{name}</div>
                    {sub && <div className="dk-muted">{sub}</div>}
                </div>
            </div>
            {team && (team.deleted ? <p className="dk-muted"><i>This post was deleted.</i></p>
                : team.body && <p className="dk-post-text" data-testid="post-text">{team.body}</p>)}
            {it && <h2 className="dk-post-headline" data-testid="post-text">{it.headline}</h2>}
            {it && original && <p className="dk-post-text" dir="auto" data-testid="post-original">{original}</p>}
            {it && english && (
                <div className="dk-post-en">
                    <div className="dk-h">{original && card?.lang && card.lang !== "en" ? `In English · from ${String(card.lang).toUpperCase()}` : "In English"}</div>
                    <p className="dk-post-text">{english}</p>
                </div>
            )}
            {it && !original && !english && it.text && <p className="dk-post-text">{it.text}</p>}
            <div className="dk-post-time" data-testid="post-time">
                <time dateTime={at || undefined}>{exactTime(at, { precision })}</time>
                {where?.label && <span> · {where.label}</span>}
            </div>
            {team?.attachment && <div className="dk-post-media"><Attachment att={team.attachment} postId={team.id} /></div>}
            {tgMedia && <div className="dk-post-media"><TelegramMedia post={tgMedia} maxHeight={phone ? "70vh" : "78vh"} radius="12px" /></div>}
            {it?.x_url && (xMedia
                ? <div className="dk-post-media">
                    {xMedia.videos?.length ? <video src={xProxy(xMedia.videos[0].mp4)} poster={xMedia.videos[0].poster || undefined} controls playsInline style={{ width: "100%", maxHeight: "78vh", background: "#000", borderRadius: 12 }} />
                        : <div style={{ borderRadius: 12, overflow: "hidden" }}><PhotoGrid photos={xMedia.photos || []} /></div>}
                  </div>
                : card === null ? <div className="dk-post-media"><XPost url={it.x_url} /></div> : null)}
            <div className="dk-post-acts">
                {team && !team.deleted && (
                    <button type="button" className={`dk-act${acked ? " on" : ""}`} aria-pressed={acked} onClick={async () => {
                        setAcked(!acked); setAcks(acks + (acked ? -1 : 1))
                        try { await toggleAck(team.id) } catch { setAcked(acked); setAcks(acks) }
                    }}>Seen{acks ? ` · ${acks}` : ""}</button>
                )}
                <DownloadButton media={media} title={title} phone={phone} />
                {where && onMap && <button type="button" className="dk-act" onClick={() => onMap(team ? { ...team.attachment, lat: where.lat, lon: where.lon } : it)}>On the map</button>}
                {(src || it?.url) && <button type="button" className="dk-act" data-testid="post-source" onClick={() => openSource(src || it.url, it ? { title: it.headline, source: name, when: at, place: where?.label } : null)}>Source</button>}
                {it && onShare && <button type="button" className="dk-act" onClick={() => onShare(it)}>Share to the team</button>}
            </div>
            {where && <MiniMap lat={where.lat} lon={where.lon} label={where.label} height={phone ? 170 : 200} onOpenMap={onMap ? () => onMap(team ? { ...team.attachment, lat: where.lat, lon: where.lon } : it) : null} />}
            {team && <Comments key={team.id} load={() => listReplies(team.id).then((d) => d?.replies || [])}
                               add={(text) => createPost({ body: text, parent_id: team.id })} placeholder="Add what you have" />}
            {it && key && <Comments key={key} load={() => listItemComments(key).then((d) => d?.comments || [])}
                                    add={(text) => addItemComment(key, text)} />}
        </article>
    )
}
