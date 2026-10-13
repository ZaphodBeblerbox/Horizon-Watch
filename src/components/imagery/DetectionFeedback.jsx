/**
 * DetectionFeedback.jsx — one imagery detection, read and corrected.
 *
 * Owner, 2026-10-13: the Sentinel-2 detector called dark fields and runways
 * smoke plumes. Each detection now has a class, a class confidence and the
 * reasons the classifier gave; this shows them, and lets an analyst say
 * "Correct" or "Not this — it's: Runway", which the backend stores
 * (POST /api/imagery/detections/{id}/feedback) to calibrate the classifier.
 * The stored answer is read back on open and shown, and can be changed.
 */
import { useEffect, useState } from "react"
import { apiFetch } from "../../auth.js"
import {
    classColor, classDetail, classLabel, FEEDBACK_CLASSES, feedbackLabel,
} from "../../destinations/imageryModel.js"

const BTN = {
    height: 24, padding: "0 9px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt2)", font: "inherit", fontSize: 11.5, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const SIGN_C = { "+": "var(--green)", "-": "var(--amber)" }
const KIND_WORD = { spectral: "colour", temporal: "over time", shape: "shape", context: "place", fire: "fire data" }

/** The id the feedback endpoint takes: a "gone" outline is its reference detection. */
export const feedbackId = (det) => String(det?.detection_id || det?.id || "").replace(/^removed-/, "")

async function readError(r) {
    const d = await r.json().catch(() => null)
    return typeof d?.detail === "string" ? d.detail : `the server answered ${r.status}`
}

const latest = (items) => [...(items || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null

export default function DetectionFeedback({ det, onClose, canFeedback = true }) {
    const id = feedbackId(det)
    const type = det?.object_type || det?.label
    const info = classDetail(det)
    const [stored, setStored] = useState(null)       // the latest feedback row
    const [loadErr, setLoadErr] = useState(null)
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(null)     // the choice being sent
    const [sendErr, setSendErr] = useState(null)
    const [editing, setEditing] = useState(false)
    const [note, setNote] = useState("")
    const [loadTry, setLoadTry] = useState(0)

    useEffect(() => {
        if (!id || !canFeedback) { setLoading(false); return undefined }
        let live = true
        setLoading(true); setLoadErr(null); setStored(null); setEditing(false); setSendErr(null); setNote("")
        apiFetch(`/api/imagery/detections/${encodeURIComponent(id)}/feedback`, { credentials: "include" })
            .then(async (r) => {
                if (!r.ok) throw new Error(await readError(r))
                return r.json()
            })
            .then((d) => { if (live) setStored(latest(d?.items)) })
            .catch((e) => { if (live) setLoadErr(e instanceof TypeError ? "the server did not answer" : e.message) })
            .finally(() => { if (live) setLoading(false) })
        return () => { live = false }
    }, [id, loadTry, canFeedback])

    const send = async (verdict, actual = null) => {
        setSending(actual || verdict); setSendErr(null)
        try {
            const r = await apiFetch(`/api/imagery/detections/${encodeURIComponent(id)}/feedback`, {
                method: "POST", credentials: "include",
                body: JSON.stringify({ verdict, actual_class: actual, note: note.trim() || null }),
            })
            if (!r.ok) throw new Error(await readError(r))
            const d = await r.json()
            setStored(d?.feedback || { verdict, actual_class: actual })
            setEditing(false)
        } catch (e) {
            setSendErr(e instanceof TypeError ? "the server did not answer" : e.message)
        } finally {
            setSending(null)
        }
    }

    const showChoices = !loading && (!stored || editing)
    const pct = (v) => `${Math.round(v * 100)}%`

    return (
        <div data-detection-detail={id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 12, height: 12, flex: "none", background: classColor(type), boxShadow: "0 0 0 2px rgba(0,0,0,.6)" }} />
                <span data-detection-class={type} style={{ fontWeight: 600, fontSize: 13.5 }}>{classLabel(type)}</span>
                {info.classConfidence !== null && (
                    <span title="How sure the classifier is of the class" style={{ fontSize: 12, color: "var(--txt2)" }}>{pct(info.classConfidence)} sure</span>
                )}
                {onClose && <button onClick={onClose} title="Close" style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--txt3)", cursor: "pointer", font: "inherit" }}>✕</button>}
            </div>
            <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
                {[det?.conf != null && `detector ${pct(det.conf)}`, info.classifier && `class by ${info.classifier}`,
                  (info.tier || det?.tier) && ((info.tier || det?.tier) === "confirmed" ? "both models" : "one model only")].filter(Boolean).join(" · ")}
            </span>
            {info.description && <span style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.45, textWrap: "pretty" }}>{info.description}</span>}
            {info.reasons.length > 0 ? (
                <ul data-class-reasons style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                    {info.reasons.map((r, i) => (
                        <li key={i} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr)", gap: 6, fontSize: 12, lineHeight: 1.4 }}>
                            <b style={{ color: SIGN_C[r.sign] || "var(--txt3)", fontWeight: 700 }} title={r.sign === "-" ? "against this class" : "for this class"}>{r.sign === "-" ? "−" : "+"}</b>
                            <span style={{ color: "var(--txt2)" }}>
                                {r.text}{r.kind && <span style={{ color: "var(--txt4)" }}> · {KIND_WORD[r.kind] || r.kind}</span>}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : <span style={{ fontSize: 11.5, color: "var(--txt4)" }}>The classifier gave no reasons for this one.</span>}

            {canFeedback && <div style={{ borderTop: "1px solid var(--gline)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {loading && <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>Reading your earlier answer…</span>}
                {loadErr && (
                    <span role="alert" style={{ fontSize: 12, color: "var(--amber)" }}>
                        Could not read earlier feedback — {loadErr} <button onClick={() => setLoadTry((n) => n + 1)} style={{ ...BTN, height: 22, fontSize: 11 }}>Try again</button>
                    </span>
                )}
                {stored && !editing && (
                    <div data-feedback-state={stored.verdict} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600, color: stored.verdict === "correct" ? "var(--green)" : "var(--txt)" }}>
                            {stored.verdict === "correct" ? "Marked correct" : `Marked as: ${feedbackLabel(stored.actual_class) || "not this"}`}
                        </span>
                        {stored.user && <span style={{ fontSize: 11, color: "var(--txt4)" }}>by {stored.user}</span>}
                        <button onClick={() => setEditing(true)} style={{ ...BTN, marginLeft: "auto", height: 22, fontSize: 11 }}>Change</button>
                    </div>
                )}
                {showChoices && (
                    <>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <button data-feedback="correct" disabled={!!sending} onClick={() => send("correct")}
                                style={{ ...BTN, borderColor: "var(--green)", color: "var(--txt)", fontWeight: 600 }}>
                                {sending === "correct" ? "Sending…" : "Correct"}
                            </button>
                            <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>Not this — it's:</span>
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {FEEDBACK_CLASSES.filter((c) => c.key !== type).map((c) => (
                                <button key={c.key} data-feedback-class={c.key} disabled={!!sending} onClick={() => send("incorrect", c.key)}
                                    style={{ ...BTN, height: 22, fontSize: 11, padding: "0 8px", borderRadius: 11 }}>
                                    {sending === c.key ? "Sending…" : c.label}
                                </button>
                            ))}
                        </div>
                        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note with your answer"
                            style={{ height: 24, padding: "0 8px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 11.5 }} />
                        {editing && <button onClick={() => setEditing(false)} style={{ ...BTN, alignSelf: "flex-start", height: 22, fontSize: 11 }}>Keep my earlier answer</button>}
                    </>
                )}
                {sendErr && <span role="alert" data-feedback-error style={{ fontSize: 12, color: "var(--red, #FF3B30)" }}>Not saved — {sendErr}</span>}
            </div>}
        </div>
    )
}
