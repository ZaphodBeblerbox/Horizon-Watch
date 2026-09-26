import { useState, useRef, useEffect } from "react"
import Markdown from "react-markdown"
import API_BASE from "../apiBase.js"

const API = API_BASE

const PANEL = {
    position: "fixed",
    // Was 48 — a number that matched no bar in either density.
    top: "var(--top, 40px)",
    left: 0,
    bottom: "var(--status, 0px)",
    width: 360,
    background: "rgb(6, 14, 48)",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    zIndex: 600,
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--font)",
    color: "#e0e0e0",
}

export default function ChatPanel({ activeSituation, onClose }) {
    const [messages, setMessages]         = useState([])
    const [input, setInput]               = useState("")
    const [loading, setLoading]           = useState(false)
    const [contextual, setContextual]     = useState(false)
    const [totalCost, setTotalCost]       = useState(0)
    const bottomRef = useRef(null)
    const inputRef  = useRef(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, loading])

    const estimatedCost = contextual ? "~$0.0012" : "~$0.0005"

    const sendMessage = async () => {
        if (!input.trim() || loading) return
        const userMsg = { role: "user", content: input.trim() }
        const newMessages = [...messages, userMsg]
        setMessages(newMessages)
        setInput("")
        setLoading(true)

        const cappedHistory = newMessages.slice(-6).map(m => ({ role: m.role, content: m.content }))

        try {
            const res = await fetch(`${API}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages:      cappedHistory,
                    mission_brief: activeSituation?.mission || "",
                    contextual,
                }),
            })
            const data = await res.json()
            if (data.error) {
                setMessages(prev => [...prev, { role: "assistant", content: `Error: ${data.error}`, cost: 0 }])
            } else {
                setMessages(prev => [...prev, { role: "assistant", content: data.response, cost: data.usage?.cost_usd || 0 }])
                setTotalCost(prev => prev + (data.usage?.cost_usd || 0))
            }
        } catch {
            setMessages(prev => [...prev, { role: "assistant", content: "Connection error — check backend.", cost: 0 }])
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    return (
        <div style={PANEL}>
            {/* Header */}
            <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M2 2h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5L2 14V3a1 1 0 0 1 1-1z"/>
                    </svg>
                    <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", flex: 1 }}>Mission Chat</span>
                    {messages.length > 0 && (
                        <button
                            onClick={() => { setMessages([]); setTotalCost(0) }}
                            style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer" }}
                        >
                            Clear history
                        </button>
                    )}
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {activeSituation ? (
                        <span style={{ fontSize: 10, color: activeSituation.color || "#FFB300", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {activeSituation.name}
                        </span>
                    ) : (
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", flex: 1, fontStyle: "italic" }}>No active situation</span>
                    )}
                    {totalCost > 0 && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>
                            Session: ${totalCost.toFixed(4)}
                        </span>
                    )}
                </div>
                {!activeSituation && (
                    <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,179,0,0.6)", lineHeight: 1.4 }}>
                        Open a situation to give Parallax mission context
                    </div>
                )}
            </div>

            {/* Message history */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                {messages.length === 0 && (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 40, lineHeight: 1.8 }}>
                        Ask anything about the operational environment,<br />actors, events, or your mission.
                    </div>
                )}

                {messages.map((m, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                            maxWidth: "85%",
                            padding: "9px 12px",
                            borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                            background: m.role === "user" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: m.role === "user" ? "rgba(255,255,255,0.85)" : "#e0e0e0",
                            border: m.role === "user" ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.05)",
                        }}>
                            {m.role === "assistant" ? (
                                <div className="chat-md">
                                    <Markdown>{m.content}</Markdown>
                                </div>
                            ) : (
                                m.content
                            )}
                        </div>
                        {m.role === "assistant" && m.cost > 0 && (
                            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", marginTop: 3, paddingLeft: 4 }}>
                                ${m.cost.toFixed(5)}
                            </div>
                        )}
                    </div>
                ))}

                {loading && (
                    <div style={{ display: "flex", alignItems: "flex-start" }}>
                        <div style={{ padding: "9px 14px", borderRadius: "12px 12px 12px 2px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                {[0, 1, 2].map(i => (
                                    <div key={i} style={{
                                        width: 5, height: 5, borderRadius: "50%",
                                        background: "rgba(255,255,255,0.4)",
                                        animation: `chatDot 1.2s ease ${i * 0.2}s infinite`,
                                    }} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input area */}
            <div style={{ padding: "10px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a question… (Enter to send, Shift+Enter for newline)"
                        rows={2}
                        style={{
                            flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#fff", outline: "none",
                            resize: "none", lineHeight: 1.5, fontFamily: "inherit",
                        }}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={loading || !input.trim()}
                        style={{
                            width: 36, borderRadius: 8, border: "none", fontSize: 16,
                            background: loading || !input.trim() ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.15)",
                            color: loading || !input.trim() ? "rgba(255,255,255,0.25)" : "#fff",
                            cursor: loading || !input.trim() ? "default" : "pointer",
                        }}
                    >
                        ▶
                    </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                        onClick={() => setContextual(v => !v)}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
                    >
                        <div style={{
                            width: 8, height: 8, borderRadius: 1,
                            background: contextual ? "#FFB300" : "transparent",
                            border: `1.5px solid ${contextual ? "#FFB300" : "rgba(255,255,255,0.25)"}`,
                            transition: "all 150ms ease",
                        }} />
                        <span style={{ fontSize: 10, color: contextual ? "#FFB300" : "rgba(255,255,255,0.35)", display: "flex", alignItems: "center", gap: 4 }}>
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 3.5C6 3.5 4.5 5 4.5 7C4.5 8.5 5.5 9 5.5 9C3.5 9.5 3 11 3 12C3 13 4 13.5 5 13.5"/>
                                <path d="M8 3.5C10 3.5 11.5 5 11.5 7C11.5 8.5 10.5 9 10.5 9C12.5 9.5 13 11 13 12C13 13 12 13.5 11 13.5"/>
                                <line x1="8" y1="3.5" x2="8" y2="13.5"/>
                            </svg>
                            Context
                        </span>
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{estimatedCost}/msg</span>
                </div>
            </div>

            <style>{`
                @keyframes chatDot {
                    0%, 100% { opacity: 0.3; transform: translateY(0); }
                    50%       { opacity: 1;   transform: translateY(-3px); }
                }
                .chat-md p  { margin: 0 0 6px; font-size: 12px; line-height: 1.6; }
                .chat-md p:last-child { margin-bottom: 0; }
                .chat-md h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); margin: 8px 0 4px; }
                .chat-md ul { margin: 4px 0; padding-left: 14px; }
                .chat-md li { font-size: 12px; line-height: 1.55; }
                .chat-md strong { color: #fff; }
            `}</style>
        </div>
    )
}
