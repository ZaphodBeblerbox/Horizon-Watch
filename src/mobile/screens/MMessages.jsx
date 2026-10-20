/**
 * MMessages.jsx — Messages on the phone: the user's conversations, most
 * recent first with what is unread, a thread to read and answer, and a new
 * conversation with anyone on the team. Same chats as the desktop
 * (routers/chat.py).
 *
 * LIKE EVERY OTHER MESSENGER (owner, 2026-10-17): "The conversations should
 * just look like WhatsApp, Telegram, or any other, not like some window which
 * would just be different chats." Rows with a face, a name, the last line, a
 * time and a count; bubbles grouped by sender under day separators, the time
 * and read ticks inside the bubble; a round send button. Layout rules are
 * pure and tested in ../chatThread.js; the look is ../messages.css.
 *
 * TYPING AND POP-IN, as on X: "if people type in the DMs, it should show a
 * typing indicator. The messages should pop in the same way." Pings go out
 * at most every 3 s (lib/chatTyping.js); an open thread asks who is typing
 * every 2 s and for messages every 4 s, and only while the tab is shown.
 *
 * THE THREAD TAKES THE SCREEN WHILE YOU WRITE: "I want the entire screen to
 * zoom in when I start to type a message in the DMs." Focusing the composer
 * dispatches m2:chrome {hidden: true} (the app header and tab bar slide
 * away) and the thread sizes itself to window.visualViewport, so it and the
 * composer sit exactly above the iOS keyboard. The box is 16px: anything
 * smaller and iOS zooms the page into it, which is the zoom nobody wants.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
    addMembers, attachmentUrl, chatPeople, getTyping, listConversations, listMessages, markRead,
    removeMember, sendMessage, setMemberRole, setTyping, startConversation,
} from "../../lib/chatApi.js"
import { refreshInboxUnread, setViewingChat, takeOpenChat } from "../../notify/inbox.js"
import MMembers from "./MMembers.jsx"
import { createTypingPinger, typingLabel } from "../../lib/chatTyping.js"
import { getCurrentUser } from "../../state/authStore.js"
import { clock, deliveryState, listWhen, mergeMessages, parseTs, threadItems } from "../chatThread.js"
import { Sheet } from "./common.jsx"
import "../messages.css"

const MSG_POLL_MS = 4000
const TYPING_POLL_MS = 2000

function initials(p) {
    if (p?.initials) return p.initials
    const words = String(p?.name || p?.title || "?").trim().split(/\s+/).filter(Boolean)
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase()
}

/** A photo, or grey initials — never a colour (owner, 2026-10-17). */
function Face({ p, size = 52 }) {
    return (
        <span className="mm-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
            {p?.avatar ? <img src={p.avatar} alt="" /> : initials(p)}
        </span>
    )
}

const other = (conv, meId) => (conv.kind === "group"
    ? { name: conv.title, avatar: conv.avatar }
    : (conv.members || []).find((m) => m.id !== meId) || { name: conv.title })

function attachmentLabel(m) {
    if (m.kind === "file") return m.attachment?.name || "File"
    if (m.kind === "case") return `Case: ${m.attachment?.case_title || ""}`.trim()
    if (m.kind === "signal") return "Signal"
    return "Attachment"
}

/* Icons are inline so the phone's sprite (PlxIcons) is not edited for them. */
const Chevron = () => <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
const Pencil = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
const ArrowUp = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
const Clip = () => <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l7.8-7.8a3.3 3.3 0 0 1 4.7 4.7l-7.8 7.8a1.7 1.7 0 0 1-2.4-2.4L14.8 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>

/** One tick sent, two read (blue: the one colour, an icon), a faint one while sending. */
function Ticks({ state }) {
    if (state === "sending") {
        return <svg className="mm-tick" width="12" height="12" viewBox="0 0 12 12" aria-label="Sending"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6 3.5V6l1.6 1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
    }
    const read = state === "read"
    return (
        <svg className={`mm-tick${read ? " read" : ""}`} width="16" height="11" viewBox="0 0 16 11" aria-label={read ? "Read" : "Sent"}>
            <path d="M1 6l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            {read && <path d="M6.5 8.6l.9.9 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
    )
}

function chrome(hidden) {
    window.dispatchEvent(new CustomEvent("m2:chrome", { detail: { hidden } }))
}

