/**
 * runVoiceActions.js — a parsed command becomes something that happened.
 *
 * Each action maps onto a function this app already has. Where it does
 * not, the handler says so out loud instead of pretending: a voice command
 * that silently does nothing is worse than one that refuses.
 *
 * WHAT IS REAL AND WHAT IS A STUB, measured against the codebase:
 *   add_to_basket   → addToBriefing / removeFromBriefing          REAL
 *   add_note        → saveForBriefing({kind:"note"}) / removeSaved REAL
 *   tag             → collabApi.createAssignment                   REAL
 *   filter          → the map's own layer toggles, by event        REAL
 *   generate_briefing → opens Reports · Generate                   REAL (click to run)
 *   dismiss         → session-local, dispatched to the Inbox       PARTIAL
 *   create_signal   → TODO: no endpoint accepts a user-made signal
 *   send            → TODO: no mail integration exists at all
 *
 * The two TODOs are genuinely missing backend, not shortcuts taken here —
 * Generate.jsx's own distribute button is disabled with the same reason.
 */
import { addToBriefing, removeFromBriefing } from "../state/briefingBasket.js"
import { removeSaved } from "../state/savedForBriefing.js"
import { fileSignal, createFolder, fileIntoFolder } from "../state/filing.js"
import { createAssignment } from "../lib/collabApi.js"
import { toast } from "../ui/toast.js"
import { findPlace, riskFor } from "./gazetteer.js"

/** A description of what happened, and how to take it back. */
function undoable(label, undo) { return { label, undo } }

/**
 * @param result  parseCommand() output
 * @param ctx     buildVoiceContext() output
 * @returns {Promise<{ ran: boolean, label: string, undo?: Function, problem?: string }>}
 */
/**
 * Where a spoken message goes.
 *
 * A group is already a conversation; a person may not be yet, so the
 * direct chat is created on the spot. Both come back as something with an
 * `id`, so nothing downstream has to care which it was.
 */
async function destinationFor(a) {
    if (a.conversationId) return { id: a.conversationId }
    const { startConversation } = await import("../lib/chatApi.js")
    return startConversation({ kind: "direct", user_ids: [a.userId] })
}

