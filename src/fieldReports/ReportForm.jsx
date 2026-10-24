/**
 * ReportForm.jsx — "Report" (owner, 2026-10-24), phone and desktop alike: pick what you saw from its icon, the
 * place (the host map's pin: dragged on the phone, a click on the globe), how long it holds (1 h / 2 h / 6 h /
 * 12 h / 24 h / custom; the kind's default until you choose), an optional note and photo, who sees it, Send.
 * The host (mobile/FieldReportComposer.jsx, globe/GlobeFieldReportsLayer.jsx) owns the pin and passes `at`.
 */
import { useState } from "react"
import { KIND_LIST, EXPIRY_CHIPS, MAX_EXPIRY_H, reportIcon, defaultExpiryH, cleanHours, buildReportBody, createReport, uploadReportPhoto, mediaUrl } from "../lib/fieldReports.js"
import { getCurrentUser } from "../state/authStore.js"
import "./fieldReports.css"

export default function ReportForm({ kind, onKind, at, place = "", onPlace, onUseMyLocation = null, moveHint = "", onClose, onSent, variant = "desktop" }) {
    const [hours, setHours] = useState(null)              // null: the kind's default
    const [custom, setCustom] = useState("")
    const [note, setNote] = useState("")
    const [media, setMedia] = useState([])
    const [uploading, setUploading] = useState(false)
    const [sending, setSending] = useState(false)
    const [err, setErr] = useState("")
    const hasCompany = !!String(getCurrentUser()?.company || "").trim()
    const [audience, setAudience] = useState(hasCompany ? "company" : "everyone")
    const effHours = hours === "custom" ? cleanHours(custom) : (hours ?? (kind ? defaultExpiryH(kind) : null))

    const addPhoto = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!f) return
        setUploading(true); setErr("")
        try { const m = await uploadReportPhoto(f); setMedia((x) => [...x, m].slice(0, 4)) } catch (ex) { setErr(`The photo did not upload: ${ex.message}`) }
        setUploading(false)
    }
    const send = async () => {
        setErr("")
        let body
        try {
            body = buildReportBody({ kind, lat: at?.lat, lon: at?.lon, place, expiresInH: hours === "custom" ? custom : (hours ?? null), note, audience, media })
        } catch (ex) { setErr(ex.message); return }
        setSending(true)
        try { const r = await createReport(body); onSent?.(r) } catch (ex) { setErr(ex.message || "Could not send it") }
        setSending(false)
    }

    return (
        <div className={`fr-form ${variant}`} data-testid="fr-form">
            <div className="fr-row" style={{ justifyContent: "space-between" }}>
                <h3>Report what you see</h3>
                <button className="fr-btn ghost" style={{ height: 28, padding: "0 10px" }} onClick={onClose} aria-label="Cancel the report">Cancel</button>
            </div>
            <div className="fr-kinds" role="group" aria-label="What you saw">
                {KIND_LIST.map((k) => (
                    <button key={k.kind} className="fr-kind" aria-pressed={kind === k.kind} data-testid={`fr-kind-${k.kind}`}
                            onClick={() => { onKind?.(k.kind); setHours((h) => (h === "custom" ? h : null)) }}>
                        <img src={reportIcon(k.kind)} alt="" />{k.label}
                    </button>
                ))}
            </div>
            {kind && (<>
                <div>
                    <div className="fr-label">Where</div>
                    <div className="fr-where" data-testid="fr-where">
                        {at ? `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}` : "Put the pin on the map"}{moveHint ? ` · ${moveHint}` : ""}
                    </div>
                    <div className="fr-row" style={{ marginTop: 6 }}>
                        <input className="fr-input" style={{ flex: 1, minWidth: 0 }} placeholder="Place name (optional), e.g. Place de la République, Paris"
                               value={place} maxLength={200} onChange={(e) => onPlace?.(e.target.value)} aria-label="Place name" />
                        {onUseMyLocation && <button className="fr-chip" onClick={onUseMyLocation}>My location</button>}
                    </div>
                </div>
                <div>
                    <div className="fr-label">Expires in</div>
                    <div className="fr-chips" role="group" aria-label="Expires in">
                        {EXPIRY_CHIPS.map((h) => (
                            <button key={h} className="fr-chip" data-testid={`fr-exp-${h}`} aria-pressed={hours === "custom" ? false : effHours === h}
                                    onClick={() => setHours(h)}>{h} h</button>
                        ))}
                        <button className="fr-chip" aria-pressed={hours === "custom"} onClick={() => setHours("custom")}>Custom</button>
                        {hours === "custom" && (
                            <span className="fr-row" style={{ gap: 4 }}>
                                <input className="fr-input small" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)}
                                       placeholder="h" aria-label={`Hours, up to ${MAX_EXPIRY_H}`} autoFocus />
                                <span className="fr-meta">h (max {MAX_EXPIRY_H})</span>
                            </span>
                        )}
                    </div>
                </div>
                <div>
                    <div className="fr-label">Note (optional)</div>
                    <textarea className="fr-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
                              placeholder="What you see: how many, which way they move" aria-label="Note" />
                </div>
                <div className="fr-row">
                    <label className="fr-chip" style={{ display: "inline-flex", alignItems: "center" }}>
                        {uploading ? "Uploading…" : "Add photo"}
                        <input type="file" accept="image/*,video/*" onChange={addPhoto} style={{ display: "none" }} disabled={uploading} />
                    </label>
                    <select className="fr-input" style={{ width: "auto", flex: 1, minWidth: 0 }} value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Who sees it">
                        {hasCompany && <option value="company">Your company</option>}
                        <option value="everyone">Everyone on Parallax</option>
                    </select>
                </div>
                {media.length > 0 && (
                    <div className="fr-thumbs">
                        {media.map((m, i) => m.type === "video" ? <span key={i} className="fr-meta">{m.name || "video"}</span>
                            : <span key={i} className="fr-meta">{m.name || "photo"} attached</span>)}
                    </div>
                )}
                {err && <div className="fr-err" role="alert">{err}</div>}
                <div className="fr-acts">
                    <span className="fr-meta" style={{ marginRight: "auto", alignSelf: "center" }}>Shown as unverified</span>
                    <button className="fr-btn" data-testid="fr-send" disabled={sending || uploading || !at || effHours == null} onClick={send}>
                        {sending ? "Sending…" : "Send"}
                    </button>
                </div>
            </>)}
        </div>
    )
}

/** The media of a report on its card. */
export function ReportMediaList({ media }) {
    if (!Array.isArray(media) || !media.length) return null
    return (
        <div className="fr-thumbs">
            {media.map((m, i) => {
                const u = mediaUrl(m)
                if (!u) return null
                return m.type === "video"
                    ? <video key={i} src={u} controls playsInline preload="metadata" />
                    : <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" /></a>
            })}
        </div>
    )
}
