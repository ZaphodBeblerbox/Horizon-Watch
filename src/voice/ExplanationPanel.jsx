/**
 * ExplanationPanel.jsx — what the model said, and what it read.
 *
 * "Explain the current situation in Mali" answers in prose, so it cannot
 * be a toast. It is a sheet with the explanation and, under it, every
 * signal the explanation was written from — because an explanation whose
 * evidence the reader cannot see is an opinion, and this one will be acted
 * on.
 *
 * Each signal flies the map to itself. The point of explaining a place
 * inside a console that already holds the place is that checking a claim
 * is one click, not a second search.
 *
 * (owner, 2026-10-10) IT TAKES THE RIGHT SIDE: opening it closes the
 * inspector and the source reader (ui/sideWindows.js); another window
 * opening folds it into a chip, never under or over it. IT SHOWS ITS
 * ANSWER: the map is driven to the evidence (voice/director.js) — layers on,
 * the place framed, the strongest signals visited in turn, lit here as they
 * are shown — and "Put the map back" undoes it. AND IT CAN BE KEPT: saved as
 * a note, added to a briefing as a mini briefing with its sources, shared
 * to the Desk, or sent to a colleague.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { claimSide, onSideClaim } from "../ui/sideWindows.js"
import { direct } from "./director.js"
import { saveForBriefing } from "../state/savedForBriefing.js"
import { shareToDesk } from "../desk/shareToDesk.js"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const SEV = {
    critical: "var(--red)", significant: "var(--amber)",
    high: "var(--amber)", elevated: "var(--acc-hi)", routine: "var(--steel)",
}

export default function ExplanationPanel() {
    const [d, setD] = useState(null)
    const [folded, setFolded] = useState(false)
    const [step, setStep] = useState(null)          // which signal the map is showing
    const [touring, setTouring] = useState(false)
    const [done, setDone] = useState(null)          // what the last keep-action did
    const run = useRef(null)

    useEffect(() => {
        const on = (e) => { run.current?.stop(); setD(e.detail || null); setFolded(false); setDone(null) }
        window.addEventListener("akili:explanation", on)
        return () => window.removeEventListener("akili:explanation", on)
    }, [])
    // the side is ours while open; another window folds this into a chip
    useEffect(() => onSideClaim("answer", () => { setFolded(true) }), [])
    useEffect(() => { if (d && !folded) claimSide("answer") }, [d, folded])
    // SHOW THE ANSWER: drive the map to its evidence
    useEffect(() => {
        if (!d?.signals?.length) return undefined
        setTouring(true)
        run.current = direct(d.signals, { onStep: (i) => { setStep(i); if (i === null) setTouring(false) } })
        return () => run.current?.stop()
    }, [d])
    const close = () => { run.current?.stop(); setD(null); setStep(null) }

    useEffect(() => {
        if (!d) return undefined
        const k = (e) => { if (e.key === "Escape" && !folded) { e.stopPropagation(); close() } }
        // Capture, so this closes before app.jsx's Escape takes the view
        // back to the map — the nearest thing you opened is the thing you
        // meant to close.
        window.addEventListener("keydown", k, true)
        return () => window.removeEventListener("keydown", k, true)
    }, [d, folded])

    if (!d) return null
    if (folded) {
        return (
            <button data-testid="explanation-chip" onClick={() => setFolded(false)}
                    style={{ position: "absolute", right: 12, bottom: "calc(var(--pane-bottom) + 8px)", zIndex: 28, height: 32, padding: "0 12px",
                             display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--gline2)", background: "var(--glass)",
                             backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)", color: "var(--txt)", font: "500 12px var(--font)", cursor: "pointer", boxShadow: "var(--gshadow)" }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: "var(--acchi)" }} />Answer · {d.place}
            </button>
        )
    }
    const text = d.explanation || d.note || ""
    const sourcesList = (d.signals || []).map((s) => `- ${s.headline}${s.location ? ` (${s.location})` : ""}${s.source ? ` · ${s.source}` : ""}`).join("\n")
    /* WHAT IS KEPT IS THE ANSWER (owner, 2026-10-10: a note held only the
       question). The answer is the note's text — the line every list shows
       (savedLabel reads the headline) — with the place, and the signals it
       was read from as its context. Filed like a spoken note (filing.js),
       so it lands in the case as well as in Reports › Notes. */
    const at = d.signals?.find((s) => s.lat != null)
    const keep = {
        async note() {
            const item = { id: `answer-${Date.now()}`, kind: "note", headline: `${d.place}: ${text}`, label: `${d.place}: ${text}`,
                           region: d.place, detail: text, context: sourcesList || null, source: (d.sources || []).join(", ") || null,
                           lat: at?.lat ?? null, lon: at?.lon ?? null, when: new Date().toISOString() }
            saveForBriefing(item)
            try { const { fileSignal } = await import("../state/filing.js"); await fileSignal(item) } catch { /* kept locally */ }
            setDone("Saved as a note — Reports › Notes.")
        },
        async briefing() {
            const item = { id: `mini-${Date.now()}`, kind: "note", headline: `Mini briefing — ${d.place}: ${text}`, label: `Mini briefing — ${d.place}`,
                           region: d.place, detail: `${text}\n\nRead from ${d.count} signal${d.count === 1 ? "" : "s"}:\n${sourcesList}`,
                           context: sourcesList || null, source: (d.sources || []).join(", ") || null,
                           lat: at?.lat ?? null, lon: at?.lon ?? null, when: new Date().toISOString() }
            saveForBriefing(item)
            try { const { fileSignal } = await import("../state/filing.js"); await fileSignal(item) } catch { /* kept locally */ }
            setDone("Saved as a mini briefing with its sources — Reports › Notes; insert it into a briefing or deck from there.")
        },
        desk() {
            shareToDesk({ kind: "place", label: d.place, lat: d.signals?.find((s) => s.lat != null)?.lat ?? null, lon: d.signals?.find((s) => s.lat != null)?.lon ?? null },
                        `${d.place} — ${text.slice(0, 1200)}`)
            setDone("Opened on the Desk, ready to post.")
        },
    }
    const openSignal = (s) => {
        if (s.lat == null) return
        run.current?.stop()
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: s.lat, lon: s.lon, altitude: 60_000 } }))
    }

    return (
        <div
            data-testid="explanation-panel"
            className="pane-glass"
            /* THE SAME SIDEBAR AS EVERY OTHER (owner, 2026-10-10): the
               inspector's own place and size — right 12, top 10, the shared
               --pane-r width and --pane-bottom inset (Situation.jsx
               rightPaneStyle) — and its glass. */
            style={{
                position: "absolute", right: 12, top: 10, bottom: "var(--pane-bottom)",
                width: "var(--pane-r)", zIndex: 28,
                display: "flex", flexDirection: "column", overflow: "hidden",
                border: "1px solid var(--gline)",
            }}
        >
            <div style={{
                display: "flex", alignItems: "center", gap: 9, padding: "11px 13px",
                borderBottom: "1px solid var(--gline)", flexShrink: 0,
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>{d.place}</div>
                    <div style={EYE}>
                        {d.count ? `from ${d.count} signal${d.count === 1 ? "" : "s"}` : "nothing held"}
                        {d.sources?.length ? ` · ${d.sources.join(", ")}` : ""}
                    </div>
                </div>
                <button onClick={close} aria-label="Close" style={{
                    width: 24, height: 24, border: "1px solid var(--gline2)",
                    background: "transparent", color: "var(--txt-3)",
                    cursor: "pointer", borderRadius: 0, font: "400 11px var(--font)",
                }}>✕</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 13 }}>
                {d.explanation
                    ? <div style={{
                        font: "400 13.5px/1.7 var(--font)", color: "var(--txt)",
                        whiteSpace: "pre-wrap", textWrap: "pretty",
                      }}>{d.explanation}</div>
                    : <p style={{
                        margin: 0, font: "400 12.5px/1.7 var(--font)", color: "var(--txt-3)",
                        textWrap: "pretty",
                      }}>{d.note || "Nothing to explain."}</p>}

                {d.signals?.length > 0 && (
                    <>
                        <div style={{ ...EYE, margin: "18px 0 7px" }}>What it read</div>
                        {d.signals.map((s, i) => (
                            <div
                                key={i}
                                onClick={() => openSignal(s)}
                                data-showing={step === i || undefined}
                                style={{
                                    display: "flex", gap: 8, padding: "7px 6px", margin: "0 -6px",
                                    borderBottom: "1px solid var(--gline)",
                                    cursor: s.lat != null ? "pointer" : "default",
                                    background: step === i ? "var(--accdim)" : "transparent",
                                    boxShadow: step === i ? "inset 2px 0 0 var(--acchi)" : "none",
                                    transition: "background 200ms ease",
                                }}
                            >
                                <i style={{
                                    width: 6, height: 6, marginTop: 5, flexShrink: 0,
                                    background: SEV[String(s.severity || "").toLowerCase()] || "var(--steel)",
                                }} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ font: "400 12px/1.5 var(--font)", color: "var(--txt-2)" }}>
                                        {s.headline}
                                    </div>
                                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                                        {[s.location, s.source].filter(Boolean).join(" · ")}
                                        {s.lat != null ? " · on the map →" : ""}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            {d.signals?.length > 0 && (
                <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center", padding: "8px 13px", borderTop: "1px solid var(--gline)" }}>
                    <span style={{ flex: 1, font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                        {touring ? (step != null ? `Showing ${(d.signals[step]?.location || d.signals[step]?.headline || "").slice(0, 40)}…` : "Taking you to the evidence…") : "The map shows what this was read from."}
                    </span>
                    {touring
                        ? <button style={KBTN} onClick={() => { run.current?.stop(); setTouring(false) }}>Stop</button>
                        : <button style={KBTN} onClick={() => { setTouring(true); run.current = direct(d.signals, { onStep: (i) => { setStep(i); if (i === null) setTouring(false) } }) }}>Show again</button>}
                    <button style={KBTN} onClick={() => { run.current?.restore(); setTouring(false) }}>Put the map back</button>
                </div>
            )}
            {text && (
                <div data-testid="answer-keep" style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 13px", borderTop: "1px solid var(--gline)" }}>
                    <button style={KBTN} onClick={keep.note}>Save as note</button>
                    <button style={KBTN} onClick={keep.briefing}>Mini briefing</button>
                    <button style={KBTN} onClick={keep.desk}>Share to Desk</button>
                    <SendTo place={d.place} text={text} onSent={setDone} />
                    {done && <div style={{ flexBasis: "100%", font: "400 11px var(--font)", color: "var(--txt-2)" }}>{done}</div>}
                </div>
            )}
            {d.explanation && (
                <div style={{
                    flexShrink: 0, padding: "8px 13px", borderTop: "1px solid var(--gline)",
                    font: "400 10.5px/1.5 var(--font)", color: "var(--txt-3)",
                }}>
                    Written by a model from the signals above. It is not an assessment and
                    nothing in it was checked.
                </div>
            )}
        </div>
    )
}

const KBTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt-2)", cursor: "pointer", borderRadius: 0, font: "500 11.5px var(--font)", whiteSpace: "nowrap",
}

/** Send the answer to a colleague, as a message. */
function SendTo({ place, text, onSent }) {
    const [open, setOpen] = useState(false)
    const [users, setUsers] = useState(null)
    useEffect(() => {
        if (!open || users) return
        fetch(`${API_BASE}/api/users`, { credentials: "include" }).then((r) => (r.ok ? r.json() : []))
            .then((d) => setUsers(Array.isArray(d) ? d : (d.users || []))).catch(() => setUsers([]))
    }, [open, users])
    const send = async (u) => {
        try {
            const { startConversation, sendMessage } = await import("../lib/chatApi.js")
            const c = await startConversation({ kind: "direct", user_ids: [u.id] })
            await sendMessage(c.id, { body: `${place}\n\n${text}` })
            onSent(`Sent to ${u.name || u.email}.`)
        } catch (e) { onSent(`Not sent: ${e.message || "the message did not go"}`) }
        setOpen(false)
    }
    return (
        <span style={{ position: "relative" }}>
            <button style={KBTN} onClick={() => setOpen((o) => !o)} aria-expanded={open}>Send to…</button>
            {open && (
                <div role="menu" style={{ position: "absolute", bottom: 30, left: 0, zIndex: 3, minWidth: 200, maxHeight: 240, overflow: "auto",
                                          background: "var(--glass, #111827)", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)" }}>
                    {users == null ? <div style={{ padding: 8, fontSize: 12, color: "var(--txt-3)" }}>Loading…</div>
                        : !users.length ? <div style={{ padding: 8, fontSize: 12, color: "var(--txt-3)" }}>No colleagues found.</div>
                        : users.map((u) => (
                            <button key={u.id} role="menuitem" onClick={() => send(u)}
                                    style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: 0, background: "none", color: "var(--txt)", cursor: "pointer", font: "400 12px var(--font)" }}>
                                {u.name || u.email}
                            </button>
                        ))}
                </div>
            )}
        </span>
    )
}
