// @vitest-environment jsdom
// The full chat: conversations kept on the server, restore after a reload,
// stop, retry, proposal states, the history list, and the map column's toggle.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import {
    resetAssistant, getAssistant, sendAssistant, stopAssistant, retryAssistant, restoreAssistant, openConversation,
    newConversation, deleteConversation, confirmAssistantProposal, fromServer, proposalState, unanswered, setAssistantPlatform,
    startAssistant, setAssistantDraft,
} from "./assistantStore.js"
import AssistantThread, { copyText } from "./AssistantThread.jsx"
import { sparkleAction, isChatShortcut, setRightTab, getRightTab } from "./assistantDock.js"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
// a plain in-memory storage (the runner's own localStorage may be a partial one)
const mem = new Map()
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
                  removeItem: (k) => mem.delete(k), clear: () => mem.clear() }
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
Object.defineProperty(window, "localStorage", { value: storage, configurable: true })
const PARIS = { intent: "navigate", slots: { place: "Paris, France", lat: 48.85, lon: 2.35, altitude: 60000, zoom: 11 } }

/** A small stand-in for the server: conversations per user, turns stored by turn_id. */
function fakeServer({ failTurns = 0, hang = false } = {}) {
    const convs = new Map()
    const calls = []
    let n = 0
    let mid = 0
    const ok = (b) => ({ ok: true, status: 200, json: async () => b })
    const fetch = vi.fn(async (url, opts = {}) => {
        const path = String(url).replace(/^.*?\/api/, "/api").replace(/\?.*$/, "")
        const method = opts.method || "GET"
        const body = opts.body ? JSON.parse(opts.body) : {}
        calls.push([method, path, body])
        if (path === "/api/assistant/conversations" && method === "POST") {
            const id = `c${++n}`
            convs.set(id, { id, title: "", mode: body.mode || "chat", skipped: [], messages: [], updated_at: Date.now() / 1000 })
            return ok({ id })
        }
        if (path === "/api/assistant/conversations" && method === "GET") {
            return ok({ conversations: [...convs.values()].filter((c) => c.messages.length)
                .map((c) => ({ id: c.id, title: c.title, count: c.messages.length, last: c.messages.at(-1).content, updated_at: c.updated_at })) })
        }
        const m = path.match(/^\/api\/assistant\/conversations\/([^/]+)(\/.*)?$/)
        if (m) {
            const c = convs.get(m[1])
            if (!c) return { ok: false, status: 404, json: async () => ({ detail: "conversation not found" }) }
            if (!m[2] && method === "GET") return ok(c)
            if (!m[2] && method === "DELETE") { convs.delete(m[1]); return ok({ ok: true }) }
            if (!m[2] && method === "PATCH") { c.title = body.title; return ok(c) }
            if (m[2] === "/stop") {
                if (!c.messages.some((x) => x.turn_id === body.turn_id && x.role === "assistant")) {
                    c.messages.push({ id: ++mid, role: "assistant", content: "Stopped.", stopped: true, turn_id: body.turn_id, created_at: Date.now() / 1000 })
                }
                return ok({ message_id: mid })
            }
            if (m[2] === "/messages") { const ids = body.messages.map((x) => { c.messages.push({ id: ++mid, role: x.role, content: x.content, ...x.meta }); return mid }); return ok({ ids }) }
            const pm = m[2].match(/^\/messages\/(\d+)$/)
            if (pm) { for (const x of c.messages) if (x.id === +pm[1]) for (const p of x.proposals || []) if (p.token === body.token) p.state = body.state; return ok({ ok: true }) }
        }
        if (path === "/api/assistant/turn") {
            if (hang) {
                return new Promise((_, rej) => opts.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))
            }
            const c = convs.get(body.conversation_id)
            const text = body.messages.at(-1)?.content
            if (c && !c.messages.some((x) => x.turn_id === body.turn_id && x.role === "user")) {
                c.messages.push({ id: ++mid, role: "user", content: text, turn_id: body.turn_id }); c.title ||= text
            }
            if (failTurns > 0) { failTurns--; return { ok: false, status: 502, json: async () => ({ detail: "Bad gateway" }) } }
            const out = { reply: "Flying to Paris.", citations: [{ ref: "S1", label: "Paris item", id: "x1", lat: 48.85, lon: 2.35 }], actions: [PARIS],
                          proposals: [{ kind: "asset", token: "tok", summary: "Add HQ", place: { lat: 1, lon: 2, radius_km: 5, label: "HQ" } }],
                          model: { on: false, why: "off" }, path: "rule" }
            if (c) c.messages.push({ id: ++mid, role: "assistant", content: out.reply, turn_id: body.turn_id, created_at: Date.now() / 1000,
                                     citations: out.citations, actions: out.actions, proposals: out.proposals.map((p) => ({ ...p, state: "pending" })) })
            return ok({ ...out, message_id: c ? mid : null, user_message_id: c ? mid - 1 : null, conversation_id: body.conversation_id })
        }
        if (path === "/api/assistant/confirm") return ok({ kind: "asset", method: "POST", path: "/api/my-assets", body: {} })
        return ok({ id: "a1" })
    })
    return { fetch, calls, convs }
}

