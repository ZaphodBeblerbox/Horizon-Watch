/**
 * voiceFallback.js — the sentence the rules could not place.
 *
 * ONLY WHEN THE RULES GIVE UP. voiceCommands.js resolves the ordinary
 * phrasings for nothing, and that is most of what anybody says. This asks
 * a cheap model, and it is reached only when the parser is not confident —
 * which is what keeps the bill at pennies rather than at a subscription.
 *
 * The model returns an INTENT, never an action. The server checks it
 * against an allowlist and resolves the recipient against names the caller
 * already supplied (backend/routers/voice_ai.py), and this turns the
 * result into the same action shapes the rule parser emits. So a sentence
 * the model misreads can only ever produce something the console could
 * already do, addressed to somebody who already exists.
 *
 * Destructive intents are deliberately not on the list. A guessed "fly to
 * Yemen" costs a camera move; a guessed "delete" costs the thing.
 */
import API_BASE from "../apiBase.js"

/**
 * @param text  what was said
 * @param ctx   the voice context (users, groups, selection)
 * @returns {Promise<{actions, label}|null>} null when nothing came back
 */
export async function interpretWithModel(text, ctx) {
    const people = [
        ...(ctx?.users || []).map((u) => ({ id: u.id, name: u.name, kind: "user" })),
        ...(ctx?.groups || []).map((g) => ({ id: g.id, name: g.name, kind: "group" })),
    ]
    let d
    try {
        const r = await fetch(`${API_BASE}/api/voice/interpret`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ text, people, selected: !!ctx?.selectedId }),
        })
        d = await r.json()
    } catch {
        return null
    }
    if (!d?.ok || !d.intent) return null

    const s = d.slots || {}
    switch (d.intent) {
        case "navigate":
            return { actions: [{ type: "navigate", place: s.place }], label: `Flying to ${s.place}` }
        case "risk":
            return { actions: [{ type: "risk", place: s.place }], label: `Risk for ${s.place}` }
        case "send_situation":
            return {
                actions: [{
                    type: "send_situation", place: s.place, name: s.name,
                    ...(s.kind === "group" ? { conversationId: s.id } : { userId: s.id }),
                }],
                label: `Sent the ${s.place} picture to ${s.name}`,
            }
        case "explain":
            return { actions: [{ type: "explain", place: s.place }], label: `Explaining ${s.place}` }
        case "message":
            return {
                actions: [{
                    type: "message", name: s.name, text: s.text,
                    ...(s.kind === "group" ? { conversationId: s.id } : { userId: s.id }),
                }],
                label: `Sent to ${s.name}`,
            }
        case "note":
            return { actions: [{ type: "note", text: s.text }], label: "Noted" }
        case "filter":
            return { actions: [{ type: "filter", text: s.text }], label: "Filtered" }
        case "create_folder":
            return { actions: [{ type: "create_folder", name: s.name }], label: `Folder “${s.name}”` }
        case "file_to":
            if (!ctx?.selectedId) return null
            return {
                actions: [{ type: "file_to", itemId: ctx.selectedId, folder: s.folder }],
                label: `Filed under ${s.folder}`,
            }
        case "add_to_basket":
            if (!ctx?.selectedId) return null
            return { actions: [{ type: "add_to_basket", itemId: ctx.selectedId }], label: "Added" }
        case "generate_briefing":
            return {
                actions: [{ type: "generate_briefing", basketId: ctx?.activeBasketId }],
                label: "Generating",
            }
        default:
            return null
    }
}

/** Whether the fallback is available, and what is left of the month. */
export async function fallbackStatus() {
    try {
        const r = await fetch(`${API_BASE}/api/voice/ai-status`, { credentials: "include" })
        return r.ok ? await r.json() : null
    } catch { return null }
}
