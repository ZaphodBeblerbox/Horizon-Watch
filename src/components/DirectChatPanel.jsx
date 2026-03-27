import { useState, useEffect, useRef, useCallback } from "react"
import { apiFetch } from "../auth.js"

function relTime(iso) {
    if (!iso) return ""
    const diff = Date.now() - new Date(iso)
    const m = Math.floor(diff / 60000)
    if (m < 1)    return "now"
    if (m < 60)   return `${m}m`
    if (m < 1440) return `${Math.floor(m / 60)}h`
    return `${Math.floor(m / 1440)}d`
}

function initials(name) {
    if (!name) return "?"
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ["#1a6eb5", "#7c3aed", "#0d9488", "#d97706", "#dc2626", "#0891b2"]
function avatarColor(id) {
    let h = 0
    for (const c of (id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Avatar({ user, size = 32 }) {
    return (
        <div style={{
            width: size, height: size, borderRadius: "50%",
            background: avatarColor(user?.id || ""),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: size * 0.38, fontWeight: 700, color: "#fff",
            flexShrink: 0, userSelect: "none",
        }}>
            {initials(user?.name || user?.email || "?")}
        </div>
    )
}

const ROLE_COLOR = { observer: "rgba(255,255,255,0.3)", analyst: "#2d8fe8", admin: "#FFB300" }

function useIsMobile() {
    const [v, setV] = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    useEffect(() => {
        const h = () => setV(window.innerWidth < 768)
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])
    return v
}

export default function DirectChatPanel({ currentUser, onClose }) {
    const isMobile = useIsMobile()
    const [conversations,    setConversations]    = useState([])
    const [activePartner,    setActivePartner]    = useState(null)
    const [messages,         setMessages]         = useState([])
    const [input,            setInput]            = useState("")
    const [searchQ,          setSearchQ]          = useState("")
    const [searchResults,    setSearchResults]    = useState([])
    const [searching,        setSearching]        = useState(false)
    const [sending,          setSending]          = useState(false)
    const [loadingMsgs,      setLoadingMsgs]      = useState(false)
    const bottomRef  = useRef(null)
    const inputRef   = useRef(null)
    const pollRef    = useRef(null)

    const fetchConversations = useCallback(async () => {
        try {
            const res  = await apiFetch("/api/chat/conversations")
            if (res.ok) setConversations(await res.json())
        } catch { /* ignore */ }
    }, [])

    useEffect(() => {
        fetchConversations()
        const t = setInterval(fetchConversations, 10000)
        return () => clearInterval(t)
    }, [fetchConversations])

    const fetchMessages = useCallback(async (partnerId) => {
        setLoadingMsgs(true)
        try {
            const res = await apiFetch(`/api/chat/conversations/${partnerId}/messages`)
            if (res.ok) setMessages(await res.json())
        } catch { /* ignore */ }
        setLoadingMsgs(false)
    }, [])

    useEffect(() => {
        if (!activePartner) return
        fetchMessages(activePartner.id)
        clearInterval(pollRef.current)
        pollRef.current = setInterval(() => fetchMessages(activePartner.id), 5000)
        return () => clearInterval(pollRef.current)
    }, [activePartner, fetchMessages])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    // Search users
    useEffect(() => {
        if (!searchQ.trim()) { setSearchResults([]); return }
        setSearching(true)
        const t = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/users/search?q=${encodeURIComponent(searchQ)}`)
                if (res.ok) setSearchResults(await res.json())
            } catch { /* ignore */ }
            setSearching(false)
        }, 300)
        return () => clearTimeout(t)
    }, [searchQ])

    async function sendMessage() {
        if (!input.trim() || !activePartner || sending) return
        setSending(true)
        const content = input.trim()
        setInput("")
        try {
            const res = await apiFetch(`/api/chat/conversations/${activePartner.id}/messages`, {
                method: "POST",
                body: JSON.stringify({ content, message_type: "text" }),
            })
            if (res.ok) {
                const msg = await res.json()
                setMessages(prev => [...prev, msg])
                fetchConversations()
            }
        } catch { /* ignore */ }
        setSending(false)
        inputRef.current?.focus()
    }

    function openConversation(partner) {
        setActivePartner(partner)
        setMessages([])
        setSearchQ("")
        setSearchResults([])
    }

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1800,
            display: "flex", flexDirection: "row",
            fontFamily: "Inter, -apple-system, sans-serif",
            background: "rgba(6,13,26,0.97)",
            backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        }}>
            {/* ── Left: conversation list ────────────────────────────── */}
            <div style={{
                width: isMobile ? "100%" : 240,
                flexShrink: 0,
                borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)",
                display: isMobile && activePartner ? "none" : "flex",
                flexDirection: "column",
            }}>
                {/* Header */}
                <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fff" }}>Messages</span>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                </div>

                {/* Search */}
                <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
                    <input
                        value={searchQ}
                        onChange={e => setSearchQ(e.target.value)}
                        placeholder="Find user…"
                        style={{
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 6, padding: "7px 10px", fontSize: 12,
                            color: "#fff", outline: "none",
                        }}
                    />
                    {searching && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 4, paddingLeft: 2 }}>Searching…</div>}
                    {searchResults.length > 0 && (
                        <div style={{ marginTop: 4, background: "rgba(10,16,28,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, overflow: "hidden" }}>
                            {searchResults.map(u => (
                                <button key={u.id} onClick={() => openConversation(u)} style={{
                                    width: "100%", padding: "8px 10px", background: "none", border: "none",
                                    cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                                    textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.05)",
                                }}>
                                    <Avatar user={u} size={24} />
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>{u.name || u.email}</div>
                                        <div style={{ fontSize: 9, color: ROLE_COLOR[u.role] || "rgba(255,255,255,0.3)" }}>{u.role?.toUpperCase()}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Conversations */}
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {conversations.length === 0 && (
                        <div style={{ padding: "20px 12px", color: "rgba(255,255,255,0.2)", fontSize: 11, textAlign: "center", lineHeight: 1.7 }}>
                            No conversations yet.<br />Search for a user above.
                        </div>
                    )}
                    {conversations.map(c => {
                        const isActive = activePartner?.id === c.partner.id
                        return (
                            <button key={c.partner.id} onClick={() => openConversation(c.partner)} style={{
                                width: "100%", padding: "10px 12px", background: isActive ? "rgba(26,110,181,0.12)" : "none",
                                border: "none", borderLeft: `2px solid ${isActive ? "rgba(26,110,181,0.6)" : "transparent"}`,
                                cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                                borderBottom: "1px solid rgba(255,255,255,0.04)", textAlign: "left",
                            }}>
                                <div style={{ position: "relative" }}>
                                    <Avatar user={c.partner} size={32} />
                                    {c.unread_count > 0 && (
                                        <div style={{ position: "absolute", top: -3, right: -3, width: 14, height: 14, borderRadius: "50%", background: "#1a6eb5", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {c.unread_count > 9 ? "9+" : c.unread_count}
                                        </div>
                                    )}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                                        <span style={{ fontSize: 12, fontWeight: c.unread_count > 0 ? 700 : 500, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>
                                            {c.partner.name || c.partner.email}
                                        </span>
                                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>
                                            {relTime(c.last_message?.timestamp)}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {c.last_message?.is_mine ? "You: " : ""}{c.last_message?.content || ""}
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* ── Right: conversation view ───────────────────────────── */}
            <div style={{ flex: 1, display: isMobile && !activePartner ? "none" : "flex", flexDirection: "column", minWidth: 0 }}>
                {!activePartner ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                        Select a conversation or search for a user
                    </div>
                ) : (
                    <>
                        {/* Conversation header */}
                        <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                            {isMobile && (
                                <button onClick={() => setActivePartner(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px 0 0", flexShrink: 0 }}>←</button>
                            )}
                            <Avatar user={activePartner} size={36} />
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{activePartner.name || activePartner.email}</div>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: ROLE_COLOR[activePartner.role] || "rgba(255,255,255,0.3)" }}>
                                    {activePartner.role?.toUpperCase()}
                                </span>
                            </div>
                        </div>

                        {/* Messages */}
                        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                            {loadingMsgs && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, textAlign: "center" }}>Loading…</div>}
                            {messages.map(m => {
                                const isMine = m.sender_id === currentUser?.id
                                return (
                                    <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start" }}>
                                        <div style={{
                                            maxWidth: "70%", padding: "9px 12px",
                                            borderRadius: isMine ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                                            background: isMine ? "rgba(26,110,181,0.7)" : "rgba(255,255,255,0.06)",
                                            border: `1px solid ${isMine ? "rgba(26,110,181,0.4)" : "rgba(255,255,255,0.08)"}`,
                                            fontSize: 13, lineHeight: 1.55, color: "#fff",
                                        }}>
                                            {m.message_type === "poi" ? (
                                                <AttachmentCard msg={m} />
                                            ) : m.message_type === "briefing" ? (
                                                <AttachmentCard msg={m} />
                                            ) : m.content}
                                        </div>
                                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 3 }}>
                                            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            {isMine && m.read_at && <span style={{ marginLeft: 4 }}>✓</span>}
                                        </div>
                                    </div>
                                )
                            })}
                            {messages.length === 0 && !loadingMsgs && (
                                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.15)", fontSize: 12, marginTop: 40 }}>
                                    Start a conversation with {activePartner.name || activePartner.email}
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>

                        {/* Input bar */}
                        <div style={{ padding: "10px 16px", paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, display: "flex", gap: 8 }}>
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                                placeholder="Message… (Enter to send)"
                                rows={2}
                                style={{
                                    flex: 1, background: "rgba(255,255,255,0.06)",
                                    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
                                    padding: "8px 10px", fontSize: 16, color: "#fff",
                                    outline: "none", resize: "none", lineHeight: 1.5, fontFamily: "inherit",
                                }}
                            />
                            <button
                                onClick={sendMessage}
                                disabled={sending || !input.trim()}
                                style={{
                                    width: 36, borderRadius: 8, border: "none", fontSize: 16,
                                    background: sending || !input.trim() ? "rgba(255,255,255,0.06)" : "rgba(26,110,181,0.7)",
                                    color: sending || !input.trim() ? "rgba(255,255,255,0.2)" : "#fff",
                                    cursor: sending || !input.trim() ? "default" : "pointer",
                                }}
                            >▶</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function AttachmentCard({ msg }) {
    return (
        <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#FFB300", marginBottom: 4, textTransform: "uppercase" }}>
                {msg.message_type === "poi" ? "Shared POI" : "Shared Briefing"}
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)" }}>{msg.content}</div>
        </div>
    )
}
