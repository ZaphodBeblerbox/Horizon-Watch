// @vitest-environment jsdom
// "Write a post" from a signal: the item sent, the draft card, nothing on the
// Desk before the confirm, Copy, and "write a post about this" with an item open.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { resetAssistant, getAssistant, writePostAbout, sendAssistant } from "./assistantStore.js"
import AssistantThread from "./AssistantThread.jsx"
import { postItemFrom, deskPostBody, isPostRequest, setOpenItem, mediaFileName } from "./postDraft.js"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mem = new Map()
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
                  removeItem: (k) => mem.delete(k), clear: () => mem.clear() }
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
Object.defineProperty(window, "localStorage", { value: storage, configurable: true })

const SIGNAL = { id: "ls-1", kind: "live_signal", title: "Police charge protesters at Place Bellecour", place: "Place Bellecour, Lyon",
                 event_time: "2026-10-23T17:41:00Z", corroboration: { line: "Corroborated by 2 sources" }, lat: 45.75, lon: 4.83,
                 sources: [{ channel: "lyoninsurge", msg_id: 10, channel_title: "Lyon Insurgé", url: "https://t.me/lyoninsurge/10",
                             media: "photo", thumb_url: "/api/telegram/media/lyoninsurge/10.jpg" }] }

function server() {
    const calls = []
    const fetch = vi.fn(async (url, opts = {}) => {
        const path = String(url).replace(/^.*?\/api/, "/api")
        const body = opts.body ? JSON.parse(opts.body) : {}
        calls.push([opts.method || "GET", path, body])
        const ok = (b) => ({ ok: true, status: 200, json: async () => b })
        if (path === "/api/assistant/conversations") return ok({ id: "c1" })
        if (path.endsWith("/messages")) return ok({ ids: body.messages.map((_, i) => 10 + i) })
        if (path === "/api/assistant/draft_post") {
            return ok({ short: "Police charge protesters at Place Bellecour, Lyon, 17:41 UTC, 23 Oct. Corroborated by 2 sources. Source: Lyon Insurgé.",
                        long: "Longer text.", citations: [{ ref: "I1", label: SIGNAL.title }], path: "template", model: { on: false, why: "off" } })
        }
        if (path === "/api/desk/posts") return ok({ id: "post-1" })
        return ok({ ok: true })
    })
    return { fetch, calls }
}

beforeEach(() => { mem.clear(); resetAssistant(); setOpenItem(null) })

describe("pure helpers", () => {
    it("the item a post may use, from a card's record", () => {
        const it = postItemFrom({ entityType: "signal", data: { headline: "Fire at the port", location: "Khor Fakkan", published_at: "2026-10-23T10:00:00Z", url: "https://x/a" } })
        expect(it).toMatchObject({ title: "Fire at the port", place: "Khor Fakkan", event_time: "2026-10-23T10:00:00Z", url: "https://x/a" })
        expect(postItemFrom(null)).toBe(null)
    })
    it("a Telegram item goes to the Desk as a telegram attachment, anything else as a signal", () => {
        const tg = deskPostBody("text", { ...postItemFrom(SIGNAL), channel: "lyoninsurge", msg_id: 10 })
        expect(tg.attachment).toMatchObject({ kind: "telegram", channel: "lyoninsurge", msg_id: 10 })
        expect(deskPostBody("t", postItemFrom({ id: "a", title: "x" })).attachment.kind).toBe("signal")
    })
    it("recognises 'write a post about this'", () => {
        expect(isPostRequest("write a post about this")).toBe(true)
        expect(isPostRequest("Draft a short post on it")).toBe(true)
        expect(isPostRequest("what is the latest post")).toBe(false)
    })
    it("names the downloaded file", () => {
        expect(mediaFileName({ type: "video" }, "Police charge!")).toBe("police-charge.mp4")
        expect(mediaFileName({ type: "photo" }, "", "image/png")).toBe("media.png")
    })
})

describe("the draft", () => {
    it("Write a post: the item goes to the server, the draft card shows with its media", async () => {
        const srv = server(); globalThis.fetch = srv.fetch
        await writePostAbout(SIGNAL)
        const sent = srv.calls.find(([, p]) => p === "/api/assistant/draft_post")[2].item
        expect(sent).toMatchObject({ id: "ls-1", title: SIGNAL.title, event_time: SIGNAL.event_time })
        const m = getAssistant().messages.at(-1)
        expect(m.draft.short).toMatch(/^Police charge/)
        expect(m.draft.media.type).toBe("photo")
        expect(getAssistant().messages.map((x) => x.role)).toEqual(["user", "assistant"])
    })

    it("nothing reaches the Desk before the confirm; Copy copies the text", async () => {
        const srv = server(); globalThis.fetch = srv.fetch
        const clip = vi.fn(async () => {})
        Object.defineProperty(navigator, "clipboard", { value: { writeText: clip }, configurable: true })
        await writePostAbout(SIGNAL)
        const el = document.createElement("div"); document.body.appendChild(el)
        const root = createRoot(el)
        await act(async () => { root.render(<AssistantThread platform="desktop" autoFocus={false} />) })
        const q = (id) => el.querySelector(`[data-testid="${id}"]`)
        expect(q("assistant-draft")).not.toBe(null)
        await act(async () => { q("assistant-draft-copy").click() })
        expect(clip).toHaveBeenCalledWith(expect.stringMatching(/^Police charge/))
        await act(async () => { q("assistant-draft-post").click() })
        expect(srv.calls.some(([, p]) => p === "/api/desk/posts")).toBe(false)      // asked, not posted
        expect(q("assistant-draft-confirm")).not.toBe(null)
        await act(async () => { q("assistant-draft-confirm-post").click() })
        await vi.waitFor(() => expect(q("assistant-draft-posted")).not.toBe(null))
        const post = srv.calls.find(([, p]) => p === "/api/desk/posts")
        expect(post[2].body).toMatch(/^Police charge/)
        expect(post[2].attachment).toMatchObject({ kind: "telegram", channel: "lyoninsurge", msg_id: 10 })
        expect(srv.calls.some(([m, p, b]) => m === "PATCH" && /\/messages\/\d+$/.test(p) && b.draft?.state === "posted")).toBe(true)
        await act(async () => { root.unmount() })
        el.remove()
    })

    it("'write a post about this' with an item open drafts it instead of a turn", async () => {
        const srv = server(); globalThis.fetch = srv.fetch
        setOpenItem(SIGNAL)
        await sendAssistant("write a post about this")
        expect(srv.calls.some(([, p]) => p === "/api/assistant/draft_post")).toBe(true)
        expect(srv.calls.some(([, p]) => p === "/api/assistant/turn")).toBe(false)
    })
})