export async function runVoiceActions(result, ctx) {
    const sel = ctx._selection || null
    const done = []
    let label = ""

    for (const a of result.actions) {
        switch (a.type) {
            case "add_to_basket": {
                const title = sel?.title || sel?.label || a.itemId
                addToBriefing(a.itemId, title)
                // One path: the local cache AND the theater's case.
                const filed = await fileSignal({
                    id: a.itemId, kind: "signal", headline: title,
                    region: sel?.place || sel?.region || null,
                    source: sel?.source || null,
                    severity: sel?.severity || sel?.sev || null,
                    lat: sel?.lat ?? null, lon: sel?.lon ?? null,
                })
                label = filed.path
                    ? `Filed “${title}” to ${filed.path.join(" / ")}`
                    : `Added “${title}” to the briefing`
                done.push(undoable(label, () => { removeFromBriefing(a.itemId); removeSaved(a.itemId) }))
                break
            }
            case "add_note": {
                const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
                await fileSignal({
                    id, kind: "note", label: a.text, headline: a.text,
                    region: sel?.place || null,
                    lat: sel?.lat ?? null, lon: sel?.lon ?? null,
                    when: new Date().toISOString(),
                })
                label = `Saved as note: “${a.text.slice(0, 60)}”`
                done.push(undoable(label, () => removeSaved(id)))
                break
            }
            case "tag": {
                const ref = sel?.recordRef || `sig:${a.itemId}`
                try {
                    const res = await createAssignment(ref, a.userId)
                    const who = (ctx.users.find((u) => u.id === a.userId) || {}).name || "them"
                    label = `Assigned to ${who}`
                    // markAssignmentDone is the nearest inverse this API has;
                    // there is no delete-assignment route.
                    done.push(undoable(label, async () => {
                        const { markAssignmentDone } = await import("../lib/collabApi.js")
                        if (res?.id) await markAssignmentDone(res.id).catch(() => {})
                    }))
                } catch (e) {
                    return { ran: false, label: "", problem: `Could not assign it — ${e.message || e}` }
                }
                break
            }
            case "filter": {
                // Situation owns the toggles; it listens for this.
                window.dispatchEvent(new CustomEvent("akili:voice-filter", {
                    detail: { typeIds: a.typeIds, sinceHours: a.sinceHours },
                }))
                const parts = []
                if (a.typeIds?.length) parts.push(a.typeIds.join(", "))
                if (a.sinceHours) parts.push(`last ${a.sinceHours}h`)
                label = `Showing ${parts.join(" · ")}`
                done.push(undoable(label, () => window.dispatchEvent(new CustomEvent("akili:voice-filter-restore"))))
                break
            }
            case "dismiss": {
                window.dispatchEvent(new CustomEvent("akili:voice-dismiss", {
                    detail: { id: a.itemId, reason: a.reason || null },
                }))
                label = a.reason ? `Dismissed — ${a.reason}` : "Dismissed"
                done.push(undoable(label, () => window.dispatchEvent(new CustomEvent("akili:voice-dismiss-undo",
                    { detail: { id: a.itemId } }))))
                break
            }
            case "generate_briefing": {
                // The existing flow, unchanged: this opens it, the analyst
                // presses generate. No new call to the model from here.
                window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "briefings" } }))
                label = "Opened Reports · Generate"
                break
            }
            case "create_signal": {
                // TODO: no endpoint accepts an analyst-authored signal. Kept
                // as a located note so the observation is not lost.
                const id = `obs-${Date.now()}`
                await fileSignal({
                    id, kind: "note", label: a.text, headline: a.text,
                    lat: a.at?.lat ?? null, lon: a.at?.lng ?? null,
                    when: new Date().toISOString(),
                })
                label = `No signal endpoint yet — kept as a located note: “${a.text.slice(0, 48)}”`
                done.push(undoable(label, () => removeSaved(id)))
                break
            }
            case "create_folder": {
                const out = await createFolder(a.name)
                if (!out.ok) return { ran: false, label: "", problem: out.why }
                label = out.created
                    ? `Created the folder \u201c${a.name}\u201d`
                    : `\u201c${a.name}\u201d already exists`
                if (out.created) {
                    done.push(undoable(label, async () => {
                        const { deleteNode } = await import("../lib/casesApi.js")
                        await deleteNode(out.caseId, out.node.id).catch(() => {})
                    }))
                }
                break
            }
            case "file_to": {
                if (!sel) return { ran: false, label: "", problem: "Nothing selected to file." }
                const out = await fileIntoFolder({
                    id: a.itemId,
                    kind: "signal",
                    headline: sel?.title || sel?.label || a.itemId,
                    severity: sel?.severity || sel?.sev || null,
                    source: sel?.source || null,
                    lat: sel?.lat ?? null, lon: sel?.lon ?? null,
                }, a.folder)
                if (!out.ok) {
                    // A folder that does not exist is worth saying rather
                    // than silently creating — "file this under vessels"
                    // when you meant "Vessels" should not quietly make a
                    // second one.
                    return { ran: false, label: "", problem: out.why }
                }
                label = `Filed into ${out.folder}`
                break
            }
            case "navigate": {
                const place = await findPlace(a.place)
                if (!place) {
                    return { ran: false, label: "", problem: `I don't know where “${a.place}” is.` }
                }
                window.dispatchEvent(new CustomEvent("akili:open-map"))
                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                    detail: { lat: place.lat, lon: place.lon, altitude: place.altitude },
                }))
                label = `Flying to ${place.name}`
                // No undo: moving a camera is not a change to anything.
                break
            }
            /* ── SAID FREELY, READ BY THE MODEL ──────────────────────
               Search, pages, layers and zoom: what the console's own
               controls do, reached by events the controls listen for. */
            case "search": {
                window.dispatchEvent(new CustomEvent("akili:search", { detail: { query: a.query, go: true } }))
                label = `Searching “${a.query}”`
                break
            }
            case "open_page": {
                window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: a.page } }))
                label = `Opened ${a.page === "situation" ? "the map" : a.page}`
                break
            }
            case "layer": {
                window.dispatchEvent(new CustomEvent("akili:open-map"))
                let shown = a.on
                window.dispatchEvent(new CustomEvent("akili:voice-layer", {
                    detail: { layer: a.layer, on: a.on, report: (v) => { shown = v } },
                }))
                label = `${shown === false ? "Hid" : "Showing"} ${String(a.layer).replace(/_/g, " ")}`
                done.push(undoable(label, () => window.dispatchEvent(new CustomEvent("akili:voice-layer-undo", { detail: { layer: a.layer } }))))
                break
            }
            case "zoom": {
                window.dispatchEvent(new CustomEvent("akili:open-map"))
                window.dispatchEvent(new CustomEvent("akili:voice-zoom", { detail: { direction: a.direction } }))
                label = `Zoomed ${a.direction}`
                break
            }
            case "risk": {
                const place = await findPlace(a.place)
                if (!place) {
                    return { ran: false, label: "", problem: `I don't know where “${a.place}” is.` }
                }
                const risk = await riskFor(place)
                if (!risk.ok) return { ran: false, label: "", problem: risk.why }
                // Go there as well — a number about a place is easier to read
                // standing over it.
                window.dispatchEvent(new CustomEvent("akili:open-map"))
                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                    detail: { lat: place.lat, lon: place.lon, altitude: place.altitude },
                }))
                // Which components actually have data, so the number is not
                // read as more complete than it is.
                const comps = Object.entries(risk.components || {})
                const thin = comps.filter(([, v]) => v?.status && v.status !== "ok").map(([k]) => k)
                label = `${place.name} risk ${Math.round(risk.score)} of 100 · band ${risk.band}`
                    + (thin.length ? ` · ${thin.join(" and ")} not yet measurable` : "")
                break
            }
            /* ── SAYING IT TO SOMEBODY ───────────────────────────────
               Both of these used to refuse: there was no mail integration,
               and refusing was the honest answer. There is a chat now, so
               the honest answer is to post it — into the direct
               conversation with that person, created on the spot if it is
               the first thing you have ever said to them.

               The chat never opens. Saying "tell Hannes the tanker went
               dark" and then having to find the window is the work the
               sentence was meant to replace. */
            case "message": {
                const { sendMessage, deleteMessage } = await import("../lib/chatApi.js")
                try {
                    const c = await destinationFor(a)
                    const m = await sendMessage(c.id, { body: a.text })
                    label = `Sent to ${a.name || "them"}`
                    // UNDO IS REAL, and it is what pays for there being no
                    // confirmation step. It deletes the message the same way
                    // the chat's own delete does — the other person sees
                    // "this message was deleted", because pretending it was
                    // never sent would be a lie about what they already read.
                    done.push({ undo: () => deleteMessage(c.id, m.id).catch(() => {}) })
                } catch (e) {
                    return { ran: false, label: "", problem: e.message || "That did not send." }
                }
                break
            }
            /* "Explain the current situation in Mali." The answer is
               prose, so it is not a toast — it opens a panel with the
               explanation and the signals it was written from, which is
               the only form in which an explanation is checkable. */
            case "explain": {
                const API_BASE = (await import("../apiBase.js")).default
                try {
                    const r = await fetch(`${API_BASE}/api/voice/explain`, {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ place: a.place }),
                    })
                    const d = await r.json()
                    if (!r.ok || d.ok === false) {
                        return { ran: false, label: "", problem: d?.why || d?.detail || "That did not work." }
                    }
                    window.dispatchEvent(new CustomEvent("akili:explanation", { detail: d }))
                    label = d.count
                        ? `Explained ${a.place} from ${d.count} signal${d.count === 1 ? "" : "s"}`
                        : `Nothing held on ${a.place}`
                    done.push({ undo: async () => {} })
                } catch (e) {
                    return { ran: false, label: "", problem: e.message || "That did not work." }
                }
                break
            }
            /* "Send the current situation in Niger to Hannes." The
               gathering happens on the server, where the surface pool
               lives — sending it from here would mean shipping fifty
               items to the browser to summarise them and ship a summary
               back. */
            case "send_situation": {
                const API_BASE = (await import("../apiBase.js")).default
                try {
                    const r = await fetch(`${API_BASE}/api/voice/send-situation`, {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            place: a.place, user_id: a.userId,
                            conversation_id: a.conversationId, as_file: true,
                        }),
                    })
                    const d = await r.json()
                    if (!r.ok || !d.ok) {
                        return { ran: false, label: "", problem: d?.detail || "That did not send." }
                    }
                    label = d.count
                        ? `Sent ${d.count} item${d.count === 1 ? "" : "s"} on ${a.place} to ${a.name || "them"}`
                        : `Sent ${a.name || "them"} the ${a.place} picture — nothing is currently held`
                    const { deleteMessage } = await import("../lib/chatApi.js")
                    done.push({ undo: () => deleteMessage(d.conversation_id, d.message.id).catch(() => {}) })
                } catch (e) {
                    return { ran: false, label: "", problem: e.message || "That did not send." }
                }
                break
            }
            case "send": {
                const { sendMessage, attachCaseNode, deleteMessage } = await import("../lib/chatApi.js")
                try {
                    const c = await destinationFor(a)
                    // A briefing or a case file goes as the file itself; a
                    // selected signal goes as the line that names it,
                    // because a map selection is not a file.
                    const m = (a.what === "briefing" && a.caseId && a.nodeId)
                        ? await attachCaseNode(c.id, { case_id: a.caseId, node_id: a.nodeId, body: a.message })
                        : await sendMessage(c.id, {
                            body: [a.message, `(${a.what === "item" ? "signal" : a.what} ${a.id})`]
                                .filter(Boolean).join(" "),
                        })
                    label = `Sent to ${a.name || "them"}`
                    done.push({ undo: () => deleteMessage(c.id, m.id).catch(() => {}) })
                } catch (e) {
                    return { ran: false, label: "", problem: e.message || "That did not send." }
                }
                break
            }
            default:
                break
        }
    }

    if (result.actions.length > 1 && result.label) label = result.label
    if (!done.length && !label) return { ran: false, label: "", problem: "Nothing to do." }
    if (label) toast(label)
    return {
        ran: true,
        label,
        undo: done.length ? async () => { for (const d of [...done].reverse()) await d.undo() } : undefined,
    }
}

/**
 * The hook a cheap LLM fallback would hang off later, behind a flag.
 * It does nothing today beyond what the note fallback already does.
 */
export function onUnrecognised(/* raw, ctx */) { /* intentionally empty */ }
