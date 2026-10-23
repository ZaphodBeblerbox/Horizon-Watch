/**
 * AssistantThread.jsx — the conversation, its citations, its proposals, the
 * input, and the list of past conversations. The desktop right column
 * (destinations/Situation.jsx, tab "Assistant"), the floating desktop panel
 * off the map (components/AssistantPanel.jsx) and the phone screen
 * (mobile/screens/MAssistant.jsx) all render this; only the frame differs.
 *
 * The draft and the scroll live in the store, so switching to the Inspector
 * (or to the phone's map) and back finds the thread as it was.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"
import "./assistant.css"
import ConfirmCard from "./ConfirmCard.jsx"
import AssistantForms from "./AssistantForms.jsx"
import { openCitation, openCitationSource } from "./assistantActions.js"
import {
    useAssistant, sendAssistant, confirmAssistantProposal, skipAssistantProposal, skipAssistantStep, dismissAssistantProposal,
    addFormProposal, startAssistant, setAssistantPlatform, setAssistantDraft, stopAssistant, retryAssistant, unanswered,
    restoreAssistant, newConversation, openConversation, loadConversations, renameConversation, deleteConversation,
    saveScroll, savedScroll,
} from "./assistantStore.js"

/** Focus the assistant's input wherever it is shown (the desktop '/' shortcut). */
export const FOCUS_EVENT = "plx:assistant-focus"

/** The reply split into text and [ref] markers. Pure (tested). */
export function splitRefs(text, citations = []) {
    const known = new Map((citations || []).map((c) => [c.ref, c]))
    const out = []
    let last = 0
    const re = /\[([A-Z]\d{1,3}(?:\s*[,;]\s*[A-Z]\d{1,3})*)\]/g
    let m
    while ((m = re.exec(text || ""))) {
        if (m.index > last) out.push({ text: text.slice(last, m.index) })
        for (const r of m[1].split(/[,;]/).map((s) => s.trim())) {
            if (known.has(r)) out.push({ ref: r, cite: known.get(r) })
        }
        last = m.index + m[0].length
    }
    if (last < (text || "").length) out.push({ text: text.slice(last) })
    return out
}

/** What "Copy" puts on the clipboard: the text, then its sources. Pure (tested). */
export function copyText(m) {
    const body = String(m?.content || "")
    const src = (m?.citations || []).map((c) => `[${c.ref}] ${c.label || ""}${c.url ? ` ${c.url}` : ""}`.trim())
    return src.length ? `${body}\n\nSources:\n${src.join("\n")}` : body
}

const SUGGEST = ["What's happening near my places?", "Show me Paris", "Show fires in Yemen", "Any protests live now?"]

