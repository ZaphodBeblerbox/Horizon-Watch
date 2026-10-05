/**
 * Chat.jsx — messages, the shape everyone already knows.
 *
 * A list of conversations on the left, the open one on the right, a box at
 * the bottom. Groups, direct messages, add people, and a name you can tap
 * to get the person. There is nothing novel here on purpose: this is the
 * one screen in the product where inventing an interaction costs more than
 * it could possibly buy.
 *
 * IT POLLS. There is no websocket for chat and the one SSE stream the app
 * holds is already spending a connection out of the browser's six per
 * origin. A five-second poll while the window is focused is honest, cheap
 * and cannot wedge; it stops entirely when the tab is hidden, because a
 * backgrounded tab asking every five seconds forever is how a laptop
 * fan comes on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    listConversations, startConversation, updateConversation, addMembers,
    removeMember, listMessages, sendMessage, deleteMessage, markRead, chatPeople,
    uploadToChat, attachCaseNode, attachmentUrl, attachableFiles,
    attachCase, sendableCases,
} from "../lib/chatApi.js"
import { getCurrentUser } from "../state/authStore.js"
import PersonCard, { Face } from "./PersonCard.jsx"
import { toast } from "../ui/toast.js"
import Loading from "../ui/Loading.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"

const POLL_MS = 5000

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt-2)",
    font: "400 11.5px var(--font)", cursor: "pointer", borderRadius: 0,
}
const PRIMARY = {
    ...BTN, border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
    color: "var(--txt)", fontWeight: 600,
}

/* The backend sends naive UTC; read as local it is hours out. */
function when(iso) {
    if (!iso) return ""
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    if (Number.isNaN(+d)) return ""
    const today = new Date()
    const sameDay = d.toDateString() === today.toDateString()
    return sameDay
        ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })
}

function dayLabel(iso) {
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    if (Number.isNaN(+d)) return ""
    const today = new Date()
    const yday = new Date(today); yday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return "Today"
    if (d.toDateString() === yday.toDateString()) return "Yesterday"
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
}

