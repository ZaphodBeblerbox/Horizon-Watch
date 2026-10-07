/**
 * MDesk.jsx — the desk on the phone: the team's feed, and posting from the
 * field — a photo or video from the camera, where you are (only if you say
 * so), and the words. A tick says you have seen a post; comments discuss it.
 * Same posts as the desktop Desk (routers/desk.py).
 */
import { useEffect, useRef, useState } from "react"
import { Attachment } from "../../desk/deskAttachments.jsx"
import { createPost, listPosts, listReplies, toggleAck, uploadDeskFile } from "../../lib/deskApi.js"
import { Icon, when } from "./common.jsx"

const URG = ["routine", "elevated", "high", "critical"]

function Composer({ onPosted, parentId = null, placeholder = "What did you see? It goes to everyone on the desk." }) {
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
            await createPost({ body: text.trim(), attachment: att || undefined, urgency: parentId ? undefined : urgency, parent_id: parentId || undefined })
            setText(""); setAtt(null); setMsg(null); onPosted?.()
        } catch (e) { setMsg(e.message || "Could not post") }
        setBusy(false)
    }
    return (
        <div className="m2-card" style={{ padding: 12, marginBottom: 14 }}>
            <textarea className="m2-input" rows={parentId ? 2 : 3} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
            {att && <div style={{ marginTop: 8 }}><Attachment att={att} compact /><button className="m2-chip" style={{ marginTop: 6 }} onClick={() => setAtt(null)}>Remove</button></div>}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                {!parentId && <>
                    <input ref={file} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
                    <button className="m2-chip" onClick={() => file.current?.click()}><Icon id="g-camera" size={14} />Photo / video</button>
                    <button className="m2-chip" onClick={here}><Icon id="g-pin" size={14} />Where I am</button>
                    <select className="m2-chip" value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ appearance: "none" }}>
                        {URG.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                </>}
                <span style={{ flex: 1 }} />
                <button className="m2-btn" disabled={busy} onClick={post} style={{ height: 36 }}>{parentId ? "Reply" : "Post"}</button>
            </div>
            {msg && <div className="m2-sub" style={{ marginTop: 6 }}>{msg}</div>}
        </div>
    )
}

function PostCard({ p, onChanged }) {
    const [acked, setAcked] = useState(!!p.acked)
    const [acks, setAcks] = useState(p.acks || 0)
    const [replies, setReplies] = useState(null)
    const open = async () => setReplies(replies ? null : (await listReplies(p.id).catch(() => [])) || [])
    const ack = async () => {
        setAcked(!acked); setAcks(acks + (acked ? -1 : 1))
        try { await toggleAck(p.id) } catch { setAcked(acked); setAcks(acks) }
    }
    const who = p.author || {}
    return (
        <div className="m2-card" style={{ padding: "12px 12px 8px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {who.avatar ? <img src={who.avatar} alt="" style={{ width: 30, height: 30, borderRadius: 15, objectFit: "cover" }} />
                    : <span style={{ width: 30, height: 30, borderRadius: 15, display: "grid", placeItems: "center", background: who.color || "#334", fontSize: 12, fontWeight: 700 }}>{who.initials || "?"}</span>}
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{who.name || "Someone"} {who.title && <span className="m2-when">{who.title}</span>}</div>
                    <div className="m2-when">{when(p.created_at)}{p.theater ? ` · ${p.theater}` : ""}{p.urgency && p.urgency !== "routine" ? ` · ${p.urgency}` : ""}</div>
                </div>
            </div>
            {p.body && <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 8 }}>{p.body}</div>}
            {p.attachment && <div style={{ marginBottom: 8 }}><Attachment att={p.attachment} postId={p.id} /></div>}
            <div style={{ display: "flex", gap: 6 }}>
                <button className="m2-chip" aria-pressed={acked} onClick={ack}>✓ {acks || ""}{acked ? " seen" : ""}</button>
                <button className="m2-chip" onClick={open}><Icon id="g-comment" size={14} />{p.replies || ""}</button>
            </div>
            {replies && (
                <div style={{ marginTop: 10 }}>
                    {replies.map((r) => (
                        <div key={r.id} style={{ padding: "6px 0", borderTop: "1px solid var(--gline, rgba(255,255,255,.08))" }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{r.author?.name || "Someone"}</span> <span className="m2-when">{when(r.created_at)}</span>
                            <div style={{ fontSize: 14, overflowWrap: "anywhere" }}>{r.body}</div>
                        </div>
                    ))}
                    <Composer parentId={p.id} placeholder="Comment" onPosted={async () => { setReplies((await listReplies(p.id).catch(() => [])) || []); onChanged?.() }} />
                </div>
            )}
        </div>
    )
}

export default function MDesk({ active }) {
    const [posts, setPosts] = useState(null)
    const load = () => listPosts({ limit: 40 }).then((d) => setPosts(Array.isArray(d) ? d : (d?.posts || []))).catch(() => setPosts([]))
    useEffect(() => {
        if (!active) return undefined
        load()
        const t = setInterval(load, 30_000)
        return () => clearInterval(t)
    }, [active])
    return (
        <div className="m2-scroll" data-screen-label="Phone desk">
            <Composer onPosted={load} />
            {posts === null ? <div className="m2-empty">Loading the desk…</div>
                : posts.length === 0 ? <div className="m2-empty">Nothing on the desk yet. What you post here, everyone on your team sees.</div>
                : posts.map((p) => <PostCard key={p.id} p={p} onChanged={load} />)}
        </div>
    )
}
