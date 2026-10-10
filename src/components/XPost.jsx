/**
 * XPost.jsx — an X post in our own frame: who posted it, what it says, and
 * its photos or video, playing muted the way Telegram footage does.
 *
 * GeoConfirmed cites X posts for nearly every placemark; the backend reads
 * the post's public data (x_posts.py, GET /api/x/post/{id}). A post X marks
 * possibly sensitive opens behind the same warning as graphic Telegram
 * footage, unless the user turned the warning off.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings } from "../state/settingsStore.js"
import { whenLabel } from "../utils/formatTime.js"

const STATUS = /(?:x|twitter)\.com\/[^/?#]+\/status(?:es)?\/(\d+)/i
export const xPostId = (url) => (STATUS.exec(String(url || "")) || [])[1] || null

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
    // through our server: X's video host refuses players on other sites
    const src = `${API_BASE}/api/x/video?u=${encodeURIComponent(v.mp4)}`
    return <video ref={ref} src={src} poster={v.poster || undefined} autoPlay={active} muted loop playsInline preload={active ? "auto" : "metadata"}
        onLoadedData={(e) => start(e.currentTarget)}
        onClick={(e) => { const el = e.currentTarget; if (el.paused) { held.current = false; start(el) } else { held.current = true; el.pause() } }}
        style={{ display: "block", width: "100%", maxHeight: "60vh", objectFit: "contain", background: "#000", cursor: "pointer" }} />
}

export default function XPost({ url, active = true }) {
    const id = xPostId(url)
    const [post, setPost] = useState(undefined)          // undefined = loading, null = unavailable
    const [shown, setShown] = useState(false)
    useEffect(() => {
        if (!id) return undefined
        let live = true
        setPost(undefined); setShown(false)
        fetch(`${API_BASE}/api/x/post/${id}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => live && setPost(d)).catch(() => live && setPost(null))
        return () => { live = false }
    }, [id])
    if (!id || post === null) return null
    if (post === undefined) return <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "6px 0" }}>Loading the post from X…</div>
    const warn = post.sensitive && getSettings()?.media?.warnGraphic !== false && !shown
    const hasMedia = post.videos.length > 0 || post.photos.length > 0
    return (
        <div style={{ border: "1px solid var(--gline, rgba(255,255,255,.12))", marginBottom: "var(--space-3, 12px)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                {post.avatar && <img src={post.avatar} alt="" style={{ width: 26, height: 26, borderRadius: 13 }} />}
                <div style={{ minWidth: 0, flex: 1, lineHeight: 1.25 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.author}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>@{post.handle}{post.created_at ? ` · ${whenLabel(post.created_at)}` : ""}</div>
                </div>
                <a href={post.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>on X ↗</a>
            </div>
            {post.text && <div style={{ padding: "0 10px 8px", fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{post.text}</div>}
            {hasMedia && (warn ? (
                <div style={{ position: "relative", background: "#000", minHeight: 180, display: "grid", placeItems: "center", overflow: "hidden" }}>
                    {(post.videos[0]?.poster || post.photos[0]) && <img src={post.videos[0]?.poster || post.photos[0]} alt="" aria-hidden
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(36px) brightness(.45)", transform: "scale(1.2)" }} />}
                    <div style={{ position: "relative", textAlign: "center", color: "#fff", padding: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Sensitive content</div>
                        <div style={{ fontSize: 12.5, opacity: .8, marginBottom: 10 }}>X marks this media as possibly sensitive.</div>
                        <button onClick={() => setShown(true)} style={{ height: 30, padding: "0 14px", borderRadius: 15, border: "1px solid rgba(255,255,255,.55)",
                            background: "rgba(255,255,255,.08)", color: "#fff", cursor: "pointer", font: "inherit", fontSize: 12.5 }}>Show</button>
                    </div>
                </div>
            ) : (
                <div>
                    {post.videos.map((v) => <Video key={v.mp4} v={v} active={active} />)}
                    {post.photos.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: post.photos.length > 1 ? "1fr 1fr" : "1fr", gap: 2 }}>
                            {post.photos.map((p) => <a key={p} href={`${p}?name=large`} target="_blank" rel="noreferrer">
                                <img src={`${p}?name=medium`} alt="" style={{ display: "block", width: "100%", maxHeight: "50vh", objectFit: "cover" }} /></a>)}
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}
