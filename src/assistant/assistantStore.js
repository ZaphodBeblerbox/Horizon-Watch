/**
 * assistantStore.js — the open conversation and the list of past ones, kept
 * outside the screens so the phone can switch to the map (to show a fly)
 * and come back to the same thread, and the desktop column can switch to the
 * Inspector and back without losing the scroll or the draft.
 *
 * Every turn goes to POST /api/assistant/turn. The server decides: the rule
 * path (free: map commands, the set-up questions), the model (with tools and
 * citations), or the honest "model is off" answer with the forms.
 *
 * Conversations live on the server, per user (backend/assistant_history.py):
 * a turn carries conversation_id + turn_id and the server stores the question
 * and the answer. The conversation is created on the first message (an
 * unused "New chat" leaves nothing behind). Which one was open is remembered
 * in this browser, so a reload reopens it. No call here reaches the model
 * except the user's own turns.
 */
import { useSyncExternalStore } from "react"
import {
    askTurn, confirmProposal, createConversation, getConversation, listConversations,
    renameConversation as apiRename, deleteConversation as apiDelete, appendMessages, stopTurn, setProposalState,
} from "./assistantApi.js"
import { runAssistantActions, planActions } from "./assistantActions.js"

const HISTORY = 8
const TTL_S = 600                     // a proposal's token lives 10 minutes (assistant.PROPOSAL_TTL_S)
const KEY = "plx-assistant-conversation"
const blank = (mode = "chat") => ({
    convId: null, title: "", messages: [], mode, skipped: [], loading: false, turnId: null,
    onboarding: null, model: null, restoring: false,
    list: null, listLoading: false, draft: "",
})
let state = { ...blank(), list: null }
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f()) }
let controller = null
let restored = false
const scrolls = new Map()             // conversation -> scrollTop, so a switch back lands where it was

export const getAssistant = () => state
export function subscribeAssistant(fn) { subs.add(fn); return () => subs.delete(fn) }
export function useAssistant() { return useSyncExternalStore(subscribeAssistant, getAssistant, getAssistant) }
export function resetAssistant() { controller?.abort(); controller = null; restored = false; scrolls.clear(); state = blank(); subs.forEach((f) => f()) }

let platform = "desktop"
export function setAssistantPlatform(p) { platform = p }
export const setAssistantDraft = (draft) => { if (draft !== state.draft) set({ draft }) }
export const saveScroll = (top) => scrolls.set(state.convId || "new", top)
export const savedScroll = () => scrolls.get(state.convId || "new")

function remember(id) {
    try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY) } catch { /* private mode */ }
}
function remembered() {
    try { return localStorage.getItem(KEY) } catch { return null }
}
const newTurnId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const nowS = () => Date.now() / 1000

/** The body the server reads: the last messages as plain text (errors and stops left out). */
export function turnBody(s, text) {
    const msgs = s.messages.filter((m) => (m.role === "user" || m.role === "assistant") && !m.error && !m.stopped)
        .map((m) => ({ role: m.role, content: m.content }))
    if (text) msgs.push({ role: "user", content: text })
    return { messages: msgs.slice(-HISTORY), mode: s.mode, client: { platform }, onboarding: { skipped: s.skipped } }
}

/** A stored message (server shape) as the thread shows it. Pure (tested). */
export function fromServer(m, plat = platform) {
    const created = m.created_at || nowS()
    return {
        id: m.id, role: m.role, content: m.content || "", turnId: m.turn_id || null, created_at: created,
        citations: m.citations || [], actions: m.actions || [],
        done: m.actions?.length ? planActions(m.actions, plat).labels : [],
        proposals: (m.proposals || []).map((p) => ({ ...p, expires_at: p.expires_at || created + TTL_S })),
        ask: m.ask || null, forms: !!m.forms, refused: !!m.refused, stopped: !!m.stopped,
        step: m.step || null, chips: m.chips || null, fromForm: !!m.fromForm,
    }
}

/** A proposal's state as shown: a pending token past its 10 minutes is expired. */
export function proposalState(p, now = nowS()) {
    const st = p?.state || "pending"
    return (st === "pending" || st === "failed") && p?.expires_at && now > p.expires_at ? "expired" : st
}