function ago(v) {
    if (!v) return ""
    const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v).replace(" ", "T"))
    if (Number.isNaN(+d)) return ""
    const min = Math.round((Date.now() - d) / 60000)
    return min < 1 ? "now" : min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`
}

const I = {
    history: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></svg>,
    plus: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 3v10M3 8h10" /></svg>,
    setup: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>,
    close: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>,
    back: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3L5 8l5 5" /></svg>,
    copy: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M10.5 5V3.5A1 1 0 009.5 2.5h-6a1 1 0 00-1 1v6a1 1 0 001 1H5" /></svg>,
    retry: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 8a5 5 0 11-1.5-3.6M13 2.5v3h-3" /></svg>,
    edit: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13l.6-2.6L10.8 3.2l2 2-7.2 7.2z" /></svg>,
    trash: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>,
    send: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2.5 8h10M8.5 4l4 4-4 4" /></svg>,
    stop: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>,
}

function Message({ m, platform, onEdit, busy }) {
    const [copied, setCopied] = useState(false)
    const parts = m.role === "assistant" ? splitRefs(m.content, m.citations) : [{ text: m.content }]
    const copy = async () => {
        try { await navigator.clipboard.writeText(copyText(m)); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* no clipboard */ }
    }
    return (
        <div className="plx-as-msg" data-role={m.role} data-error={m.error ? "true" : undefined} data-stopped={m.stopped ? "true" : undefined}
             data-testid={`assistant-msg-${m.role}`}>
            {parts.map((p, i) => (p.ref
                ? <button key={i} className="plx-as-ref" title={p.cite.label} onClick={() => openCitation(p.cite, platform)}>{p.ref}</button>
                : <Fragment key={i}>{p.text}</Fragment>))}
            {m.citations?.length > 0 && (
                <div className="plx-as-sources" data-testid="assistant-citations">
                    {m.citations.map((c) => (
                        <button key={c.ref} className="plx-as-src" data-testid="assistant-citation" onClick={() => openCitation(c, platform)}>
                            <b>{c.ref}</b><span>{c.label}{ago(c.when) ? ` · ${ago(c.when)}` : ""}</span>
                            {c.kind === "web" && <i className="plx-as-web">web</i>}
                            {c.url && c.kind !== "web" && (
                                <span role="button" tabIndex={0} className="plx-as-srclink" data-testid="assistant-source"
                                      onClick={(e) => { e.stopPropagation(); openCitationSource(c) }}
                                      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openCitationSource(c) } }}>source</span>)}
                        </button>))}
                </div>
            )}
            {m.done?.length > 0 && (
                <div className="plx-as-done" data-testid="assistant-done">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 8h9M8 4l4 4-4 4" /></svg>
                    {m.done.join(" · ")}
                </div>
            )}
            {m.ask?.options?.length > 0 && (
                <div className="plx-as-choices">
                    {m.ask.options.map((o) => (
                        <button key={o.label} className="plx-as-chip" disabled={busy} onClick={() => sendAssistant(o.label)}>{o.label}</button>))}
                </div>
            )}
            {(m.proposals || []).map((p) => (
                <ConfirmCard key={p.token} proposal={p} platform={platform}
                             onConfirm={confirmAssistantProposal} onSkip={skipAssistantProposal} onEdit={onEdit} />))}
            {(m.error && m.retry) && (
                <div className="plx-as-tools" data-show="true">
                    <button onClick={() => retryAssistant(m)} disabled={busy} data-testid="assistant-retry">{I.retry}Retry</button>
                </div>
            )}
            {!m.error && m.content && (
                <div className="plx-as-tools">
                    <button onClick={copy} aria-label="Copy message" data-testid="assistant-copy">{I.copy}{copied ? "Copied" : "Copy"}</button>
                </div>
            )}
        </div>
    )
}

function History({ s, onPick, onBack }) {
    const [editing, setEditing] = useState(null)        // {id, title}
    const [sure, setSure] = useState(null)              // id armed for delete
    useEffect(() => { loadConversations() }, [])
    const list = s.list || []
    return (
        <div className="plx-as-log plx-as-history" data-testid="assistant-history">
            <button className="plx-as-newchat" onClick={() => { newConversation("chat"); onBack() }} data-testid="assistant-new-chat">
                {I.plus}New chat
            </button>
            {s.listLoading && !s.list && <div className="plx-as-empty">Loading…</div>}
            {s.list && list.length === 0 && <div className="plx-as-empty">No conversations yet. What you ask is kept here.</div>}
            {list.map((c) => (
                <div key={c.id} className="plx-as-conv" data-current={c.id === s.convId ? "true" : undefined} data-testid="assistant-conversation">
                    {editing?.id === c.id ? (
                        <form className="plx-as-rename" onSubmit={async (e) => { e.preventDefault(); if (await renameConversation(c.id, editing.title)) setEditing(null) }}>
                            <input autoFocus value={editing.title} maxLength={80} aria-label="Conversation name"
                                   onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                                   onKeyDown={(e) => { if (e.key === "Escape") setEditing(null) }} />
                            <button type="submit">Save</button>
                        </form>
                    ) : (
                        <button className="plx-as-conv-open" onClick={async () => { await openConversation(c.id); onPick() }}>
                            <b>{c.title || "Conversation"}</b>
                            <span>{c.last}</span>
                            <small>{ago(c.updated_at)} · {c.count} messages</small>
                        </button>
                    )}
                    {editing?.id !== c.id && (
                        <div className="plx-as-conv-tools">
                            <button className="plx-as-iconbtn" aria-label="Rename" title="Rename" onClick={() => setEditing({ id: c.id, title: c.title })}>{I.edit}</button>
                            <button className="plx-as-iconbtn" aria-label={sure === c.id ? "Delete, confirm" : "Delete"} title={sure === c.id ? "Click again to delete" : "Delete"}
                                    data-armed={sure === c.id ? "true" : undefined}
                                    onClick={() => (sure === c.id ? (deleteConversation(c.id), setSure(null)) : setSure(c.id))}>{I.trash}</button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

export default function AssistantThread({ platform = "desktop", title = "Assistant", onClose, autoFocus = true, hidden = false }) {
    const s = useAssistant()
    const text = s.draft
    const setText = setAssistantDraft
    const [edit, setEdit] = useState(null)        // {step, initial} a proposal being edited as a form
    const [formOpen, setFormOpen] = useState(false)
    const [showList, setShowList] = useState(false)
    const log = useRef(null)
    const box = useRef(null)
    const stick = useRef(true)                    // follow new messages unless the reader scrolled up
    useEffect(() => { setAssistantPlatform(platform) }, [platform])
    useEffect(() => { restoreAssistant() }, [])
    // back to where it was (a switch to the Inspector or the phone's map and back)
    useLayoutEffect(() => {
        const top = savedScroll()
        if (log.current && top != null) { log.current.scrollTop = top; stick.current = false }
    }, [s.convId, showList]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (stick.current) log.current?.scrollTo?.({ top: log.current.scrollHeight, behavior: "smooth" })
    }, [s.messages.length, s.loading])
    useEffect(() => { stick.current = true }, [s.convId])
    useEffect(() => { if (autoFocus && !hidden) box.current?.focus?.() }, [autoFocus, hidden])
    useEffect(() => {
        const f = () => { setShowList(false); setTimeout(() => box.current?.focus?.(), 0) }
        window.addEventListener(FOCUS_EVENT, f)
        return () => window.removeEventListener(FOCUS_EVENT, f)
    }, [])
    // the box grows with the text, up to its max height
    useLayoutEffect(() => {
        const b = box.current
        if (!b) return
        b.style.height = "auto"
        b.style.height = `${Math.min(b.scrollHeight + 2, 140)}px`
    }, [text])

    const send = () => { const t = text.trim(); if (!t || s.loading) return; setText(""); stick.current = true; sendAssistant(t) }
    const onScroll = (e) => {
        const el = e.currentTarget
        saveScroll(el.scrollTop)
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    const step = s.onboarding?.step
    const settingUp = (s.mode === "onboarding" || s.mode === "theater") && step && step !== "done"
    const off = s.model && s.model.on === false
    const last = s.messages[s.messages.length - 1]
    const showForm = edit || (settingUp && (formOpen || off || last?.forms))
    const pending = unanswered(s)
    const onEdit = (p) => {
        const d = p.data || {}
        setEdit(p.kind === "theater"
            ? { step: "theater", initial: { name: d.name, place: p.place?.label, radius: p.place?.radius_km } }
            : { step: "protect", initial: { name: d.name, kind: d.kind, place: d.address || p.place?.label, radius: d.radius_km } })
        dismissAssistantProposal(p)
    }
    const heading = showList ? "Conversations"
        : s.mode === "theater" ? "New theater" : s.mode === "onboarding" ? "Set up" : (s.title || title)

    return (
        <div className="plx-as" data-testid="assistant" data-platform={platform} data-conversation={s.convId || ""}>
            <div className="plx-as-head">
                {showList
                    ? <button className="plx-as-iconbtn" aria-label="Back to the conversation" onClick={() => setShowList(false)}>{I.back}</button>
                    : <button className="plx-as-iconbtn" aria-label="Conversations" title="Conversations" data-testid="assistant-history-btn"
                              onClick={() => setShowList(true)}>{I.history}</button>}
                <h2 title={heading}>{heading}</h2>
                {!showList && s.mode !== "onboarding" && <button className="plx-as-iconbtn" title="Set me up" aria-label="Set me up" onClick={() => startAssistant("onboarding")}>{I.setup}</button>}
                {!showList && (s.messages.length > 0 || s.mode !== "chat") && (
                    <button className="plx-as-iconbtn" title="New chat" aria-label="New chat" data-testid="assistant-new" onClick={() => newConversation("chat")}>{I.plus}</button>)}
                {onClose && <button className="plx-as-iconbtn" aria-label="Close" onClick={onClose}>{I.close}</button>}
            </div>
            {showList ? <History s={s} onPick={() => setShowList(false)} onBack={() => setShowList(false)} /> : (
            <div className="plx-as-log" ref={log} onScroll={onScroll} data-testid="assistant-log">
                {s.restoring && s.messages.length === 0 && <div className="plx-as-empty">Opening the conversation…</div>}
                {!s.restoring && s.messages.length === 0 && !s.loading && (
                    <div className="plx-as-empty">
                        Ask about a place, your assets or your theaters. Answers come only from what Parallax holds, each with its source.
                        {SUGGEST.map((q) => <button key={q} onClick={() => sendAssistant(q)}>{q}</button>)}
                        <button onClick={() => startAssistant("onboarding")}>Set me up</button>
                    </div>
                )}
                {s.messages.map((m, i) => <Message key={m.id || `${m.turnId || "l"}-${i}`} m={m} platform={platform} onEdit={onEdit} busy={s.loading} />)}
                {pending && (
                    <div className="plx-as-msg" data-role="assistant" data-error="true" data-testid="assistant-unanswered">
                        No answer was kept for this question.
                        <div className="plx-as-tools" data-show="true">
                            <button onClick={() => retryAssistant(pending)} data-testid="assistant-retry">{I.retry}Retry</button>
                        </div>
                    </div>
                )}
                {s.loading && <div className="plx-as-msg" data-role="assistant" aria-label="Answering"><span className="plx-as-dots"><i /><i /><i /></span></div>}
                {settingUp && step === "care" && !showForm && (
                    <div className="plx-as-choices">
                        {(s.onboarding?.chips?.regions || []).slice(0, 6).map((r) => <button key={r} className="plx-as-chip" onClick={() => sendAssistant(r)}>{r}</button>)}
                    </div>
                )}
                {settingUp && step === "alert" && !showForm && (
                    <div className="plx-as-choices">
                        {Object.entries(s.onboarding?.chips?.levels || {}).map(([k, l]) => <button key={k} className="plx-as-chip" onClick={() => sendAssistant(l)}>{l}</button>)}
                    </div>
                )}
                {showForm && (
                    <AssistantForms key={(edit?.step || step) + (edit ? "-edit" : "")} step={edit?.step || step} chips={s.onboarding?.chips}
                                    initial={edit?.initial || {}}
                                    onProposal={(p) => { setEdit(null); addFormProposal(p) }}
                                    onSkip={edit ? () => setEdit(null) : skipAssistantStep} />
                )}
            </div>)}
            {!showList && (
            <div className="plx-as-foot">
                {off && (
                    <div className="plx-as-off" role="status" data-testid="assistant-off">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5v4.2M8 11.2v.3" /></svg>
                        <span>{s.model.why} Map commands and the forms still work.</span>
                    </div>
                )}
                <div className="plx-as-input">
                    <textarea ref={box} rows={1} value={text} maxLength={800} placeholder={settingUp ? "Answer, or use the form" : "Ask, or say “show me Paris”"}
                              aria-label="Message the assistant" data-testid="assistant-input" onChange={(e) => setText(e.target.value)}
                              onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send() }
                                  else if (e.key === "Escape" && s.loading) { e.preventDefault(); stopAssistant() }
                              }} />
                    {s.loading
                        ? <button className="plx-as-send" data-stop="true" aria-label="Stop" title="Stop" data-testid="assistant-stop" onClick={stopAssistant}>{I.stop}</button>
                        : <button className="plx-as-send" aria-label="Send" data-testid="assistant-send" disabled={!text.trim()} onClick={send}>{I.send}</button>}
                </div>
                <div className="plx-as-meta">
                    <span>{platform === "phone" ? "Sources are linked; nothing is created until you confirm."
                        : "Enter sends, Shift+Enter a new line. Nothing is created until you confirm."}</span>
                    {settingUp && !showForm && <button onClick={() => setFormOpen(true)}>Use a form</button>}
                </div>
            </div>)}
        </div>
    )
}
