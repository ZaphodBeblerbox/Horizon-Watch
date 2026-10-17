// @vitest-environment jsdom
// The phone's Messages renders as a messenger, shows somebody typing, and
// hands the chrome over while the composer is focused (owner, 2026-10-17).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

const api = vi.hoisted(() => ({
    listConversations: vi.fn(), listMessages: vi.fn(), getTyping: vi.fn(), setTyping: vi.fn(),
    markRead: vi.fn(), sendMessage: vi.fn(), startConversation: vi.fn(), chatPeople: vi.fn(),
    attachmentUrl: (c, m) => `/f/${c}/${m}`,
}))
vi.mock("../../lib/chatApi.js", () => api)
vi.mock("../../state/authStore.js", () => ({ getCurrentUser: () => ({ id: "me", name: "Me" }) }))

import MMessages from "./MMessages.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

let host, root
beforeEach(() => {
    host = document.createElement("div"); host.className = "m2"; document.body.appendChild(host)
    root = createRoot(host)
    const conv = {
        id: "c1", kind: "direct", title: "Ana Lima", unread: 2, last_message_at: "2026-10-17T09:00:00",
        members: [{ id: "me", name: "Me" }, { id: "ana", name: "Ana Lima" }],
        last_message: { id: "m2", sender_id: "ana", kind: "text", body: "are you there?" },
    }
    api.listConversations.mockResolvedValue([conv])
    api.listMessages.mockResolvedValue({
        messages: [
            { id: "m1", sender_id: "me", kind: "text", body: "hello", created_at: "2026-10-17T08:59:00" },
            { id: "m2", sender_id: "ana", kind: "text", body: "are you there?", created_at: "2026-10-17T09:00:00" },
        ],
        typing: [{ id: "ana", name: "Ana Lima" }], read_at: "2026-10-17T09:00:00",
    })
    api.getTyping.mockResolvedValue({ typing: [], read_at: null })
    api.setTyping.mockResolvedValue({ ok: true })
    api.markRead.mockResolvedValue({ ok: true })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })

describe("MMessages", () => {
    it("lists conversations with a grey face, preview and unread count, then opens a thread", async () => {
        await act(async () => root.render(<MMessages active />))
        await flush()
        const row = host.querySelector(".mm-row")
        expect(row.querySelector(".mm-face").textContent).toBe("AL")
        expect(row.querySelector(".mm-preview").textContent).toContain("are you there?")
        expect(row.querySelector(".mm-count").textContent).toBe("2")

        await act(async () => row.click())
        await flush()
        expect([...host.querySelectorAll(".mm-bub")].map((b) => b.firstChild.textContent)).toEqual(["hello", "are you there?"])
        expect(host.querySelector(".mm-line.mine .mm-tick.read")).toBeTruthy()
        expect(host.querySelector(".mm-typing")).toBeTruthy()
        expect(host.querySelector(".mm-who span").textContent).toBe("Ana is typing…")
        expect(host.querySelector(".mm-day").textContent).toBeTruthy()

        // focusing the composer hands the screen to the thread
        const seen = []
        const on = (e) => seen.push(e.detail.hidden)
        window.addEventListener("m2:chrome", on)
        const box = host.querySelector("textarea.mm-input")
        await act(async () => { box.focus(); box.dispatchEvent(new FocusEvent("focusin", { bubbles: true })) })
        expect(host.querySelector(".mm-thread.full")).toBeTruthy()
        await act(async () => { box.blur() })
        window.removeEventListener("m2:chrome", on)
        expect(seen).toEqual([true, false])
    })
})