/** A user's message with no answer after it (a reload mid-turn, a dropped request): offer Retry. */
export function unanswered(s) {
    const last = s.messages[s.messages.length - 1]
    return !s.loading && last?.role === "user" ? last : null
}

async function ensureConversation() {
    if (state.convId) return state.convId
    try {
        const c = await createConversation(state.mode)
        if (c?.id) { set({ convId: c.id }); remember(c.id) }
        return c?.id || null
    } catch {
        return null                    // still answers; this exchange just is not kept
    }
}

async function turn(text, { retry = null } = {}) {
    if (state.loading) return null
    const turnId = retry?.turnId || newTurnId()
    let messages = state.messages.filter((m) => !(m.error && m.retry?.turnId === turnId))
    if (text && !retry) messages = [...messages, { role: "user", content: text, turnId, created_at: nowS() }]
    const body = turnBody({ ...state, messages }, null)
    set({ messages, loading: true, turnId })
    const convId = await ensureConversation()
    const ctl = new AbortController()
    controller = ctl
    let d
    try {
        d = await askTurn({ ...body, ...(convId ? { conversation_id: convId, turn_id: turnId } : {}) }, { signal: ctl.signal })
    } catch (e) {
        if (ctl.signal.aborted || state.turnId !== turnId) return null      // stopped, or another thread opened
        set({ loading: false, turnId: null, messages: [...state.messages, {
            role: "assistant", content: e?.message || "The assistant did not answer.", error: true,
            retry: text || retry ? { text: text || retry.text, turnId } : null }] })
        return null
    } finally {
        if (controller === ctl) controller = null
    }
    if (state.turnId !== turnId || d?.stopped) return null
    const labels = d.actions?.length ? await runAssistantActions(d.actions, platform) : []
    const created = nowS()
    const msg = {
        id: d.message_id || null, role: "assistant", content: d.reply || "", turnId, created_at: created,
        citations: d.citations || [], actions: d.actions || [],
        proposals: (d.proposals || []).map((p) => ({ ...p, state: "pending", expires_at: created + TTL_S })),
        ask: d.ask || null, done: labels, forms: !!d.forms, refused: !!d.refused,
        step: d.onboarding?.step || null, chips: d.onboarding?.chips || null,
    }
    const userId = d.user_message_id
    set({ loading: false, turnId: null,
          messages: [...state.messages.map((m) => (userId && m.turnId === turnId && m.role === "user" ? { ...m, id: userId } : m)), msg],
          onboarding: d.onboarding || null, model: d.model || null, skipped: d.skipped || state.skipped,
          title: state.title || (text ? text.slice(0, 60) : state.title) })
    if (state.list) loadConversations()
    return d
}

export const sendAssistant = (text) => {
    const t = String(text || "").trim().slice(0, 800)
    return t ? turn(t) : Promise.resolve(null)
}

/** Ask again after an error, or for a question that has no answer (reload mid-turn). */
export function retryAssistant(m) {
    if (m?.retry) return turn(null, { retry: m.retry })
    if (m?.role === "user") return turn(null, { retry: { text: m.content, turnId: m.turnId || newTurnId() } })
    return Promise.resolve(null)
}

/** Stop: the request is dropped here and "Stopped." becomes the turn's answer on the server too. */
export function stopAssistant() {
    if (!state.loading) return
    const turnId = state.turnId
    controller?.abort()
    controller = null
    set({ loading: false, turnId: null, messages: [...state.messages, { role: "assistant", content: "Stopped.", stopped: true, turnId, created_at: nowS() }] })
    if (state.convId && turnId) stopTurn(state.convId, turnId).catch(() => {})
}

/** A fresh conversation ("New chat"), or a set-up one ("onboarding", "theater") that asks its first question. */
export function newConversation(mode = "chat") {
    controller?.abort(); controller = null
    remember(null)
    set({ ...blank(mode), list: state.list, draft: "" })
    return mode === "chat" ? Promise.resolve(null) : turn("")
}

/** Open in a mode: "chat" keeps the open conversation; a set-up mode starts one unless it is already open. */
export function startAssistant(mode = "chat") {
    if (mode === state.mode && (mode === "chat" || state.messages.length)) return Promise.resolve(null)
    return newConversation(mode)
}