export default function Chat() {
    const me = getCurrentUser()
    const [convs, setConvs] = useState(null)
    const [openId, setOpenId] = useState(null)
    const [msgs, setMsgs] = useState([])
    const [loadingMsgs, setLoadingMsgs] = useState(false)
    const [draft, setDraft] = useState("")
    const [people, setPeople] = useState([])
    const [composing, setComposing] = useState(null)   // null | "new" | "add"
    const [card, setCard] = useState(null)             // person being looked at
    const [info, setInfo] = useState(false)            // the group panel
    const [q, setQ] = useState("")
    const [sending, setSending] = useState("")     // what is being uploaded
    const [picking, setPicking] = useState(false)  // the Parallax file picker
    const [sendingCase, setSendingCase] = useState(false)
    const [dropping, setDropping] = useState(false)

    const scroller = useRef(null)
    const fileRef = useRef(null)
    const atBottom = useRef(true)

    const open = useMemo(() => (convs || []).find((c) => c.id === openId) || null, [convs, openId])

    /* ── loading ─────────────────────────────────────────────────────── */

    const refresh = useCallback(async () => {
        try { setConvs(await listConversations()) }
        catch (e) { setConvs([]); toast(e.message || "Could not load your chats", { icon: "i-alert" }) }
    }, [])

    useEffect(() => { refresh() }, [refresh])
    useEffect(() => { chatPeople().then(setPeople).catch(() => setPeople([])) }, [])

    const loadMessages = useCallback(async (id, { quiet } = {}) => {
        if (!id) return
        if (!quiet) setLoadingMsgs(true)
        try {
            const d = await listMessages(id, { limit: 80 })
            setMsgs(d.messages || [])
        } catch (e) {
            if (!quiet) toast(e.message || "Could not open that chat", { icon: "i-alert" })
        } finally { if (!quiet) setLoadingMsgs(false) }
    }, [])

    useEffect(() => {
        if (!openId) { setMsgs([]); return }
        setInfo(false)
        loadMessages(openId)
        markRead(openId).then(refresh).catch(() => {})
    }, [openId, loadMessages, refresh])

    // The poll. Stops dead when the tab is hidden — see the module note.
    useEffect(() => {
        let alive = true
        const tick = async () => {
            if (!alive || document.hidden) return
            await refresh()
            if (openId) await loadMessages(openId, { quiet: true })
        }
        const t = setInterval(tick, POLL_MS)
        const onVisible = () => { if (!document.hidden) tick() }
        document.addEventListener("visibilitychange", onVisible)
        return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible) }
    }, [refresh, loadMessages, openId])

    // Follow the conversation down, but only if you were already at the
    // bottom — yanking somebody back from the history they are reading
    // because a message arrived is the rudest thing a chat can do.
    useEffect(() => {
        const el = scroller.current
        if (el && atBottom.current) el.scrollTop = el.scrollHeight
    }, [msgs])

    /* ── acting ──────────────────────────────────────────────────────── */

    const send = async () => {
        const text = draft.trim()
        if (!text || !openId) return
        setDraft("")
        atBottom.current = true
        try {
            const m = await sendMessage(openId, { body: text })
            setMsgs((p) => [...p, m])
            refresh()
        } catch (e) {
            setDraft(text)          // never silently eat what somebody typed
            toast(e.message || "That did not send", { icon: "i-alert" })
        }
    }

    const sendFiles = async (files) => {
        const list = Array.from(files || [])
        if (!list.length || !openId) return
        atBottom.current = true
        for (const f of list) {
            setSending(f.name)
            try {
                const m = await uploadToChat(openId, f)
                setMsgs((p) => [...p, m])
            } catch (e) {
                toast(`${f.name}: ${e.message || "could not send"}`, { icon: "i-alert" })
            }
        }
        setSending("")
        refresh()
    }

    const sendCaseFile = async (row) => {
        setPicking(false)
        if (!openId) return
        atBottom.current = true
        setSending(row.name)
        try {
            const m = await attachCaseNode(openId, { case_id: row.case_id, node_id: row.node_id })
            setMsgs((p) => [...p, m])
            refresh()
        } catch (e) {
            toast(e.message || "Could not send that file", { icon: "i-alert" })
        } finally { setSending("") }
    }

    const sendWholeCase = async (row, canEdit) => {
        setSendingCase(false)
        if (!openId) return
        atBottom.current = true
        setSending(row.title)
        try {
            const m = await attachCase(openId, { case_id: row.case_id, can_edit: canEdit })
            setMsgs((p) => [...p, m])
            refresh()
        } catch (e) {
            toast(e.message || "Could not send that case", { icon: "i-alert" })
        } finally { setSending("") }
    }

    const startWith = async (person) => {
        try {
            const c = await startConversation({ kind: "direct", user_ids: [person.id] })
            setCard(null); setComposing(null)
            await refresh()
            setOpenId(c.id)
        } catch (e) { toast(e.message || "Could not start that chat", { icon: "i-alert" }) }
    }

    const startGroup = async (ids, title) => {
        try {
            const c = await startConversation({ kind: "group", user_ids: ids, title })
            setComposing(null)
            await refresh()
            setOpenId(c.id)
        } catch (e) { toast(e.message || "Could not create the group", { icon: "i-alert" }) }
    }

    const invite = async (ids) => {
        try {
            await addMembers(openId, ids)
            setComposing(null)
            await Promise.all([refresh(), loadMessages(openId, { quiet: true })])
        } catch (e) { toast(e.message || "Could not add them", { icon: "i-alert" }) }
    }

    const leave = async (userId) => {
        const who = userId === me?.id ? "Leave this group?" : "Remove them from the group?"
        if (!confirm(who)) return
        try {
            await removeMember(openId, userId)
            if (userId === me?.id) { setOpenId(null); setInfo(false) }
            await Promise.all([refresh(), openId ? loadMessages(openId, { quiet: true }) : null])
        } catch (e) { toast(e.message || "That did not work", { icon: "i-alert" }) }
    }

    const unsend = async (m) => {
        if (!confirm("Delete this message for everyone?")) return
        try {
            const d = await deleteMessage(openId, m.id)
            setMsgs((p) => p.map((x) => (x.id === m.id ? { ...x, ...d } : x)))
        } catch (e) { toast(e.message || "Could not delete it", { icon: "i-alert" }) }
    }

    const shown = useMemo(() => {
        const text = q.trim().toLowerCase()
        if (!text) return convs || []
        return (convs || []).filter((c) =>
            c.title.toLowerCase().includes(text) ||
            (c.members || []).some((p) => (p.name || "").toLowerCase().includes(text)))
    }, [convs, q])

    /* ── chrome ──────────────────────────────────────────────────────── */

    return (
        <div style={MODE_SURFACE} data-testid="view-root-chat">
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {/* ── the list ──────────────────────────────────────── */}
                <div style={{
                    width: 300, flexShrink: 0, borderRight: "1px solid var(--gline)",
                    display: "flex", flexDirection: "column", minHeight: 0,
                }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 8, height: 44, flexShrink: 0,
                        padding: "0 12px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <b style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>Messages</b>
                        <div style={{ flex: 1 }} />
                        <button style={PRIMARY} onClick={() => setComposing("new")}>New</button>
                    </div>

                    <div style={{ padding: "8px 12px", flexShrink: 0 }}>
                        <input
                            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
                            style={{
                                width: "100%", height: 26, padding: "0 9px", background: "var(--glass2)",
                                border: "1px solid var(--gline)", color: "var(--txt)",
                                font: "400 12px var(--font)", outline: "none", borderRadius: 0,
                            }}
                        />
                    </div>

                    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                        {convs === null && <Loading size={18} inline label="Loading" style={{ padding: 14 }} />}
                        {convs !== null && !shown.length && (
                            <p style={{ padding: "12px 14px", font: "400 12px/1.65 var(--font)", color: "var(--txt-3)" }}>
                                {q.trim()
                                    ? "No chat matches that."
                                    : "No chats yet. Press New to message somebody or start a group."}
                            </p>
                        )}
                        {shown.map((c) => {
                            const on = c.id === openId
                            const other = c.kind === "direct"
                                ? (c.members || []).find((p) => p.id !== me?.id)
                                : null
                            return (
                                <div
                                    key={c.id} onClick={() => setOpenId(c.id)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                                        cursor: "pointer", borderBottom: "1px solid var(--gline)",
                                        background: on ? "var(--acc-dim)" : "transparent",
                                    }}
                                >
                                    {c.kind === "group"
                                        ? <GroupFace conv={c} size={36} />
                                        : <Face person={other} size={36} />}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                            <b style={{
                                                flex: 1, minWidth: 0, font: "600 12.5px var(--font)", color: "var(--txt)",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            }}>{c.title}</b>
                                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-3)", flexShrink: 0 }}>
                                                {when(c.last_message_at)}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{
                                                flex: 1, minWidth: 0, font: "400 11.5px var(--font)",
                                                color: c.unread ? "var(--txt-2)" : "var(--txt-3)",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            }}>{preview(c, me?.id)}</span>
                                            {c.unread > 0 && (
                                                <span style={{
                                                    flexShrink: 0, minWidth: 17, height: 17, padding: "0 5px",
                                                    borderRadius: 9, background: "var(--acc-hi)",
                                                    color: "var(--bg-0, #14161f)", font: "600 10px var(--mono)",
                                                    display: "grid", placeItems: "center",
                                                }}>{c.unread > 99 ? "99+" : c.unread}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* ── the thread ────────────────────────────────────── */}
                <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {!open && (
                        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 30 }}>
                            <p style={{ font: "400 12.5px/1.7 var(--font)", color: "var(--txt-3)", maxWidth: 360, textAlign: "center" }}>
                                Pick a chat on the left, or press <b style={{ fontWeight: 600 }}>New</b> to
                                message somebody. Groups work the same way — add whoever needs to be in it.
                            </p>
                        </div>
                    )}

                    {open && (
                        <>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 10, height: 44, flexShrink: 0,
                                padding: "0 14px", borderBottom: "1px solid var(--gline)",
                            }}>
                                {open.kind === "group"
                                    ? <GroupFace conv={open} size={30} onClick={() => setInfo(!info)} />
                                    : <Face person={(open.members || []).find((p) => p.id !== me?.id)} size={30}
                                            onClick={() => setCard((open.members || []).find((p) => p.id !== me?.id))} />}
                                <div style={{ minWidth: 0, cursor: "pointer" }}
                                     onClick={() => open.kind === "group"
                                         ? setInfo(!info)
                                         : setCard((open.members || []).find((p) => p.id !== me?.id))}>
                                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>{open.title}</div>
                                    <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                        {open.kind === "group"
                                            ? `${open.member_count} people · tap for the group`
                                            : "tap for their profile"}
                                    </div>
                                </div>
                                <div style={{ flex: 1 }} />
                                {open.kind === "group" && (
                                    <>
                                        <button style={BTN} onClick={() => setComposing("add")}>Add people</button>
                                        <button style={BTN} onClick={() => setInfo(!info)}>{info ? "Close" : "Group"}</button>
                                    </>
                                )}
                            </div>

                            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                                <div
                                    ref={scroller}
                                    onScroll={(e) => {
                                        const el = e.currentTarget
                                        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
                                    }}
                                    onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
                                    onDragLeave={() => setDropping(false)}
                                    onDrop={(e) => {
                                        e.preventDefault(); setDropping(false)
                                        if (e.dataTransfer?.files?.length) sendFiles(e.dataTransfer.files)
                                    }}
                                    style={{
                                        flex: 1, minWidth: 0, overflow: "auto", padding: "14px 16px",
                                        ...(dropping ? { background: "var(--acc-dim)", outline: "1px dashed var(--acc-line)", outlineOffset: -6 } : null),
                                    }}
                                >
                                    {loadingMsgs && <Loading size={18} inline label="Opening" />}
                                    {!loadingMsgs && !msgs.length && (
                                        <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", textAlign: "center", marginTop: 24 }}>
                                            Nothing here yet. Say something.
                                        </p>
                                    )}
                                    {msgs.map((m, i) => {
                                        const prev = msgs[i - 1]
                                        const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
                                        return (
                                            <div key={m.id}>
                                                {newDay && (
                                                    <div style={{ display: "flex", justifyContent: "center", margin: "14px 0 10px" }}>
                                                        <span style={{
                                                            ...EYE, padding: "2px 9px",
                                                            background: "var(--glass2)", border: "1px solid var(--gline)",
                                                        }}>{dayLabel(m.created_at)}</span>
                                                    </div>
                                                )}
                                                <Bubble
                                                    m={m} meId={me?.id} group={open.kind === "group"}
                                                    conversationId={open.id}
                                                    runOn={!newDay && prev && prev.sender_id === m.sender_id && m.kind !== "system"}
                                                    onPerson={setCard} onDelete={unsend}
                                                />
                                            </div>
                                        )
                                    })}
                                </div>

                                {info && open.kind === "group" && (
                                    <GroupPanel
                                        conv={open} meId={me?.id}
                                        onPerson={setCard} onRemove={leave}
                                        onRename={async (t) => {
                                            try { await updateConversation(open.id, { title: t }); await Promise.all([refresh(), loadMessages(open.id, { quiet: true })]) }
                                            catch (e) { toast(e.message || "Could not rename it", { icon: "i-alert" }) }
                                        }}
                                        onAdd={() => setComposing("add")}
                                        onPicture={async (avatar) => {
                                            try { await updateConversation(open.id, { avatar }); await refresh() }
                                            catch (e) { toast(e.message || "Could not set the picture", { icon: "i-alert" }) }
                                        }}
                                    />
                                )}
                            </div>

                            <div style={{
                                flexShrink: 0, display: "flex", alignItems: "flex-end", gap: 8,
                                padding: 12, borderTop: "1px solid var(--gline)",
                            }}>
                                {/* Two kinds of file, two buttons, because they
                                    are genuinely different questions: one opens
                                    your machine, the other searches what you
                                    have filed. */}
                                <button style={{ ...BTN, height: 34, padding: "0 10px" }}
                                        title="Attach a file from this computer"
                                        onClick={() => fileRef.current?.click()}>Attach</button>
                                <button style={{ ...BTN, height: 34, padding: "0 10px" }}
                                        title="Send a file out of a case"
                                        onClick={() => setPicking(true)}>Parallax file</button>
                                <button style={{ ...BTN, height: 34, padding: "0 10px" }}
                                        title="Give everyone here access to a whole case"
                                        onClick={() => setSendingCase(true)}>Case</button>
                                <input
                                    ref={fileRef} type="file" multiple style={{ display: "none" }}
                                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.csv,.txt,.json,.geojson"
                                    onChange={(e) => { sendFiles(e.target.files); e.target.value = "" }}
                                />
                                <textarea
                                    value={draft} onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        // Enter sends; Shift+Enter is a new line. The
                                        // other way round is a chat people write essays in.
                                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() }
                                    }}
                                    placeholder={`Message ${open.title}`}
                                    rows={1}
                                    style={{
                                        flex: 1, minHeight: 34, maxHeight: 140, resize: "none",
                                        padding: "8px 10px", background: "var(--glass2)",
                                        border: "1px solid var(--gline)", color: "var(--txt)",
                                        font: "400 13px/1.5 var(--font)", outline: "none", borderRadius: 0,
                                    }}
                                />
                                <button style={{ ...PRIMARY, height: 34, padding: "0 16px" }}
                                        onClick={send} disabled={!draft.trim()}>Send</button>
                            </div>
                            {sending && (
                                <div style={{
                                    flexShrink: 0, padding: "0 12px 10px",
                                    font: "400 11px var(--mono)", color: "var(--acc-hi)",
                                }}>Sending {sending}…</div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {composing && (
                <PeoplePicker
                    people={people}
                    exclude={composing === "add" ? (open?.members || []).map((p) => p.id) : []}
                    mode={composing}
                    onClose={() => setComposing(null)}
                    onDirect={startWith}
                    onGroup={startGroup}
                    onAdd={invite}
                />
            )}

            {picking && (
                <CaseFilePicker onPick={sendCaseFile} onClose={() => setPicking(false)} />
            )}

            {sendingCase && open && (
                <CaseSendPicker
                    conversation={open}
                    onPick={sendWholeCase}
                    onClose={() => setSendingCase(false)}
                />
            )}

            {card && (
                <PersonCard
                    person={card} isMe={card.id === me?.id}
                    onClose={() => setCard(null)}
                    onMessage={startWith}
                />
            )}
        </div>
    )
}