beforeEach(() => {
    localStorage.clear()
    resetAssistant()
    setAssistantPlatform("desktop")
})

describe("conversations on the server", () => {
    it("the first message creates the conversation once; every turn carries it and a turn id", async () => {
        const srv = fakeServer(); globalThis.fetch = srv.fetch
        await sendAssistant("show me Paris")
        await sendAssistant("show me Paris again")
        const creates = srv.calls.filter(([m, p]) => m === "POST" && p === "/api/assistant/conversations")
        expect(creates).toHaveLength(1)
        const turns = srv.calls.filter(([, p]) => p === "/api/assistant/turn").map(([, , b]) => b)
        expect(turns.every((b) => b.conversation_id === "c1" && /^t/.test(b.turn_id))).toBe(true)
        expect(new Set(turns.map((b) => b.turn_id)).size).toBe(2)
        expect(srv.convs.get("c1").messages).toHaveLength(4)
    })

    it("a reload reopens the same conversation with its citations and map actions (not replayed)", async () => {
        const srv = fakeServer(); globalThis.fetch = srv.fetch
        await sendAssistant("show me Paris")
        const fly = vi.fn(); window.addEventListener("akili:fly-to", fly)
        resetAssistant()                                     // the page reloads; localStorage stays
        expect(await restoreAssistant()).toBe(true)
        window.removeEventListener("akili:fly-to", fly)
        const s = getAssistant()
        expect(s.convId).toBe("c1")
        expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"])
        expect(s.messages[1].citations[0].ref).toBe("S1")
        expect(s.messages[1].done[0]).toMatch(/Paris/)
        expect(fly).not.toHaveBeenCalled()
    })

    it("a conversation that is gone (another user's, deleted) is forgotten", async () => {
        globalThis.fetch = fakeServer().fetch
        localStorage.setItem("plx-assistant-conversation", "nope")
        expect(await restoreAssistant()).toBe(false)
        expect(localStorage.getItem("plx-assistant-conversation")).toBe(null)
    })

    it("Stop drops the request, says Stopped, and tells the server", async () => {
        const srv = fakeServer({ hang: true }); globalThis.fetch = srv.fetch
        const p = sendAssistant("show me Paris")
        await vi.waitFor(() => expect(srv.calls.some(([, path]) => path === "/api/assistant/turn")).toBe(true))
        expect(getAssistant().loading).toBe(true)
        stopAssistant()
        await p
        const s = getAssistant()
        expect(s.loading).toBe(false)
        expect(s.messages.at(-1)).toMatchObject({ content: "Stopped.", stopped: true })
        const turnId = srv.calls.find(([, path]) => path === "/api/assistant/turn")[2].turn_id
        expect(srv.calls.some(([m, path, b]) => m === "POST" && path === "/api/assistant/conversations/c1/stop" && b.turn_id === turnId)).toBe(true)
    })

    it("Retry after an error resends the same turn, and the question is kept once", async () => {
        const srv = fakeServer({ failTurns: 1 }); globalThis.fetch = srv.fetch
        await sendAssistant("show me Paris")
        const err = getAssistant().messages.at(-1)
        expect(err).toMatchObject({ error: true, content: "Bad gateway" })
        await retryAssistant(err)
        const s = getAssistant()
        expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"])
        expect(s.messages.some((m) => m.error)).toBe(false)
        const turns = srv.calls.filter(([, p]) => p === "/api/assistant/turn").map(([, , b]) => b.turn_id)
        expect(turns[0]).toBe(turns[1])
        expect(srv.convs.get("c1").messages.filter((m) => m.role === "user")).toHaveLength(1)
    })

    it("a question with no answer (reload mid-turn) offers Retry", () => {
        expect(unanswered({ loading: false, messages: [{ role: "user", content: "x" }] })?.content).toBe("x")
        expect(unanswered({ loading: true, messages: [{ role: "user", content: "x" }] })).toBe(null)
        expect(unanswered({ loading: false, messages: [{ role: "user" }, { role: "assistant" }] })).toBe(null)
    })

    it("a confirmed proposal's state is stored on its message", async () => {
        const srv = fakeServer(); globalThis.fetch = srv.fetch
        await sendAssistant("show me Paris")
        const p = getAssistant().messages.at(-1).proposals[0]
        expect(await confirmAssistantProposal(p)).toBe(true)
        expect(srv.calls.some(([m, path, b]) => m === "PATCH" && /\/conversations\/c1\/messages\/\d+$/.test(path) && b.state === "done")).toBe(true)
        resetAssistant()
        await openConversation("c1")
        expect(getAssistant().messages.at(-1).proposals[0].state).toBe("done")
    })

    it("New chat starts empty; deleting the open conversation does the same", async () => {
        globalThis.fetch = fakeServer().fetch
        await sendAssistant("show me Paris")
        setAssistantDraft("half")
        await newConversation("chat")
        expect(getAssistant()).toMatchObject({ convId: null, messages: [], draft: "" })
        await openConversation("c1")
        await deleteConversation("c1")
        expect(getAssistant().convId).toBe(null)
    })

    it("opening in chat mode keeps the open conversation", async () => {
        globalThis.fetch = fakeServer().fetch
        await sendAssistant("show me Paris")
        await startAssistant("chat")
        expect(getAssistant().messages).toHaveLength(2)
    })
})