export async function openConversation(id) {
    if (!id) return false
    controller?.abort(); controller = null
    set({ restoring: true, loading: false, turnId: null })
    try {
        const c = await getConversation(id)
        const messages = (c.messages || []).map((m) => fromServer(m))
        const last = [...messages].reverse().find((m) => m.role === "assistant" && m.step)
        set({ ...blank(c.mode || "chat"), list: state.list, convId: c.id, title: c.title || "", messages,
              skipped: c.skipped || [], onboarding: last && c.mode !== "chat" ? { step: last.step, chips: last.chips } : null,
              model: state.model })
        remember(c.id)
        return true
    } catch (e) {
        set({ restoring: false })
        if (e?.status === 404 && remembered() === id) remember(null)
        return false
    }
}

/** Reopen what was open before the reload (once per page). */
export function restoreAssistant() {
    if (restored) return Promise.resolve(false)
    restored = true
    const id = remembered()
    if (!id || state.convId || state.messages.length) return Promise.resolve(false)
    return openConversation(id)
}

export async function loadConversations() {
    set({ listLoading: true })
    try { set({ list: await listConversations(), listLoading: false }) } catch { set({ listLoading: false, list: state.list || [] }) }
}

export async function renameConversation(id, title) {
    const t = String(title || "").trim()
    if (!t) return false
    try {
        await apiRename(id, t)
        set({ list: (state.list || []).map((c) => (c.id === id ? { ...c, title: t } : c)), ...(state.convId === id ? { title: t } : {}) })
        return true
    } catch { return false }
}

export async function deleteConversation(id) {
    try { await apiDelete(id) } catch (e) { if (e?.status !== 404) return false }
    set({ list: (state.list || []).filter((c) => c.id !== id) })
    if (state.convId === id) newConversation("chat")
    return true
}

function patchProposal(token, patch) {
    let mid = null
    set({ messages: state.messages.map((m) => {
        if (!m.proposals?.some((p) => p.token === token)) return m
        mid = m.id
        return { ...m, proposals: m.proposals.map((p) => (p.token === token ? { ...p, ...patch } : p)) }
    }) })
    // kept on the server so a reload shows Created / Skipped, not a live button
    if (state.convId && mid && patch.state && patch.state !== "saving") {
        setProposalState(state.convId, mid, token, patch.state, patch.why).catch(() => {})
    }
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
    if (state.mode === "theater") addLocal({ role: "assistant", content: "The theater is created. It is on your tab strip." })
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

/** Messages made here (a form's proposal, a spoken exchange), kept like the rest. */
async function addLocal(...msgs) {
    const stamped = msgs.map((m) => ({ created_at: nowS(), ...m }))
    set({ messages: [...state.messages, ...stamped] })
    const id = await ensureConversation()
    if (!id) return
    try {
        const out = await appendMessages(id, stamped.map(({ role, content, citations, actions, proposals, ask, fromForm }) => ({
            role, content, meta: { citations, actions, proposals, ask, fromForm } })))
        const ids = out?.ids || []
        if (ids.length === stamped.length) {
            set({ messages: state.messages.map((m) => { const i = stamped.indexOf(m); return i >= 0 ? { ...m, id: ids[i] } : m }) })
        }
    } catch { /* shown, not kept */ }
}

/** A form's proposal enters the conversation as if the assistant had made it. */
export function addFormProposal(proposal) {
    const created = nowS()
    return addLocal({ role: "assistant", content: proposal.summary, citations: [], fromForm: true,
                      proposals: [{ ...proposal, state: "pending", expires_at: created + TTL_S }] })
}

/**
 * A spoken sentence the voice rules could not place (VoiceBar.jsx). The same
 * turn as a typed one; map actions run at once. An answer worth reading (a
 * cited reply, a refusal, a proposal) opens the assistant with the exchange,
 * in the open conversation.
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
        if (state.mode !== "chat") newConversation("chat")
        const created = nowS()
        set({ model: d.model || null })
        addLocal({ role: "user", content: text },
                 { role: "assistant", content: d.reply || "", citations: d.citations || [], done: labels, actions: d.actions || [],
                   proposals: (d.proposals || []).map((p) => ({ ...p, state: "pending", expires_at: created + TTL_S })), ask: d.ask || null })
        window.dispatchEvent(new CustomEvent("plx:assistant", { detail: { mode: "chat" } }))
    }
    return { handled: labels.length > 0 || worth, label: labels.join(" · ") || (worth ? "Answered in the assistant" : "") }
}