function preview(c, meId) {
    const m = c.last_message
    if (!m) return "No messages yet"
    if (m.kind === "system") return m.body
    const who = m.sender_id === meId ? "You" : (m.sender?.name || "").split(" ")[0]
    const body = m.deleted ? "message deleted" : (m.body || attachmentLabel(m))
    return c.kind === "group" || m.sender_id === meId ? `${who}: ${body}` : body
}

function attachmentLabel(m) {
    if (m.kind === "file") return m.attachment?.name || "a file"
    if (m.kind === "case") return `the case ${m.attachment?.case_title || ""}`.trim()
    if (m.kind === "signal") return "a signal"
    if (m.kind === "case") return "a case"
    return ""
}

/**
 * Downscale a picked picture to a 256px square data URL, in the browser.
 *
 * The server caps what it will store; this makes sure a 6MB photograph
 * never travels at all, rather than travelling and being refused.
 */
function squarePicture(file, size = 256) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
            URL.revokeObjectURL(url)
            const c = document.createElement("canvas")
            c.width = size; c.height = size
            const s = Math.min(img.width, img.height)
            c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
            resolve(c.toDataURL("image/jpeg", 0.82))
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("that file is not an image this browser can read")) }
        img.src = url
    })
}

/** A group's picture, or the initials of its name. */
function GroupFace({ conv, size = 36, onClick = null }) {
    const letters = (conv.title || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    return (
        <div onClick={onClick} title={conv.title} style={{
            position: "relative",
            width: size, height: size, flex: "none", borderRadius: "50%", overflow: "hidden",
            background: "var(--hov)", border: "1px solid var(--gline2)",
            display: "grid", placeItems: "center", cursor: onClick ? "pointer" : "default",
            font: `500 ${Math.max(9, Math.round(size * 0.34))}px var(--font)`, color: "var(--txt-2)",
        }}>
            {conv.avatar
                /* Pinned to the box — see Face in PersonCard.jsx for why a
                   percentage height does not survive place-items: center. */
                ? <img src={conv.avatar} alt="" style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%", objectFit: "cover",
                  }} />
                : letters}
        </div>
    )
}

