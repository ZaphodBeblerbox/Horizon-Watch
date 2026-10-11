/**
 * XPost.jsx — an X post in our own frame: who posted it, what it says, and
 * its photos or video, playing muted the way Telegram footage does.
 *
 * Never X's embed: its script renders nothing in the desktop app's webview,
 * under Safari's tracking prevention and in the iOS home-screen app. The
 * backend reads the post's public data (x_posts.py, GET /api/xpost/{id}:
 * FxTwitter, X's syndication, vxTwitter) and we draw it with our own
 * elements. Photos load straight from X's photo host and retry through our
 * server if refused; video always comes through our server, because X's
 * video host refuses any request that carries another site's Referer.
 *
 * NEVER AN EMPTY BOX: while loading there is a placeholder the size of a
 * card, and when no source gives the post the card says so, shows the
 * caller's text (GeoConfirmed's own description, if given) and links to X.
 * A post X marks possibly sensitive opens behind the same warning as
 * graphic Telegram footage, unless the user turned the warning off.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings } from "../state/settingsStore.js"
import { whenLabel } from "../utils/formatTime.js"

const STATUS = /(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i
export const xPostId = (url) => (STATUS.exec(String(url || "")) || [])[2] || null
export const xProxy = (u) => `${API_BASE}/api/x/video?u=${encodeURIComponent(u)}`
const xLink = (url) => {
    const m = STATUS.exec(String(url || ""))
    return m ? `https://x.com/${m[1]}/status/${m[2]}` : url
}

const FRAME = { border: "1px solid var(--gline, rgba(255,255,255,.12))", borderRadius: 14, overflow: "hidden", marginBottom: "var(--space-3, 12px)" }
const LINK = { fontSize: 12.5, color: "var(--txt3, var(--text-dim))", textDecoration: "none", whiteSpace: "nowrap" }

function Video({ v, active = true }) {
    const ref = useRef(null)
    const held = useRef(false)
    const act = useRef(active)
    act.current = active
    useEffect(() => {
        const el = ref.current
        if (!el) return
        if (active) start(el)
        else if (!el.paused) el.pause()
    }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
    const start = (el) => {
        if (!el || held.current || !act.current) return
        el.muted = true; el.defaultMuted = true
        const p = el.play(); if (p && p.catch) p.catch(() => {})
    }
    return <video data-testid="xpost-video" ref={ref} src={xProxy(v.mp4)} poster={v.poster || undefined} autoPlay={active} muted loop playsInline
        preload={active ? "auto" : "metadata"} controls={false}
        onLoadedData={(e) => start(e.currentTarget)}
        onClick={(e) => { const el = e.currentTarget; if (el.paused) { held.current = false; start(el) } else { held.current = true; el.pause() } }}
        style={{ display: "block", width: "100%", maxHeight: "60vh", objectFit: "contain", background: "#000", cursor: "pointer" }} />
}

/** A photo from X's host; if the host refuses it here, once more through our server. */
function Photo({ src, style }) {
    const [via, setVia] = useState(false)
    const url = via ? xProxy(src) : src
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" style={style}
        onError={() => { if (!via) setVia(true) }} />
}

// X's photo host serves a size by ?name= (FxTwitter hands out ?name=orig, the full original)
export function photoName(p, size) {
    const bare = String(p).replace(/([?&])name=[^&]*&?/, "$1").replace(/[?&]$/, "")
    return `${bare}${bare.includes("?") ? "&" : "?"}name=${size}`
}

export function PhotoGrid({ photos }) {
    const n = photos.length
    if (!n) return null
    return (
        <div data-testid="xpost-photos" style={{ display: "grid", gridTemplateColumns: n > 1 ? "1fr 1fr" : "1fr", gap: 2, background: "#000" }}>
            {photos.map((p, i) => (
                <a key={p} href={photoName(p, "large")} target="_blank" rel="noreferrer"
                   style={{ display: "block", gridColumn: n === 3 && i === 0 ? "1 / -1" : undefined }}>
                    <Photo src={photoName(p, n > 1 ? "small" : "medium")}
                           style={{ display: "block", width: "100%", height: n > 1 ? 180 : "auto", maxHeight: "50vh", objectFit: "cover" }} />
                </a>
            ))}
        </div>
    )
}