/* WHO IS IN A GROUP, AND CHANGING IT (owner, 2026-10-19: "I want to be
   able to also edit the members of a message group"). A group admin adds,
   removes and makes admins; anybody can leave. The server decides
   (routers/chat.py); this hides what it would refuse. */
function GroupMembers({ conv, meId, onConv, onLeft, onClose }) {
    const admin = conv.my_role === "admin"
    const members = (conv.members || []).map((m) => ({
        ...m, name: m.id === meId ? `${m.name} (you)` : m.name,
        note: m.role === "admin" ? "Group admin" : [m.title, m.company].filter(Boolean).join(" · "),
    }))
    return (
        <MMembers
            title={conv.title || "Group"} members={members} testid="m2-group-members"
            note={admin ? null : "Only a group admin can add or remove people."}
            canAdd={admin}
            canRemove={(m) => admin && m.id !== meId}
            onAdd={async (ids) => onConv(await addMembers(conv.id, ids))}
            onRemove={async (m) => { await removeMember(conv.id, m.id); onConv({ ...conv, members: conv.members.filter((x) => x.id !== m.id), member_count: (conv.member_count || 1) - 1 }) }}
            actions={(m) => (admin && m.id !== meId
                ? [[m.role === "admin" ? "Make member" : "Make admin",
                    async () => onConv(await setMemberRole(conv.id, m.id, m.role === "admin" ? "member" : "admin"))]]
                : [])}
            footer={(run) => (
                <button className="m2-btn ghost" style={{ width: "100%" }}
                        onClick={() => { if (window.confirm(`Leave ${conv.title}?`)) run("leave", async () => { await removeMember(conv.id, meId); onLeft() }) }}>
                    Leave the group</button>
            )}
            onClose={onClose}
        />
    )
}

