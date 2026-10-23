/**
 * assistantStore.js — one conversation per app, kept outside the screens so
 * the phone can switch to the map (to show a fly) and come back to it.
 *
 * Every turn goes to POST /api/assistant/turn. The server decides: the rule
 * path (free: map commands, the set-up questions), the model (with tools and
 * citations), or the honest "model is off" answer with the forms.
 */
import { useSyncExternalStore } from "react"
import { askTurn, confirmProposal } from "./assistantApi.js"
import { runAssistantActions } from "./assistantActions.js"

const HISTORY = 8
const blank = () => ({ messages: [], mode: "chat", skipped: [], loading: false, onboarding: null, model: null })
let state = blank()
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()) }

export const getAssistant = () => state
export function subscribeAssistant(fn) { subs.add(fn); return () => subs.delete(fn) }
export function useAssistant() { return useSyncExternalStore(subscribeAssistant, getAssistant, getAssistant) }
export function resetAssistant() { state = blank(); subs.forEach((f) => f()) }

let platform = "desktop"
export function setAssistantPlatform(p) { platform = p }

/** The body the server reads: the last messages as plain text. */
export function turnBody(s, text) {
    const msgs = s.messages.filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }))
    if (text) msgs.push({ role: "user", content: text })
    return { messages: msgs.slice(-HISTORY), mode: s.mode, client: { platform }, onboarding: { skipped: s.skipped } }
}

async function turn(text, { silentUser = false } = {}) {
    const s = state
    const body = turnBody(s, text)
    const messages = text && !silentUser ? [...s.messages, { role: "user", content: text }] : s.messages
    set({ messages, loading: true })
    let d
    try {
        d = await askTurn(body)
    } catch (e) {
        set({ loading: false, messages: [...messages, { role: "assistant", content: e?.message || "The assistant did not answer.", error: true }] })
        return null
    }
    const labels = d.actions?.length ? await runAssistantActions(d.actions, platform) : []
    const msg = {
        role: "assistant", content: d.reply || "", citations: d.citations || [], proposals: (d.proposals || []).map((p) => ({ ...p, state: "pending" })),
        ask: d.ask || null, done: labels, forms: !!d.forms, refused: !!d.refused,
        step: d.onboarding?.step || null, chips: d.onboarding?.chips || null,
    }
    set({ loading: false, messages: [...state.messages, msg], onboarding: d.onboarding || null, model: d.model || null,
          skipped: d.skipped || state.skipped })
    return d
}

export const sendAssistant = (text) => {
    const t = String(text || "").trim().slice(0, 800)
    return t ? turn(t) : Promise.resolve(null)
}

/** Open in a mode: "chat", "onboarding" (first login, "set me up") or "theater" (New theater). */
export function startAssistant(mode = "chat") {
    if (mode === state.mode && state.messages.length) return Promise.resolve(null)
    set({ ...blank(), mode })
    return mode === "chat" ? Promise.resolve(null) : turn("")
}

function patchProposal(token, patch) {
    set({ messages: state.messages.map((m) => (m.proposals?.some((p) => p.token === token)
        ? { ...m, proposals: m.proposals.map((p) => (p.token === token ? { ...p, ...patch } : p)) } : m)) })
}

export async function confirmAssistantProposal(p) {
    patchProposal(p.token, { state: "saving" })
    try {
        await confirmProposal(p.token)
        patchProposal(p.token, { state: "done" })
        // what was created, seen: the map goes to it
        if ((p.kind === "theater" || p.kind === "asset") && p.place) {
            const r = p.place.radius_km || 30
            runAssistantActions([{ intent: "navigate", slots: { lat: p.place.lat, lon: p.place.lon, place: p.place.label,
                zoom: r > 200 ? 6 : r > 40 ? 8 : 11, altitude: Math.max(15000, r * 2600) } }], platform)
        }
    } catch (e) {
        patchProposal(p.token, { state: "failed", why: e?.message || "That was not saved." })
        return false
    }
    // set-up: the next question (derived from what now exists; free)
    if (state.mode === "onboarding") await turn("")
    if (state.mode === "theater") set({ messages: [...state.messages, { role: "assistant", content: "The theater is created. It is on your tab strip." }] })
    return true
}

/** Set aside without moving the set-up on (Edit replaces it with a form). */
export function dismissAssistantProposal(p) { patchProposal(p.token, { state: "skipped" }) }

export async function skipAssistantProposal(p) {
    patchProposal(p.token, { state: "skipped" })
    if (state.mode === "onboarding" && state.onboarding?.step && state.onboarding.step !== "done") {
        set({ skipped: [...new Set([...state.skipped, state.onboarding.step])] })
        await turn("")
    }
}

/** "Skip this step" in set-up, without an answer. */
export async function skipAssistantStep() {
    const step = state.onboarding?.step
    if (!step || step === "done" || step === "theater") return
    set({ skipped: [...new Set([...state.skipped, step])] })
    await turn("")
}

/** A form's proposal enters the conversation as if the assistant had made it. */
export function addFormProposal(proposal) {
    set({ messages: [...state.messages, { role: "assistant", content: proposal.summary, citations: [],
                                          proposals: [{ ...proposal, state: "pending" }], fromForm: true }] })
}

/**
 * A spoken sentence the voice rules could not place (VoiceBar.jsx). The same
 * turn as a typed one; map actions run at once. An answer worth reading (a
 * cited reply, a refusal, a proposal) opens the assistant with the exchange.
 * @returns {Promise<{handled: boolean, label: string}>}
 */
export async function askByVoice(text, { surface = "desktop" } = {}) {
    let d
    try {
        d = await askTurn({ messages: [{ role: "user", content: String(text).slice(0, 800) }], mode: "chat",
                            client: { platform: "voice" } })
    } catch {
        return { handled: false, label: "" }
    }
    const labels = d.actions?.length ? await runAssistantActions(d.actions, surface) : []
    const worth = d.path === "model" || d.refused || (d.citations || []).length > 0 || (d.proposals || []).length > 0 || !!d.ask
    if (worth) {
        if (state.mode !== "chat") set({ ...blank(), mode: "chat" })
        set({ messages: [...state.messages, { role: "user", content: text },
                         { role: "assistant", content: d.reply || "", citations: d.citations || [], done: labels,
                           proposals: (d.proposals || []).map((p) => ({ ...p, state: "pending" })), ask: d.ask || null }],
              model: d.model || null })
        window.dispatchEvent(new CustomEvent("plx:assistant", { detail: { mode: "chat" } }))
    }
    return { handled: labels.length > 0 || worth, label: labels.join(" · ") || (worth ? "Answered in the assistant" : "") }
}
