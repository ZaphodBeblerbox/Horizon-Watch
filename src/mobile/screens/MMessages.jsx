/**
 * MMessages.jsx — Messages on the phone: the user's conversations, most
 * recent first with what is unread, a thread to read and answer, and a new
 * conversation with anyone on the team. Same chats as the desktop
 * (routers/chat.py).
 */
import { useEffect, useRef, useState } from "react"
import { chatPeople, listConversations, listMessages, markRead, sendMessage, startConversation } from "../../lib/chatApi.js"
import { getCurrentUser } from "../../state/authStore.js"
import { Icon, Sheet, when } from "./common.jsx"

function Face({ p, size = 36 }) {
    if (p?.avatar) return <img src={p.avatar} alt="" style={{ width: size, height: size, borderRadius: size / 2, objectFit: "cover", flex: "none" }} />
    return <span style={{ width: size, height: size, borderRadius: size / 2, display: "grid", placeItems: "center", background: p?.color || "#334", fontSize: size / 3, fontWeight: 700, flex: "none" }}>
        {p?.initials || String(p?.name || p?.title || "?").slice(0, 2).toUpperCase()}</span>
}

function Thread({ conv, onBack }) {
    const me = getCurrentUser()
    const [msgs, setMsgs] = useState(null)
    const [text, setText] = useState("")
    const end = useRef(null)
    const load = () => listMessages(conv.id, { limit: 60 }).then((d) => { setMsgs(d?.messages || []); markRead(conv.id).catch(() => {}) }).catch(() => setMsgs([]))
    useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t) }, [conv.id]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { end.current?.scrollIntoView({ block: "end" }) }, [msgs?.length])
    const send = async () => {
        const body = text.trim()
        if (!body) return
        setText("")
        try { await sendMessage(conv.id, { kind: "text", body }); load() } catch { setText(body) }
    }
    return (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }} data-screen-label="Phone thread">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--gline, rgba(255,255,255,.08))" }}>
                <button className="m2-iconbtn" onClick={onBack} aria-label="Back">‹</button>
                <Face p={conv.kind === "group" ? { name: conv.title, avatar: conv.avatar } : conv.members?.find((m) => m.id !== me?.id)} size={30} />
                <span className="m2-title">{conv.title}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
                {msgs === null ? <div className="m2-empty">Loading…</div> : msgs.length === 0 ? <div className="m2-empty">No messages yet. Say hello.</div>
                    : [...msgs].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((m) => (
                        m.kind === "system" ? <div key={m.id} className="m2-when" style={{ textAlign: "center", margin: "8px 0" }}>{m.body}</div> : (
                            <div key={m.id} className={`m2-bubble${m.sender_id === me?.id ? " me" : ""}`}>
                                {m.sender_id !== me?.id && <Face p={m.sender} size={26} />}
                                <div>
                                    {m.sender_id !== me?.id && conv.kind === "group" && <div className="m2-when">{m.sender?.name}</div>}
                                    {m.body || (m.attachment ? `[${m.attachment.kind || "attachment"}]` : "")}
                                    <div className="m2-when" style={{ marginTop: 3 }}>{when(m.created_at)}</div>
                                </div>
                            </div>)
                    ))}
                <div ref={end} />
            </div>
            <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--gline, rgba(255,255,255,.08))" }}>
                <input className="m2-input" placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send() }} />
                <button className="m2-btn" onClick={send}>Send</button>
            </div>
        </div>
    )
}

export default function MMessages({ active }) {
    const [convs, setConvs] = useState(null)
    const [open, setOpen] = useState(null)
    const [picking, setPicking] = useState(false)
    const [people, setPeople] = useState([])
    const load = () => listConversations().then((d) => setConvs(Array.isArray(d) ? d : (d?.conversations || []))).catch(() => setConvs([]))
    useEffect(() => { if (!active) return undefined; load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [active])
    const start = async (p) => {
        setPicking(false)
        try { const c = await startConversation({ kind: "direct", user_ids: [p.id] }); await load(); setOpen(c?.conversation || c) } catch { /* stays on the list */ }
    }
    if (open) return <Thread conv={open} onBack={() => { setOpen(null); load() }} />
    return (
        <div className="m2-scroll" data-screen-label="Phone messages">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <span className="m2-eyebrow" style={{ flex: 1 }}>Conversations</span>
                <button className="m2-chip" onClick={async () => { setPeople(await chatPeople().catch(() => []) || []); setPicking(true) }}><Icon id="g-plus" size={14} />New</button>
            </div>
            <div className="m2-card">
                {convs === null ? <div className="m2-empty">Loading…</div>
                    : convs.length === 0 ? <div className="m2-empty">No conversations yet. Start one with anyone on your team.</div>
                    : [...convs].sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at))).map((c) => (
                        <button key={c.id} className="m2-row" style={{ gridTemplateColumns: "36px 1fr auto" }} onClick={() => setOpen(c)}>
                            <Face p={c.kind === "group" ? { name: c.title, avatar: c.avatar } : c.members?.find((m) => m.id !== getCurrentUser()?.id) || { name: c.title }} />
                            <span style={{ minWidth: 0 }}>
                                <span className="m2-t" style={{ fontWeight: c.unread ? 700 : 550 }}>{c.title}</span>
                                <span className="m2-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.last_message?.body || (c.last_message ? "attachment" : "no messages yet")}</span>
                            </span>
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                                <span className="m2-when">{when(c.last_message_at)}</span>
                                {c.unread > 0 && <span className="m2-badge" style={{ position: "static" }}>{c.unread}</span>}
                            </span>
                        </button>
                    ))}
            </div>
            {picking && (
                <Sheet onClose={() => setPicking(false)}>
                    <div className="m2-eyebrow" style={{ marginBottom: 8 }}>New conversation with</div>
                    <div className="m2-card">
                        {people.filter((p) => p.id !== getCurrentUser()?.id).map((p) => (
                            <button key={p.id} className="m2-row" style={{ gridTemplateColumns: "36px 1fr auto" }} onClick={() => start(p)}>
                                <Face p={p} />
                                <span><span className="m2-t">{p.name}</span><span className="m2-sub">{[p.title, p.company].filter(Boolean).join(" · ")}</span></span>
                                <span />
                            </button>
                        ))}
                    </div>
                </Sheet>
            )}
        </div>
    )
}