function Thread({ conv, active, onBack, onConv }) {
    const me = getCurrentUser()
    const [msgs, setMsgs] = useState(null)
    const [typing, setTypingNow] = useState([])
    const [readAt, setReadAt] = useState(null)
    const [text, setText] = useState("")
    const [focused, setFocused] = useState(false)
    const [kb, setKb] = useState(null)              // {top, height} of the visual viewport while composing
    const scroller = useRef(null)
    const box = useRef(null)
    const atBottom = useRef(true)
    // Keys already drawn: a key not in here is new and pops in. The first
    // load fills it silently — a thread opening is not forty messages arriving.
    const seen = useRef(null)
    const popAt = useRef(new Map())
    const lastMarked = useRef(null)
    const pinger = useMemo(() => createTypingPinger((on) => setTyping(conv.id, on)), [conv.id])
    const group = conv.kind === "group"
    const [membersOpen, setMembersOpen] = useState(false)
    // THIS CONVERSATION IS ON SCREEN: its messages do not also pop up as
    // notifications (notify/inbox.js)
    useEffect(() => {
        if (!active) return undefined
        setViewingChat(conv.id)
        return () => setViewingChat(null)
    }, [conv.id, active])

    const load = () => listMessages(conv.id, { limit: 60 }).then((d) => {
        setMsgs((prev) => mergeMessages(d?.messages || [], prev || []).map((m) => {
            // A message sent from here keeps the key it was drawn with, so
            // the server's copy replacing it does not pop in a second time.
            const local = (prev || []).find((p) => p._key && p.id === m.id)
            return local && !m._key ? { ...m, _key: local._key } : m
        }))
        setTypingNow(d?.typing || [])
        if (d && "read_at" in d) setReadAt(d.read_at)
        // Read once per new message, not once per poll: every POST /read is
        // a write, and a thread left open would otherwise write every 4 s.
        const newest = (d?.messages || []).at(-1)?.id
        if (newest && newest !== lastMarked.current) { lastMarked.current = newest; markRead(conv.id).then(refreshInboxUnread).catch(() => {}) }
    }).catch(() => setMsgs((p) => p || []))

    useEffect(() => {
        if (!active) return undefined
        load()
        const t = setInterval(() => { if (!document.hidden) load() }, MSG_POLL_MS)
        const ty = setInterval(() => {
            if (document.hidden) return
            getTyping(conv.id).then((d) => { setTypingNow(d?.typing || []); if (d && "read_at" in d) setReadAt(d.read_at) }).catch(() => {})
        }, TYPING_POLL_MS)
        return () => { clearInterval(t); clearInterval(ty) }
    }, [conv.id, active]) // eslint-disable-line react-hooks/exhaustive-deps

    // Leaving the thread says "stopped" and gives the chrome back.
    useEffect(() => () => { pinger.stop() }, [pinger])

    /* ── the whole screen while composing ───────────────────────────── */
    useEffect(() => {
        if (!focused) { setKb(null); return undefined }
        chrome(true)
        const vv = window.visualViewport
        if (!vv) return () => chrome(false)
        const fit = () => setKb({ top: Math.round(vv.offsetTop), height: Math.round(vv.height) })
        fit()
        vv.addEventListener("resize", fit)
        vv.addEventListener("scroll", fit)
        return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); chrome(false) }
    }, [focused])

    const items = useMemo(() => threadItems(msgs || [], me?.id), [msgs, me?.id])
    if (msgs !== null && seen.current === null) seen.current = new Set(items.map((i) => i.key))
    // When each new key first appeared. The pop class stays on for the
    // length of the animation rather than one render: the server's copy of a
    // sent message replaces the local one a moment later, and dropping the
    // class then would cut the spring off halfway.
    if (seen.current) for (const i of items) if (!seen.current.has(i.key)) { seen.current.add(i.key); popAt.current.set(i.key, Date.now()) }
    const popping = (k) => popAt.current.has(k) && Date.now() - popAt.current.get(k) < 700

    // Follow the conversation down — but never yank somebody out of the
    // history they scrolled up to read because a message arrived.
    useLayoutEffect(() => {
        const el = scroller.current
        if (el && atBottom.current) el.scrollTop = el.scrollHeight
    }, [items.length, typing.length, kb?.height])

    const send = async () => {
        const body = text.trim()
        if (!body) return
        const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const pending = { id: key, _key: key, _pending: true, kind: "text", body, sender_id: me?.id, created_at: new Date().toISOString() }
        setText("")
        if (box.current) box.current.style.height = ""
        pinger.stop()
        atBottom.current = true
        setMsgs((p) => [...(p || []), pending])
        try {
            const m = await sendMessage(conv.id, { kind: "text", body })
            // A poll may already have brought the server's copy: keep one.
            setMsgs((p) => (p || []).filter((x) => x.id !== m.id || x._key === key)
                .map((x) => (x._key === key ? { ...m, _key: key } : x)))
        } catch {
            // Never silently eat what somebody typed: back into the box.
            setMsgs((p) => (p || []).filter((x) => x._key !== key))
            setText(body)
        }
    }

    const onType = (e) => {
        setText(e.target.value)
        pinger.changed(e.target.value)
        // The box grows with what is written, up to its max-height.
        const el = e.target
        el.style.height = "auto"
        el.style.height = `${el.scrollHeight + 2}px`
    }

    const peer = other(conv, me?.id)
    const sub = typing.length ? `${typingLabel(typing)}…`
        : group ? `${conv.member_count || (conv.members || []).length} people` : ""
    const style = kb ? { top: kb.top, height: kb.height, bottom: "auto" } : undefined

    const body = (m) => {
        if (m.deleted) return <span className="mm-deleted">This message was deleted</span>
        const att = m.attachment
        const img = att && m.kind === "file" && String(att.mime || "").startsWith("image/")
        return <>
            {img && <img className="mm-img" src={attachmentUrl(conv.id, m.id)} alt={att.name || ""} loading="lazy" />}
            {att && !img && (
                m.kind === "file"
                    ? <a className="mm-att" href={attachmentUrl(conv.id, m.id)} target="_blank" rel="noreferrer"><Clip />{attachmentLabel(m)}</a>
                    : <span className="mm-att"><Clip />{attachmentLabel(m)}</span>
            )}
            {m.body && <span>{m.body}</span>}
        </>
    }

    return (
        <div className={`mm-thread${focused ? " full" : ""}${kb ? " kb" : ""}`} style={style} data-screen-label="Phone thread">
            <div className="mm-head">
                <button className="mm-back" onClick={onBack} aria-label="Back"><Chevron /></button>
                <Face p={peer} size={36} />
                {group ? (
                    <button className="mm-who" data-testid="m2-group-head" aria-label={`${conv.title}: members`} onClick={() => setMembersOpen(true)}
                            style={{ border: 0, background: "transparent", padding: 0, textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer" }}>
                        <b>{conv.title}</b><span>{sub}{typing.length ? "" : " · tap for members"}</span>
                    </button>
                ) : <span className="mm-who"><b>{conv.title}</b><span>{sub}</span></span>}
            </div>
            {membersOpen && (
                <GroupMembers conv={conv} meId={me?.id} onConv={(c) => onConv?.(c)} onClose={() => setMembersOpen(false)}
                              onLeft={() => { setMembersOpen(false); onBack() }} />
            )}
            <div className="mm-msgs" ref={scroller}
                 onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}
                 onClick={() => box.current?.blur()}>
                {msgs === null ? <div className="mm-sys">Loading…</div>
                    : items.length === 0 ? <div className="mm-sys">No messages yet. Say hello.</div>
                    : items.map((it) => {
                        if (it.type === "day") return <div key={it.key} className="mm-day">{it.label}</div>
                        if (it.type === "system") return <div key={it.key} className="mm-sys">{it.m.body}</div>
                        const { m, mine, first, last } = it
                        const cls = ["mm-line", mine && "mine", first && "first", last && "last",
                            popping(it.key) && "mm-pop", m._pending && "mm-sending"].filter(Boolean).join(" ")
                        return (
                            <div key={it.key} className={cls}>
                                {group && !mine && <span className="mm-gutter">{last && <Face p={m.sender} size={28} />}</span>}
                                <div className="mm-bub">
                                    {group && !mine && first && <span className="mm-sender">{m.sender?.name}</span>}
                                    {body(m)}
                                    <span className="mm-meta">
                                        {clock(m.created_at)}
                                        {mine && <Ticks state={deliveryState(m, readAt)} />}
                                    </span>
                                </div>
                            </div>
                        )
                    })}
                {typing.length > 0 && (
                    <div className="mm-line first last" aria-label={typingLabel(typing)}>
                        {group && <span className="mm-gutter"><Face p={(conv.members || []).find((x) => x.id === typing[0].id) || typing[0]} size={28} /></span>}
                        <span className="mm-typing mm-pop"><i /><i /><i /></span>
                    </div>
                )}
            </div>
            <div className="mm-compose">
                <textarea ref={box} className="mm-input" rows={1} placeholder="Message" value={text} enterKeyHint="send"
                          onChange={onType} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }} />
                {/* Pressing send must not take the focus from the box: the
                    keyboard stays up for the next line, as in every messenger. */}
                <button className="mm-send" aria-label="Send" disabled={!text.trim()}
                        onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={send}><ArrowUp /></button>
            </div>
        </div>
    )
}

