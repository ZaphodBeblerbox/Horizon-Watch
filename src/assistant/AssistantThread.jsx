/**
 * AssistantThread.jsx — the conversation, its citations, its proposals and
 * the input. The desktop panel (components/AssistantPanel.jsx) and the phone
 * screen (mobile/screens/MAssistant.jsx) both render this; only the frame
 * around it differs.
 */
import { Fragment, useEffect, useRef, useState } from "react"
import "./assistant.css"
import ConfirmCard from "./ConfirmCard.jsx"
import AssistantForms from "./AssistantForms.jsx"
import { openCitation } from "./assistantActions.js"
import {
    useAssistant, sendAssistant, confirmAssistantProposal, skipAssistantProposal, skipAssistantStep, dismissAssistantProposal,
    addFormProposal, startAssistant, setAssistantPlatform,
} from "./assistantStore.js"

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

const SUGGEST = {
    chat: ["What's happening near my places?", "Show me Paris", "Show fires in Yemen", "Any protests live now?"],
}

function when(c) {
    if (!c?.when) return ""
    const d = new Date(String(c.when).replace(" ", "T"))
    if (Number.isNaN(+d)) return ""
    const min = Math.round((Date.now() - d) / 60000)
    return min < 1 ? "now" : min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`
}

function Message({ m, platform, onEdit }) {
    const parts = m.role === "assistant" ? splitRefs(m.content, m.citations) : [{ text: m.content }]
    return (
        <div className="plx-as-msg" data-role={m.role} data-error={m.error ? "true" : undefined} data-testid={`assistant-msg-${m.role}`}>
            {parts.map((p, i) => (p.ref
                ? <button key={i} className="plx-as-ref" title={p.cite.label} onClick={() => openCitation(p.cite, platform)}>{p.ref}</button>
                : <Fragment key={i}>{p.text}</Fragment>))}
            {m.citations?.length > 0 && (
                <div className="plx-as-sources" data-testid="assistant-citations">
                    {m.citations.map((c) => (
                        <button key={c.ref} className="plx-as-src" onClick={() => openCitation(c, platform)}>
                            <b>{c.ref}</b><span>{c.label}{when(c) ? ` · ${when(c)}` : ""}</span>
                            {c.url && <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>source</a>}
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
                        <button key={o.label} className="plx-as-chip" onClick={() => sendAssistant(o.label)}>{o.label}</button>))}
                </div>
            )}
            {(m.proposals || []).map((p) => (
                <ConfirmCard key={p.token} proposal={p} platform={platform}
                             onConfirm={confirmAssistantProposal} onSkip={skipAssistantProposal} onEdit={onEdit} />))}
        </div>
    )
}

export default function AssistantThread({ platform = "desktop", title = "Assistant", onClose, mode, autoFocus = true }) {
    const s = useAssistant()
    const [text, setText] = useState("")
    const [edit, setEdit] = useState(null)        // {step, initial} a proposal being edited as a form
    const [formOpen, setFormOpen] = useState(false)
    const log = useRef(null)
    const box = useRef(null)
    useEffect(() => { setAssistantPlatform(platform) }, [platform])
    useEffect(() => { if (mode) startAssistant(mode) }, [mode])
    useEffect(() => { log.current?.scrollTo?.({ top: log.current.scrollHeight, behavior: "smooth" }) }, [s.messages.length, s.loading])
    useEffect(() => { if (autoFocus) box.current?.focus?.() }, [autoFocus])

    const send = () => { const t = text.trim(); if (!t || s.loading) return; setText(""); sendAssistant(t) }
    const step = s.onboarding?.step
    const settingUp = (s.mode === "onboarding" || s.mode === "theater") && step && step !== "done"
    const off = s.model && s.model.on === false
    const last = s.messages[s.messages.length - 1]
    const showForm = edit || (settingUp && (formOpen || off || last?.forms))
    const onEdit = (p) => {
        const d = p.data || {}
        setEdit(p.kind === "theater"
            ? { step: "theater", initial: { name: d.name, place: p.place?.label, radius: p.place?.radius_km } }
            : { step: "protect", initial: { name: d.name, kind: d.kind, place: d.address || p.place?.label, radius: d.radius_km } })
        dismissAssistantProposal(p)
    }

    return (
        <div className="plx-as" data-testid="assistant" data-platform={platform}>
            <div className="plx-as-head">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#7aa7ff" strokeWidth="1.4" aria-hidden>
                    <path d="M8 1.8l1.5 3.9 3.9 1.5-3.9 1.5L8 12.6 6.5 8.7 2.6 7.2l3.9-1.5z" /><path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
                </svg>
                <h2>{s.mode === "theater" ? "New theater" : s.mode === "onboarding" ? "Set up" : title}</h2>{/* phone: the page title already says Assistant */}
                {s.mode !== "onboarding" && <button className="plx-as-iconbtn" title="Set me up" onClick={() => startAssistant("onboarding")}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>
                </button>}
                {s.messages.length > 0 && <button className="plx-as-iconbtn" title="New conversation" onClick={() => startAssistant("chat")}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 3v10M3 8h10" /></svg>
                </button>}
                {onClose && <button className="plx-as-iconbtn" aria-label="Close" onClick={onClose}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
                </button>}
            </div>
            <div className="plx-as-log" ref={log}>
                {s.messages.length === 0 && (
                    <div className="plx-as-empty">
                        Ask about a place, your assets or your theaters. Answers come only from what Parallax holds, each with its source.
                        {SUGGEST.chat.map((q) => <button key={q} onClick={() => sendAssistant(q)}>{q}</button>)}
                        <button onClick={() => startAssistant("onboarding")}>Set me up</button>
                    </div>
                )}
                {s.messages.map((m, i) => <Message key={i} m={m} platform={platform} onEdit={onEdit} />)}
                {s.loading && <div className="plx-as-msg" data-role="assistant"><span className="plx-as-dots"><i /><i /><i /></span></div>}
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
            </div>
            <div className="plx-as-foot">
                {off && (
                    <div className="plx-as-off" role="status" data-testid="assistant-off">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5v4.2M8 11.2v.3" /></svg>
                        <span>{s.model.why} Map commands and the forms still work.</span>
                    </div>
                )}
                <div className="plx-as-input">
                    <textarea ref={box} rows={1} value={text} maxLength={800} placeholder={settingUp ? "Answer, or use the form" : "Ask, or say “show me Paris”"}
                              aria-label="Message the assistant" onChange={(e) => setText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }} />
                    <button className="plx-as-send" aria-label="Send" disabled={!text.trim() || s.loading} onClick={send}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2.5 8h10M8.5 4l4 4-4 4" /></svg>
                    </button>
                </div>
                <div className="plx-as-meta">
                    <span>Sources are linked; nothing is created until you confirm.</span>
                    {settingUp && !showForm && <button onClick={() => setFormOpen(true)}>Use a form</button>}
                </div>
            </div>
        </div>
    )
}