/** What the card shows for a state: the post, loading, or unavailable. Pure, for tests. */
export function XPostView({ post, url, fallbackText, active = true, shown = false, onShow }) {
    const href = post?.url || xLink(url)
    if (post === undefined) {
        return (
            <div data-testid="xpost-loading" style={{ ...FRAME, padding: "12px 12px", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 28, height: 28, borderRadius: 14, background: "rgba(255,255,255,.08)" }} />
                    <span style={{ fontSize: 12.5, color: "var(--txt4, var(--text-dim))" }}>Loading the post from X…</span>
                </div>
                <div style={{ height: 120, borderRadius: 8, background: "rgba(255,255,255,.05)" }} />
            </div>
        )
    }
    if (!post) {
        return (
            <div data-testid="xpost-fallback" style={{ ...FRAME, padding: "10px 12px" }}>
                {fallbackText && <div style={{ fontSize: 13.5, lineHeight: 1.45, marginBottom: 6, overflowWrap: "anywhere" }}>{fallbackText}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "var(--txt4, var(--text-dim))" }}>The post could not be shown here.</span>
                    {href && <a href={href} target="_blank" rel="noreferrer" style={LINK}>View on X ↗</a>}
                </div>
            </div>
        )
    }
    const warn = post.sensitive && getSettings()?.media?.warnGraphic !== false && !shown
    const photos = post.photos || []
    const videos = post.videos || []
    const hasMedia = videos.length > 0 || photos.length > 0
    return (
        <div data-testid="xpost" style={FRAME}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }}>
                {post.avatar
                    ? <img src={post.avatar} alt="" referrerPolicy="no-referrer" style={{ width: 28, height: 28, borderRadius: 14, flex: "none" }} />
                    : <span style={{ width: 28, height: 28, borderRadius: 14, flex: "none", background: "rgba(255,255,255,.1)" }} />}
                <div style={{ minWidth: 0, flex: 1, lineHeight: 1.25 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</div>
                    <div style={{ fontSize: 11.5, color: "var(--txt4, var(--text-dim))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{post.handle}{post.created_at ? ` · ${whenLabel(post.created_at)}` : ""}
                    </div>
                </div>
                <a href={href} target="_blank" rel="noreferrer" style={LINK}>View on X ↗</a>
            </div>
            {post.text && <div style={{ padding: "0 12px 9px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{post.text}</div>}
            {hasMedia && (warn ? (
                <div style={{ position: "relative", background: "#000", minHeight: 180, display: "grid", placeItems: "center", overflow: "hidden" }}>
                    {(videos[0]?.poster || photos[0]) && <img src={videos[0]?.poster || photos[0]} alt="" aria-hidden referrerPolicy="no-referrer"
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(36px) brightness(.45)", transform: "scale(1.2)" }} />}
                    <div style={{ position: "relative", textAlign: "center", color: "#fff", padding: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Sensitive content</div>
                        <div style={{ fontSize: 12.5, opacity: .8, marginBottom: 10 }}>X marks this media as possibly sensitive.</div>
                        <button onClick={onShow} style={{ height: 30, padding: "0 14px", borderRadius: 15, border: "1px solid rgba(255,255,255,.55)",
                            background: "rgba(255,255,255,.08)", color: "#fff", cursor: "pointer", font: "inherit", fontSize: 12.5 }}>Show</button>
                    </div>
                </div>
            ) : (
                <div>
                    {videos.map((v) => <Video key={v.mp4} v={v} active={active} />)}
                    <PhotoGrid photos={photos} />
                </div>
            ))}
        </div>
    )
}

export default function XPost({ url, active = true, fallbackText }) {
    const id = xPostId(url)
    const [post, setPost] = useState(undefined)          // undefined = loading, null = unavailable
    const [shown, setShown] = useState(false)
    useEffect(() => {
        if (!id) return undefined
        let live = true
        setPost(undefined); setShown(false)
        fetch(`${API_BASE}/api/xpost/${id}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => live && setPost(d && (d.text || d.photos?.length || d.videos?.length) ? d : null))
            .catch(() => live && setPost(null))
        return () => { live = false }
    }, [id])
    if (!id) return null
    return <XPostView post={post} url={url} fallbackText={fallbackText} active={active} shown={shown} onShow={() => setShown(true)} />
}
