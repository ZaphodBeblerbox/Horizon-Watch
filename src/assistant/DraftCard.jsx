/**
 * DraftCard.jsx — a post written from a signal, in the chat: the item's
 * picture or video, the text (editable; a longer version on request), and
 * Post to Desk (after a confirm, like the Confirm cards), Copy text and
 * Download media. Nothing reaches the Desk before the confirm.
 */
import { useState } from "react"
import { editDraft, postDraftToDesk } from "./assistantStore.js"
import { downloadMedia } from "./postDraft.js"

export default function DraftCard({ m, platform = "desktop" }) {
    const d = m.draft || {}
    const [which, setWhich] = useState("short")
    const [sure, setSure] = useState(false)          // the confirm step before Post to Desk
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState(null)
    const text = which === "long" ? d.long : d.short
    const posted = d.state === "posted"
    const copy = async () => {
        try { await navigator.clipboard.writeText(text || ""); setNote("Copied") } catch { setNote("Copy is not available here") }
        setTimeout(() => setNote(null), 1500)
    }
    const save = async () => {
        setBusy(true)
        const r = await downloadMedia(d.media, { title: d.item?.title, phone: platform === "phone" })
        setBusy(false)
        setNote(r === "failed" ? "The file could not be fetched" : r === "shared" ? "Shared" : "Saved")
        setTimeout(() => setNote(null), 1800)
    }
    const post = async () => {
        setBusy(true)
        await postDraftToDesk(m, which)
        setBusy(false)
        setSure(false)
    }
    return (
        <div className="plx-as-card plx-as-draft" data-testid="assistant-draft" data-state={d.state || "draft"}>
            {d.media && (
                <div className="plx-as-draft-media">
                    {d.media.type === "video" && d.media.video
                        ? <video src={d.media.video} poster={d.media.thumb || undefined} controls preload="none" playsInline />
                        : d.media.thumb ? <img src={d.media.thumb} alt="" loading="lazy" /> : null}
                </div>
            )}
            <div className="plx-as-draft-tabs" role="tablist">
                <button role="tab" aria-selected={which === "short"} onClick={() => setWhich("short")}>Post</button>
                {d.long && d.long !== d.short && <button role="tab" aria-selected={which === "long"} onClick={() => setWhich("long")}>Longer</button>}
                <span>{(text || "").length} characters</span>
            </div>
            <textarea className="plx-as-draft-text" aria-label="Post text" data-testid="assistant-draft-text" value={text || ""}
                      readOnly={posted} rows={which === "long" ? 7 : 4} maxLength={4000}
                      onChange={(e) => editDraft(m, which === "long" ? { long: e.target.value } : { short: e.target.value })} />
            {posted ? (
                <div className="plx-as-card-state" data-testid="assistant-draft-posted">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
                    Posted to the Desk.
                </div>
            ) : sure ? (
                <div className="plx-as-card-actions" data-testid="assistant-draft-confirm">
                    <button data-primary="true" disabled={busy || !(text || "").trim()} onClick={post} data-testid="assistant-draft-confirm-post">
                        {busy ? "Posting…" : "Confirm: post to the Desk"}</button>
                    <button onClick={() => setSure(false)}>Cancel</button>
                </div>
            ) : (
                <div className="plx-as-card-actions">
                    <button data-primary="true" disabled={!(text || "").trim()} onClick={() => setSure(true)} data-testid="assistant-draft-post">Post to Desk</button>
                    <button onClick={copy} data-testid="assistant-draft-copy">Copy text</button>
                    {d.media && <button onClick={save} disabled={busy} data-testid="assistant-draft-download">Download media</button>}
                </div>
            )}
            {(note || d.state === "failed") && (
                <div className="plx-as-card-state" role="status">{note || m.draftWhy || "Not posted. Try again."}</div>
            )}
        </div>
    )
}