function Bubble({ m, meId, group, conversationId, runOn, onPerson, onDelete }) {
    if (m.kind === "system") {
        return (
            <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
                <span style={{
                    font: "400 11px var(--font)", color: "var(--txt-3)", textAlign: "center",
                    padding: "3px 10px", background: "var(--glass2)", border: "1px solid var(--gline)",
                    maxWidth: 440,
                }}>{m.body}</span>
            </div>
        )
    }
    const mine = m.sender_id === meId
    return (
        <div style={{
            display: "flex", gap: 8, marginTop: runOn ? 2 : 10,
            flexDirection: mine ? "row-reverse" : "row",
            alignItems: "flex-end",
        }}>
            {/* The picture only on the first of a run — one face repeated
                down nine consecutive lines is noise, not attribution. */}
            <div style={{ width: 26, flexShrink: 0 }}>
                {!mine && !runOn && (
                    <Face person={m.sender} size={26} onClick={() => m.sender && onPerson(m.sender)} />
                )}
            </div>
            <div style={{ maxWidth: "min(62%, 560px)", minWidth: 0 }}>
                {group && !mine && !runOn && m.sender && (
                    <div onClick={() => onPerson(m.sender)} style={{
                        font: "600 11px var(--font)", color: "var(--acc-hi)",
                        marginBottom: 2, cursor: "pointer",
                    }}>{m.sender.name}</div>
                )}
                <div
                    style={{
                        padding: m.attachment ? 0 : "7px 11px",
                        background: mine ? "var(--acc-dim)" : "var(--glass2)",
                        border: `1px solid ${mine ? "var(--acc-line)" : "var(--gline)"}`,
                        color: m.deleted ? "var(--txt-3)" : "var(--txt)",
                        font: `${m.deleted ? "italic 400" : "400"} 13px/1.55 var(--font)`,
                        whiteSpace: m.attachment ? "normal" : "pre-wrap", wordBreak: "break-word",
                        overflow: "hidden",
                    }}
                >
                    {m.deleted && "This message was deleted"}
                    {!m.deleted && m.attachment && (
                        m.kind === "case"
                            ? <CaseShared att={m.attachment} mine={mine} />
                            : <Attachment att={m.attachment} url={attachmentUrl(conversationId, m.id)} />
                    )}
                    {!m.deleted && m.body && (
                        <div
                            title={mine ? "Click to delete" : undefined}
                            onClick={() => { if (mine) onDelete(m) }}
                            style={{
                                padding: m.attachment ? "7px 11px" : 0,
                                cursor: mine ? "pointer" : "default",
                                whiteSpace: "pre-wrap",
                            }}
                        >{m.body}</div>
                    )}
                    {!m.deleted && m.attachment && mine && !m.body && (
                        <div onClick={() => onDelete(m)} title="Click to delete" style={{
                            padding: "4px 11px 6px", font: "400 10px var(--mono)",
                            color: "var(--txt-3)", cursor: "pointer",
                        }}>delete</div>
                    )}
                </div>
                <div style={{
                    font: "400 9.5px var(--mono)", color: "var(--txt-3)", marginTop: 2,
                    textAlign: mine ? "right" : "left",
                }}>{when(m.created_at)}</div>
            </div>
        </div>
    )
}