function preview(c, meId) {
    const m = c.last_message
    if (!m) return { text: "No messages yet" }
    if (m.kind === "system") return { text: m.body }
    const mine = m.sender_id === meId
    const text = m.deleted ? "Message deleted" : (m.body || attachmentLabel(m))
    const who = mine ? "You: " : c.kind === "group" ? `${String(m.sender?.name || "").split(" ")[0]}: ` : ""
    return { text: who + text, mine }
}

export default function MMessages({ active }) {
    const me = getCurrentUser()
    const [convs, setConvs] = useState(null)
    const [open, setOpen] = useState(null)
    const [picking, setPicking] = useState(false)
    const [people, setPeople] = useState([])
    const load = () => listConversations().then((d) => setConvs(Array.isArray(d) ? d : (d?.conversations || []))).catch(() => setConvs((p) => p || []))
    useEffect(() => { if (!active || open) return undefined; load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [active, open])
    const start = async (p) => {
        setPicking(false)
        try { const c = await startConversation({ kind: "direct", user_ids: [p.id] }); await load(); setOpen(c?.conversation || c) } catch { /* stays on the list */ }
    }
    // A NEW GROUP, as on the desktop: pick people, name it
    const [grouping, setGrouping] = useState(null)        // null | {ids: Set, title}
    const startGroup = async () => {
        const ids = [...(grouping?.ids || [])]
        if (!ids.length) return
        try {
            const c = await startConversation({ kind: "group", user_ids: ids, title: (grouping.title || "").trim() || undefined })
            setPicking(false); setGrouping(null); await load(); setOpen(c)
        } catch { /* stays on the sheet */ }
    }
    // OPENED FROM A NOTIFICATION: that conversation (notify/inbox.js)
    useEffect(() => {
        const openId = async (id) => {
            if (!id) return
            const list = await listConversations().catch(() => null)
            const all = Array.isArray(list) ? list : (list?.conversations || [])
            setConvs(all)
            const c = all.find((x) => x.id === id)
            if (c) setOpen(c)
        }
        if (active) openId(takeOpenChat())
        const h = () => { if (active) openId(takeOpenChat()) }
        window.addEventListener("plx:open-chat", h)
        return () => window.removeEventListener("plx:open-chat", h)
    }, [active])
    const sorted = useMemo(() => [...(convs || [])].sort((a, b) =>
        (parseTs(b.last_message_at || b.created_at)?.getTime() || 0) - (parseTs(a.last_message_at || a.created_at)?.getTime() || 0)), [convs])

    if (open) return <Thread key={open.id} conv={open} active={active} onBack={() => { setOpen(null); load() }} onConv={(c) => setOpen((o) => ({ ...o, ...c }))} />
    return (
        <div className="m2-scroll" data-screen-label="Phone messages">
            <div className="mm-list-head">
                <h2>Chats</h2>
                <button className="mm-new" aria-label="New conversation"
                        onClick={async () => { setPeople(await chatPeople().catch(() => []) || []); setPicking(true) }}><Pencil /></button>
            </div>
            {convs === null ? <div className="m2-empty">Loading…</div>
                : sorted.length === 0 ? <div className="m2-empty">No conversations yet. Start one with anyone on your team.</div>
                : (
                    <div className="mm-rows">
                        {sorted.map((c) => {
                            const pv = preview(c, me?.id)
                            const unread = c.unread > 0
                            return (
                                <button key={c.id} className={`mm-row${unread ? " unread" : ""}`} onClick={() => setOpen(c)}>
                                    <Face p={other(c, me?.id)} />
                                    <span className="mm-row-main">
                                        <span className="mm-name">{c.title}</span>
                                        <span className="mm-time">{listWhen(c.last_message_at)}</span>
                                        <span className="mm-preview">
                                            {pv.mine && c.last_message && !c.last_message.deleted && <Ticks state="sent" />}
                                            <span>{pv.text}</span>
                                        </span>
                                        {unread ? <span className="mm-count">{c.unread > 99 ? "99+" : c.unread}</span> : <span />}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                )}
            {picking && (
                <Sheet onClose={() => { setPicking(false); setGrouping(null) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div className="m2-eyebrow" style={{ flex: 1 }}>{grouping ? `New group · ${grouping.ids.size} chosen` : "New conversation with"}</div>
                        <button className="m2-btn ghost" style={{ height: 30, padding: "0 12px", fontSize: 13 }}
                                onClick={() => setGrouping(grouping ? null : { ids: new Set(), title: "" })}>{grouping ? "Cancel" : "New group"}</button>
                    </div>
                    {grouping && (
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <input className="m2-input" placeholder="Group name" value={grouping.title} style={{ flex: 1, fontSize: 16 }}
                                   onChange={(e) => setGrouping({ ...grouping, title: e.target.value })} />
                            <button className="m2-btn" disabled={!grouping.ids.size} onClick={startGroup}>Create</button>
                        </div>
                    )}
                    <div className="mm-rows" style={{ margin: 0 }}>
                        {people.filter((p) => p.id !== me?.id).map((p) => (
                            <button key={p.id} className="mm-row" aria-pressed={grouping ? grouping.ids.has(p.id) : undefined}
                                    style={grouping?.ids.has(p.id) ? { background: "rgba(255,255,255,.08)" } : undefined}
                                    onClick={() => {
                                        if (!grouping) return start(p)
                                        const ids = new Set(grouping.ids); ids.has(p.id) ? ids.delete(p.id) : ids.add(p.id)
                                        setGrouping({ ...grouping, ids })
                                    }}>
                                <Face p={p} size={44} />
                                <span className="mm-row-main">
                                    <span className="mm-name">{p.name}</span><span />
                                    <span className="mm-preview"><span>{[p.title, p.company].filter(Boolean).join(" · ") || p.email}</span></span><span />
                                </span>
                            </button>
                        ))}
                    </div>
                </Sheet>
            )}
        </div>
    )
}