describe("pure helpers", () => {
    it("a stored message becomes a thread message; labels from its actions", () => {
        const m = fromServer({ id: 3, role: "assistant", content: "x", turn_id: "t1", created_at: 100, actions: [PARIS],
                               proposals: [{ token: "a", state: "pending" }] }, "phone")
        expect(m.done).toEqual(["Flying to Paris, France"])
        expect(m.proposals[0].expires_at).toBe(700)
    })
    it("a pending proposal past its 10 minutes is expired; done stays done", () => {
        expect(proposalState({ state: "pending", expires_at: 100 }, 101)).toBe("expired")
        expect(proposalState({ state: "done", expires_at: 100 }, 101)).toBe("done")
        expect(proposalState({ state: "pending", expires_at: 100 }, 99)).toBe("pending")
    })
    it("Copy takes the text and its sources", () => {
        expect(copyText({ content: "A [S1]", citations: [{ ref: "S1", label: "Item", url: "https://x" }] }))
            .toBe("A [S1]\n\nSources:\n[S1] Item https://x")
        expect(copyText({ content: "plain" })).toBe("plain")
    })
    it("the sparkle closes the column only when the chat is in front", () => {
        expect(sparkleAction(true, "assistant")).toBe("close")
        expect(sparkleAction(true, "inspector")).toBe("show")
        expect(sparkleAction(false, "assistant")).toBe("show")
    })
    it("'/' focuses the chat, not while typing", () => {
        expect(isChatShortcut({ key: "/", target: document.body })).toBe(true)
        expect(isChatShortcut({ key: "/", target: document.createElement("input") })).toBe(false)
        expect(isChatShortcut({ key: "/", metaKey: true, target: document.body })).toBe(false)
        const voice = document.createElement("input"); voice.setAttribute("aria-label", "Spoken command")
        expect(isChatShortcut({ key: "/", target: voice })).toBe(true)
        voice.value = "go to"
        expect(isChatShortcut({ key: "/", target: voice })).toBe(false)
    })
    it("the column's tab is remembered", () => {
        setRightTab("assistant"); expect(getRightTab()).toBe("assistant")
        expect(localStorage.getItem("plx-right-tab")).toBe("assistant")
        setRightTab("inspector")
    })
})

describe("the thread on screen", () => {
    it("history lists conversations; picking one opens it; the draft survives a remount", async () => {
        globalThis.fetch = fakeServer().fetch
        await sendAssistant("show me Paris")
        await newConversation("chat")
        const el = document.createElement("div"); document.body.appendChild(el)
        const root = createRoot(el)
        await act(async () => { root.render(<AssistantThread platform="desktop" autoFocus={false} />) })
        await act(async () => { el.querySelector('[data-testid="assistant-history-btn"]').click() })
        await vi.waitFor(() => expect(el.querySelectorAll('[data-testid="assistant-conversation"]')).toHaveLength(1))
        expect(el.textContent).toContain("show me Paris")
        await act(async () => { el.querySelector(".plx-as-conv-open").click() })
        await vi.waitFor(() => expect(el.querySelectorAll('[data-testid="assistant-msg-assistant"]').length).toBe(1))
        expect(el.querySelector('[data-testid="assistant-citation"]').textContent).toContain("Paris item")
        await act(async () => { setAssistantDraft("line one\nline two") })
        await act(async () => { root.unmount() })
        const root2 = createRoot(el)
        await act(async () => { root2.render(<AssistantThread platform="phone" autoFocus={false} />) })
        expect(el.querySelector("textarea").value).toBe("line one\nline two")
        expect(el.querySelector('[data-testid="assistant-msg-assistant"]')).not.toBe(null)
        await act(async () => { root2.unmount() })
        el.remove()
    })
})