/**
 * A file in the thread.
 *
 * An image shows itself — a card saying "scan.png, 240 KB" for a picture
 * is a worse answer than the picture. Everything else is a row you can
 * download, and a file that came out of a case says which case, so the
 * reader knows what they are looking at without a seat on it.
 */
function Attachment({ att, url }) {
    const isImage = (att.mime || "").startsWith("image/")
    const size = att.size == null ? ""
        : att.size < 1024 ? `${att.size} B`
        : att.size < 1048576 ? `${Math.round(att.size / 1024)} KB`
        : `${(att.size / 1048576).toFixed(1)} MB`

    if (isImage) {
        return (
            <a href={url} download={att.name} style={{ display: "block", textDecoration: "none" }}>
                <img src={url} alt={att.name} style={{
                    display: "block", maxWidth: "100%", maxHeight: 320, objectFit: "contain",
                    background: "var(--glass2)",
                }} />
                <div style={{
                    padding: "5px 10px", font: "400 10.5px var(--mono)", color: "var(--txt-3)",
                    display: "flex", gap: 8,
                }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
                    <span style={{ marginLeft: "auto", flexShrink: 0 }}>{size}</span>
                </div>
                {att.from && <FromCase from={att.from} />}
            </a>
        )
    }

    return (
        <div>
            <a href={url} download={att.name} style={{
                display: "flex", alignItems: "center", gap: 9, padding: "9px 11px",
                textDecoration: "none", color: "var(--txt)",
            }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="var(--txt-3)" strokeWidth="1.3" style={{ flexShrink: 0 }} aria-hidden="true">
                    <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                    <path d="M13 3v5h5" />
                </svg>
                <div style={{ minWidth: 0 }}>
                    <div style={{
                        font: "500 12.5px var(--font)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300,
                    }}>{att.name}</div>
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                        {[size, "download"].filter(Boolean).join(" · ")}
                    </div>
                </div>
            </a>
            {att.from && <FromCase from={att.from} />}
        </div>
    )
}

function FromCase({ from }) {
    return (
        <div style={{
            padding: "4px 11px 7px", font: "400 10px var(--mono)", color: "var(--txt-3)",
            borderTop: "1px solid var(--gline)",
        }}>from the case “{from.case_title || from.case_id}”</div>
    )
}

/**
 * Picking a Parallax file to send.
 *
 * Flat and searched, not a folder tree: choosing a file to send is almost
 * always "the Hodeidah scan", and making somebody walk a tree to find
 * something they can already name is work the search box does for free.
 */
function CaseFilePicker({ onPick, onClose }) {
    const [rows, setRows] = useState(null)
    const [q, setQ] = useState("")

    useEffect(() => {
        let live = true
        const t = setTimeout(() => {
            attachableFiles(q.trim() || undefined)
                .then((v) => { if (live) setRows(v) })
                .catch(() => { if (live) setRows([]) })
        }, q ? 220 : 0)
        return () => { live = false; clearTimeout(t) }
    }, [q])

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.5)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="case-file-picker" style={{
                width: 460, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{ flex: 1, minWidth: 0, font: "600 13px var(--font)", color: "var(--txt)" }}>
                        Send a file from a case
                    </b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, flex: "none", padding: "0 6px" }}>✕</button>
                </div>
                <div style={{ padding: "10px 14px" }}>
                    <input
                        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Search your case files"
                        style={{
                            width: "100%", height: 28, padding: "0 9px", background: "var(--glass2)",
                            border: "1px solid var(--gline)", color: "var(--txt)",
                            font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                        }}
                    />
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: "1px solid var(--gline)" }}>
                    {rows === null && <Loading size={18} inline label="Looking" style={{ padding: 14 }} />}
                    {rows !== null && !rows.length && (
                        <p style={{ padding: 14, font: "400 12px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            {q.trim()
                                ? "No file in your cases matches that."
                                : "You have no files in any case yet. Anything you file — a signal, a screenshot, a briefing — can be sent from here."}
                        </p>
                    )}
                    {(rows || []).map((r) => (
                        <div key={r.node_id} onClick={() => onPick(r)} style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                            borderBottom: "1px solid var(--gline)", cursor: "pointer",
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    font: "500 12.5px var(--font)", color: "var(--txt)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{r.name}</div>
                                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                    {r.case_title} · {r.kind === "doc" ? "document" : (r.mime || "file")}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

/**
 * Sending a whole case.
 *
 * It says plainly what is about to happen — these people will be able to
 * open this case and everything in it — because sharing a workspace is a
 * grant, and a grant made by pressing a button labelled "Case" with no
 * further words is one nobody remembers making.
 */
function CaseSendPicker({ conversation, onPick, onClose }) {
    const [rows, setRows] = useState(null)
    const [canEdit, setCanEdit] = useState(false)
    const [chosen, setChosen] = useState(null)

    useEffect(() => {
        let live = true
        sendableCases().then((v) => { if (live) setRows(v) }).catch(() => { if (live) setRows([]) })
        return () => { live = false }
    }, [])

    const who = (conversation.members || []).map((m) => m.name).join(", ")

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.5)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="case-send-picker" style={{
                width: 460, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{ flex: 1, minWidth: 0, font: "600 13px var(--font)", color: "var(--txt)" }}>
                        Send a case
                    </b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, flex: "none", padding: "0 6px" }}>✕</button>
                </div>

                <p style={{
                    margin: 0, padding: "11px 14px", font: "400 12px/1.65 var(--font)",
                    color: "var(--txt-2)", borderBottom: "1px solid var(--gline)",
                }}>
                    A case is shared, not copied — it keeps changing after this message. Sending it
                    lets <b style={{ fontWeight: 600 }}>{who}</b> open it and everything filed in it.
                </p>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                    {rows === null && <Loading size={18} inline label="Looking" style={{ padding: 14 }} />}
                    {rows !== null && !rows.length && (
                        <p style={{ padding: 14, font: "400 12px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            You do not own any cases yet. Only an owner can send a case — a case that was
                            shared with you stays theirs to share.
                        </p>
                    )}
                    {(rows || []).map((r) => (
                        <label key={r.case_id} style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                            borderBottom: "1px solid var(--gline)", cursor: "pointer",
                            background: chosen === r.case_id ? "var(--acc-dim)" : "transparent",
                        }}>
                            <input type="radio" name="case" checked={chosen === r.case_id}
                                   onChange={() => setChosen(r.case_id)} style={{ margin: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    font: "500 12.5px var(--font)", color: "var(--txt)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{r.title}</div>
                                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                    {r.case_id} · {r.files} file{r.files === 1 ? "" : "s"}
                                    {r.stage ? ` · ${r.stage}` : ""}
                                </div>
                            </div>
                        </label>
                    ))}
                </div>

                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                    borderTop: "1px solid var(--gline)",
                }}>
                    <label style={{
                        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7,
                        font: "400 11.5px var(--font)", color: "var(--txt-2)", cursor: "pointer",
                    }}>
                        <input type="checkbox" checked={canEdit}
                               onChange={(e) => setCanEdit(e.target.checked)} style={{ margin: 0 }} />
                        Let them edit it too
                    </label>
                    <button style={{ ...BTN, flex: "none" }} onClick={onClose}>Cancel</button>
                    <button style={{ ...PRIMARY, flex: "none" }} disabled={!chosen}
                            onClick={() => onPick((rows || []).find((r) => r.case_id === chosen), canEdit)}>
                        Send
                    </button>
                </div>
            </div>
        </div>
    )
}

/** A case in the thread: what was shared, with whom, and how much of it. */
function CaseShared({ att, mine }) {
    return (
        <div
            onClick={() => window.dispatchEvent(new CustomEvent("akili:open-case", {
                detail: { caseId: att.case_id },
            }))}
            style={{ padding: "9px 11px", cursor: "pointer" }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--txt-3)"
                     strokeWidth="1.3" style={{ flexShrink: 0 }} aria-hidden="true">
                    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5.2l1.8 2.2h8A1.5 1.5 0 0 1 20 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 2 18z" />
                </svg>
                <div style={{ minWidth: 0 }}>
                    <div style={{ font: "600 12.5px var(--font)", color: "var(--txt)" }}>{att.case_title}</div>
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                        {att.files} file{att.files === 1 ? "" : "s"} · {att.can_edit ? "can edit" : "read only"} · open
                    </div>
                </div>
            </div>
            {/* WHO WAS GIVEN ACCESS, on the message. A grant with no record
                of what was handed over is how somebody ends up not knowing
                who can read their work. */}
            {att.granted_to?.length > 0 && (
                <div style={{
                    marginTop: 6, paddingTop: 5, borderTop: "1px solid var(--gline)",
                    font: "400 10px var(--mono)", color: "var(--txt-3)",
                }}>
                    {mine ? "You gave access to" : "Access given to"} {att.granted_to.join(", ")}
                </div>
            )}
        </div>
    )
}

function GroupPanel({ conv, meId, onPerson, onRemove, onRename, onAdd, onPicture }) {
    const [name, setName] = useState(conv.title)
    useEffect(() => { setName(conv.title) }, [conv.title])
    const amAdmin = conv.my_role === "admin"
    const pic = useRef(null)
    return (
        <div style={{
            width: 248, flexShrink: 0, borderLeft: "1px solid var(--gline)",
            overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 14,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <GroupFace conv={conv} size={54} onClick={amAdmin ? () => pic.current?.click() : null} />
                <div style={{ minWidth: 0 }}>
                    {amAdmin ? (
                        <>
                            <button style={{ ...BTN, height: 22 }} onClick={() => pic.current?.click()}>
                                {conv.avatar ? "Change picture" : "Add a picture"}
                            </button>
                            {conv.avatar && (
                                <button style={{ ...BTN, height: 22, border: 0, padding: "0 4px" }}
                                        onClick={() => onPicture(null)}>Remove</button>
                            )}
                        </>
                    ) : (
                        <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                            Only a group admin can change the picture.
                        </span>
                    )}
                </div>
                <input
                    ref={pic} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ""
                        if (f) onPicture(await squarePicture(f))
                    }}
                />
            </div>

            <div>
                <div style={{ ...EYE, marginBottom: 6 }}>Group name</div>
                <input
                    value={name} disabled={!amAdmin}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => { if (amAdmin && name.trim() && name.trim() !== conv.title) onRename(name.trim()) }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
                    style={{
                        width: "100%", height: 28, padding: "0 8px", background: "var(--glass2)",
                        border: "1px solid var(--gline)", color: amAdmin ? "var(--txt)" : "var(--txt-3)",
                        font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                    }}
                />
                {!amAdmin && (
                    <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>
                        Only a group admin can rename it.
                    </span>
                )}
            </div>

            <div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                    <span style={EYE}>{conv.member_count} people</span>
                    <div style={{ flex: 1 }} />
                    <button style={{ ...BTN, height: 21 }} onClick={onAdd}>Add</button>
                </div>
                {(conv.members || []).map((p) => (
                    <div key={p.id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
                        borderBottom: "1px solid var(--gline)",
                    }}>
                        <Face person={p} size={24} onClick={() => onPerson(p)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                font: "500 11.5px var(--font)", color: "var(--txt)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                                {p.name}{p.id === meId ? " (you)" : ""}
                            </div>
                            {p.role === "admin" && (
                                <div style={{ font: "400 9.5px var(--mono)", color: "var(--txt-3)" }}>group admin</div>
                            )}
                        </div>
                        {(p.id === meId || amAdmin) && (
                            <button
                                onClick={() => onRemove(p.id)}
                                title={p.id === meId ? "Leave the group" : "Remove"}
                                style={{
                                    border: 0, background: "transparent", color: "var(--txt-3)",
                                    font: "400 11px var(--font)", cursor: "pointer", padding: "0 2px",
                                }}
                            >{p.id === meId ? "leave" : "✕"}</button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

/**
 * Choosing people.
 *
 * One component for all three jobs — message one person, start a group,
 * add to an existing one — because they are the same question with a
 * different button at the end.
 */
function PeoplePicker({ people, exclude, mode, onClose, onDirect, onGroup, onAdd }) {
    const [picked, setPicked] = useState(() => new Set())
    const [q, setQ] = useState("")
    const [title, setTitle] = useState("")

    const list = useMemo(() => {
        const text = q.trim().toLowerCase()
        return (people || [])
            .filter((p) => !exclude.includes(p.id))
            .filter((p) => !text || `${p.name} ${p.email} ${p.company || ""}`.toLowerCase().includes(text))
    }, [people, exclude, q])

    const toggle = (id) => setPicked((p) => {
        const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n
    })

    const go = () => {
        const ids = [...picked]
        if (mode === "add") return onAdd(ids)
        if (ids.length === 1) return onDirect(list.find((p) => p.id === ids[0]) || { id: ids[0] })
        return onGroup(ids, title.trim())
    }

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.5)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="people-picker" style={{
                width: 420, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "12px 14px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{
                        flex: 1, minWidth: 0, font: "600 13px var(--font)", color: "var(--txt)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                        {mode === "add" ? "Add people to the group" : "New message"}
                    </b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, flex: "none", padding: "0 6px" }}>✕</button>
                </div>

                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                        autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Search people"
                        style={{
                            height: 28, padding: "0 9px", background: "var(--glass2)",
                            border: "1px solid var(--gline)", color: "var(--txt)",
                            font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                        }}
                    />
                    {/* The name box appears only once it is a group. Asking
                        for one while you have picked a single person is
                        asking a question that may never apply. */}
                    {mode !== "add" && picked.size > 1 && (
                        <input
                            value={title} onChange={(e) => setTitle(e.target.value)}
                            placeholder="Group name (optional)"
                            style={{
                                height: 28, padding: "0 9px", background: "var(--glass2)",
                                border: "1px solid var(--gline)", color: "var(--txt)",
                                font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                            }}
                        />
                    )}
                </div>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: "1px solid var(--gline)" }}>
                    {!list.length && (
                        <p style={{ padding: "14px", font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                            {q.trim() ? "Nobody matches that." : "There is nobody else to message yet."}
                        </p>
                    )}
                    {list.map((p) => (
                        <label key={p.id} style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                            borderBottom: "1px solid var(--gline)", cursor: "pointer",
                            background: picked.has(p.id) ? "var(--acc-dim)" : "transparent",
                        }}>
                            <input type="checkbox" checked={picked.has(p.id)}
                                   onChange={() => toggle(p.id)} style={{ margin: 0 }} />
                            <Face person={p} size={28} />
                            <div style={{ minWidth: 0 }}>
                                <div style={{ font: "500 12.5px var(--font)", color: "var(--txt)" }}>{p.name}</div>
                                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                    {[p.title, p.company].filter(Boolean).join(" · ") || p.email}
                                </div>
                            </div>
                        </label>
                    ))}
                </div>

                {/* The STATUS LINE SHRINKS, THE BUTTONS DO NOT. Both were
                    flexible, so "2 selected — this will be a group" pushed
                    the buttons off the end of a 420px sheet. */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
                    borderTop: "1px solid var(--gline)",
                }}>
                    <span style={{
                        flex: 1, minWidth: 0, font: "400 11px var(--mono)", color: "var(--txt-3)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                        {picked.size
                            ? `${picked.size} selected${mode !== "add" && picked.size > 1 ? " · group" : ""}`
                            : "Nobody selected"}
                    </span>
                    <button style={{ ...BTN, flex: "none" }} onClick={onClose}>Cancel</button>
                    <button style={{ ...PRIMARY, flex: "none", whiteSpace: "nowrap" }}
                            disabled={!picked.size} onClick={go}>
                        {mode === "add" ? "Add" : picked.size > 1 ? "Create group" : "Message"}
                    </button>
                </div>
            </div>
        </div>
    )
}
