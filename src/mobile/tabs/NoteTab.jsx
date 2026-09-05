import { useState, useEffect, useRef } from "react"
import { getForgeAlerts, sendDeskNote, listDeskNotes } from "../mobileApi.js"

const ROUTES = [
    { id: "duty_desk", label: "Duty desk" },
    { id: "group_security", label: "Group security" },
    { id: "regional_lead", label: "Regional lead" },
    { id: "logistics", label: "Logistics" },
]

export default function NoteTab({ pendingReference, onReferenceConsumed }) {
    const [route, setRoute] = useState("duty_desk")
    const [kind, setKind] = useState("text")
    const [text, setText] = useState("")
    const [queueRefs, setQueueRefs] = useState([])
    const [selectedRef, setSelectedRef] = useState(null)
    const [outbox, setOutbox] = useState([])
    const [sending, setSending] = useState(false)
    const [recording, setRecording] = useState(false)
    const [recordSeconds, setRecordSeconds] = useState(0)
    const [audioBlob, setAudioBlob] = useState(null)
    const mediaRef = useRef(null)
    const chunksRef = useRef([])
    const timerRef = useRef(null)
    const cancelledRef = useRef(false)

    function refreshOutbox() { listDeskNotes().then(setOutbox).catch(() => {}) }
    useEffect(() => { refreshOutbox() }, [])

    // Real on-call queue (escalated/critical/high, capped at 12) for the
    // reference picker.
    useEffect(() => {
        getForgeAlerts().then((d) => {
            const alerts = Array.isArray(d) ? d : []
            const onCall = alerts
                .filter((a) => a.severity === "critical" || a.severity === "high" || (a.tags || []).includes("escalated"))
                .slice(0, 12)
                .map((a) => ({ kind: "signal", id: a.id, label: a.title }))
            setQueueRefs(onCall)
        }).catch(() => {})
    }, [])

    // Real bug #6 fix: a reference reached from anywhere (Alerts or Brief)
    // is carried in real top-level app state (MobileApp.jsx's
    // pendingNoteRef), not just this picker's own local, capped queue list
    // — so a moderate-severity Brief reference outside that capped list is
    // never silently dropped to "None". The picker's own render always
    // includes it, prepended when the queue doesn't already contain it.
    useEffect(() => {
        if (pendingReference) {
            setSelectedRef(pendingReference)
            onReferenceConsumed?.()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingReference])

    const pickerOptions = (() => {
        if (!selectedRef) return queueRefs
        const already = queueRefs.some((r) => r.kind === selectedRef.kind && r.id === selectedRef.id)
        return already ? queueRefs : [selectedRef, ...queueRefs]
    })()

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const rec = new MediaRecorder(stream)
            chunksRef.current = []
            cancelledRef.current = false
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
            rec.onstop = () => {
                stream.getTracks().forEach((t) => t.stop())
                if (!cancelledRef.current && chunksRef.current.length) {
                    setAudioBlob(new Blob(chunksRef.current, { type: "audio/webm" }))
                }
            }
            rec.start()
            mediaRef.current = rec
            setRecording(true)
            setRecordSeconds(0)
            const startedAt = Date.now()
            timerRef.current = setInterval(() => setRecordSeconds((Date.now() - startedAt) / 1000), 100)
        } catch (err) {
            console.error("[mobile note] microphone unavailable:", err)
        }
    }
    function stopRecording(cancel) {
        cancelledRef.current = !!cancel
        if (cancel) setAudioBlob(null)
        clearInterval(timerRef.current)
        setRecording(false)
        mediaRef.current?.state === "recording" && mediaRef.current.stop()
    }

    async function send() {
        setSending(true)
        try {
            const res = await sendDeskNote({
                route, kind,
                textContent: kind === "text" ? text : "",
                referenceKind: selectedRef?.kind, referenceId: selectedRef?.id, referenceLabel: selectedRef?.label,
                audioBlob: kind === "voice" ? audioBlob : null,
                audioSeconds: recordSeconds,
                createdBy: "operator",
            })
            setOutbox((prev) => [{ id: res.id, route, kind, text_content: text, reference_label: selectedRef?.label, status: res.status, created_at: res.created_at, recipients_notified: res.recipients_notified }, ...prev])
            setText(""); setAudioBlob(null); setSelectedRef(null); setRecordSeconds(0)
        } catch (err) {
            console.error("[mobile note] send failed:", err)
        } finally {
            setSending(false)
        }
    }

    const canSend = !sending && ((kind === "text" && text.trim()) || (kind === "voice" && audioBlob))

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ padding: "10px 16px 6px", font: "700 20px var(--font)" }}>Note</div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 16px 24px" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    <button className="chip m-tap" aria-pressed={kind === "voice"} onClick={() => setKind("voice")} style={{ flex: 1, justifyContent: "center" }}>Voice</button>
                    <button className="chip m-tap" aria-pressed={kind === "text"} onClick={() => setKind("text")} style={{ flex: 1, justifyContent: "center" }}>Text</button>
                </div>

                {kind === "voice" ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "20px 0" }}>
                        <button
                            className="m-tap"
                            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startRecording() }}
                            onPointerUp={() => stopRecording(false)}
                            onPointerLeave={() => { if (recording) stopRecording(true) }}
                            onPointerCancel={() => stopRecording(true)}
                            style={{
                                width: 84, height: 84, borderRadius: "50%", border: "none",
                                background: recording ? "var(--sev-critical)" : "var(--acc)", color: "#fff",
                                font: "700 13px var(--font)", display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                        >{recording ? recordSeconds.toFixed(1) + "s" : "Hold"}</button>
                        <div style={{ fontSize: 13, color: "var(--txt-3)" }}>
                            {recording ? "Recording — slide off to cancel" : audioBlob ? `Recorded ${recordSeconds.toFixed(1)}s — ready to send` : "Press and hold to record"}
                        </div>
                    </div>
                ) : (
                    <textarea
                        value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…"
                        style={{ width: "100%", minHeight: 90, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--txt)", font: "400 15px var(--font)", padding: 10, resize: "vertical" }}
                    />
                )}

                <div style={{ font: "600 12px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 8px" }}>Route</div>
                <div className="m-chiprow" style={{ padding: "0 0 4px" }}>
                    {ROUTES.map((r) => <button key={r.id} className="chip" aria-pressed={route === r.id} onClick={() => setRoute(r.id)}>{r.label}</button>)}
                </div>

                <div style={{ font: "600 12px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 8px" }}>Reference (optional)</div>
                <div className="m-chiprow" style={{ padding: "0 0 4px" }}>
                    <button className="chip" aria-pressed={!selectedRef} onClick={() => setSelectedRef(null)}>None</button>
                    {pickerOptions.map((r) => (
                        <button key={`${r.kind}-${r.id}`} className="chip" aria-pressed={selectedRef?.kind === r.kind && selectedRef?.id === r.id} onClick={() => setSelectedRef(r)}>
                            {r.label.length > 22 ? r.label.slice(0, 22) + "…" : r.label}
                        </button>
                    ))}
                </div>

                <button className="btn primary m-tap" disabled={!canSend} onClick={send} style={{ width: "100%", marginTop: 18, justifyContent: "center" }}>
                    {sending ? "Sending…" : "Send"}
                </button>

                <div style={{ font: "600 12px var(--font)", color: "var(--txt-3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "22px 0 8px" }}>Outbox</div>
                {outbox.length === 0 ? (
                    <div style={{ color: "var(--txt-4)", fontSize: 13 }}>No notes sent yet.</div>
                ) : outbox.map((n) => (
                    <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 13.5 }}>
                        <div style={{ color: "var(--txt-2)" }}>{n.kind === "voice" ? "Voice note" : (n.text_content || "").slice(0, 60)}{n.reference_label ? ` — re: ${n.reference_label}` : ""}</div>
                        <div style={{ color: "var(--txt-4)", fontSize: 11.5, marginTop: 2 }}>
                            {ROUTES.find((r) => r.id === n.route)?.label || n.route} · {n.status}{n.status === "sent" ? ` (${n.recipients_notified} notified)` : ""}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
