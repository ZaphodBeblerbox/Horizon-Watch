/**
 * shareToDesk.js — "Share to the desk" from anywhere: open the desk with
 * the thing already in the composer. The shapes are deskAttachments.jsx's.
 */
export function shareToDesk(attachment, body = "") {
    window.__plxDeskShare = { attachment, body }
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "desk" } }))
    window.dispatchEvent(new CustomEvent("akili:share-to-desk", { detail: { attachment, body } }))
}
