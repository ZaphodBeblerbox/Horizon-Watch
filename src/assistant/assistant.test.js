// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { planActions, citationRoute, PHONE_LAYER } from "./assistantActions.js"
import { splitRefs } from "./AssistantThread.jsx"
import { formFields } from "./AssistantForms.jsx"
import { turnBody, resetAssistant, getAssistant, sendAssistant, startAssistant, confirmAssistantProposal, setAssistantPlatform } from "./assistantStore.js"
import { runConfirmed } from "./assistantApi.js"

const PARIS = { intent: "navigate", slots: { place: "Paris, France", lat: 48.85, lon: 2.35, altitude: 60000, zoom: 11 } }

describe("map actions", () => {
    it("desktop: open the map and fly to the server's coordinates", () => {
        const { events, labels } = planActions([PARIS], "desktop")
        expect(events.map((e) => e[0])).toEqual(["akili:open-map", "akili:fly-to"])
        expect(events[1][1]).toEqual({ lat: 48.85, lon: 2.35, altitude: 60000 })
        expect(labels[0]).toMatch(/Paris/)
    })
    it("phone: the same place, through the phone shell", () => {
        const { events } = planActions([PARIS], "phone")
        expect(events).toEqual([["m2:assistant-fly", { lat: 48.85, lon: 2.35, zoom: 11, label: "Paris, France" }]])
    })
    it("phone layers use the phone's own keys; a flip reads what is on", () => {
        const on = planActions([{ intent: "layer", slots: { layer: "heat", on: true } }], "phone")
        expect(on.events[0]).toEqual(["m2:layers", { fires: true }])
        const flip = planActions([{ intent: "layer", slots: { layer: "vessels", on: null } }], "phone", { ships: true })
        expect(flip.events[0]).toEqual(["m2:layers", { ships: false }])
        expect(PHONE_LAYER.airfields).toEqual(["airports"])
    })
    it("a navigate without coordinates does nothing", () => {
        expect(planActions([{ intent: "navigate", slots: { place: "x" } }], "desktop").events).toEqual([])
    })
    it("unknown intents are ignored", () => {
        expect(planActions([{ intent: "delete", slots: {} }], "desktop").events).toEqual([])
    })
    it("a citation opens as a signal, an asset, or a vessel", () => {
        expect(citationRoute({ kind: "asset", assetId: "a1", label: "HQ" })).toEqual({ assetId: "a1", title: "HQ" })
        expect(citationRoute({ kind: "vessel", mmsi: "123", label: "X", lat: 1, lon: 2 }).mmsi).toBe("123")
        expect(citationRoute({ kind: "alert", id: "ALT-1", label: "A", lat: 1, lon: 2 }).alertId).toBe("ALT-1")
    })
})

describe("citations in the text", () => {
    it("keeps only refs the server returned", () => {
        const parts = splitRefs("Clashes [S1] and more [S1, X9].", [{ ref: "S1", label: "Clashes" }])
        expect(parts.filter((p) => p.ref).map((p) => p.ref)).toEqual(["S1", "S1"])
        expect(parts.map((p) => p.text || "").join("")).toBe("Clashes  and more .")
    })
})

describe("forms", () => {
    it("send the fields the server's proposals read", () => {
        expect(formFields("care", { regions: ["Levant"], countries: "France, Ukraine" }))
            .toEqual({ regions: ["Levant"], topics: [], countries: ["France", "Ukraine"] })
        expect(formFields("theater", { place: "Lyon", radius: "80" })).toEqual({ name: undefined, place: "Lyon", radius_km: 80 })
        expect(formFields("here", { place: "Lyon" })).toEqual({ here_place: "Lyon", here_radius_km: undefined })
    })
})

describe("the conversation", () => {
    beforeEach(() => { resetAssistant(); setAssistantPlatform("desktop") })

    it("sends the last messages, the mode and the skipped steps", () => {
        const b = turnBody({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], mode: "onboarding", skipped: ["protect"] }, "c")
        expect(b.messages).toEqual([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }])
        expect(b.mode).toBe("onboarding")
        expect(b.onboarding.skipped).toEqual(["protect"])
    })

    it("a cited answer with a fly: stored with its citations, and the map moves", async () => {
        const seen = []
        const h = (e) => seen.push([e.type, e.detail])
        window.addEventListener("akili:fly-to", h)
        globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({
            reply: "Clashes at Bellecour [S1].", citations: [{ ref: "S1", label: "Clashes", lat: 45.7, lon: 4.8 }],
            actions: [{ intent: "navigate", slots: { place: "Lyon", lat: 45.76, lon: 4.83, altitude: 60000 } }],
            proposals: [], model: { on: true }, path: "model" }) }))
        await sendAssistant("What's happening near my Lyon office?")
        window.removeEventListener("akili:fly-to", h)
        const s = getAssistant()
        expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"])
        expect(s.messages[1].citations[0].ref).toBe("S1")
        expect(seen[0][1]).toEqual({ lat: 45.76, lon: 4.83, altitude: 60000 })
        const turnCall = globalThis.fetch.mock.calls.find((c) => String(c[0]).endsWith("/api/assistant/turn"))
        expect(JSON.parse(turnCall[1].body).client.platform).toBe("desktop")
    })

    it("onboarding: confirm calls /confirm, then the existing endpoint, then asks the next step", async () => {
        const calls = []
        globalThis.fetch = vi.fn(async (url, opts) => {
            calls.push([String(url).replace(/^.*?\/api/, "/api"), opts?.method || "GET"])
            if (String(url).endsWith("/api/assistant/turn")) {
                const n = calls.filter((c) => c[0] === "/api/assistant/turn").length
                return { ok: true, json: async () => (n === 1
                    ? { reply: "Where should the theater cover?", onboarding: { step: "theater" }, proposals: [], actions: [] }
                    : { reply: "ok", onboarding: { step: "theater" }, actions: [], proposals: [
                        { kind: "theater", token: "t1", summary: "Create the theater Lyon", place: { lat: 45.7, lon: 4.8, radius_km: 50, label: "Lyon" } }] }) }
            }
            if (String(url).endsWith("/api/assistant/confirm")) {
                return { ok: true, json: async () => ({ kind: "theater", method: "POST", path: "/api/theaters", body: { name: "Lyon" } }) }
            }
            return { ok: true, json: async () => ({ id: "th1", name: "Lyon" }) }
        })
        await startAssistant("theater")
        await sendAssistant("Lyon, 50 km")
        const p = getAssistant().messages.at(-1).proposals[0]
        expect(calls.some((c) => c[0] === "/api/theaters")).toBe(false)      // nothing written yet
        expect(await confirmAssistantProposal(p)).toBe(true)
        expect(calls.map((c) => c[0]).filter((u) => !u.startsWith("/api/assistant/conversations")))
            .toEqual(["/api/assistant/turn", "/api/assistant/turn", "/api/assistant/confirm", "/api/theaters"])
        expect(getAssistant().messages.at(-2).proposals[0].state).toBe("done")
    })

    it("a refused confirm leaves the card failed and writes nothing", async () => {
        const calls = []
        globalThis.fetch = vi.fn(async (url) => {
            calls.push(String(url))
            return { ok: false, status: 400, json: async () => ({ detail: "this proposal has expired; ask again" }) }
        })
        const p = { token: "bad", kind: "asset", summary: "x" }
        // put it in the conversation
        const { addFormProposal } = await import("./assistantStore.js")
        addFormProposal(p)
        expect(await confirmAssistantProposal(p)).toBe(false)
        expect(getAssistant().messages.at(-1).proposals[0]).toMatchObject({ state: "failed", why: "this proposal has expired; ask again" })
        expect(calls.filter((u) => !u.includes("/api/assistant/conversations")).every((u) => u.endsWith("/api/assistant/confirm"))).toBe(true)
    })

    it("runConfirmed sends the planned request", async () => {
        const f = vi.fn(async () => ({ ok: true, json: async () => ({ id: "a1" }) }))
        await runConfirmed({ kind: "asset", method: "POST", path: "/api/my-assets", body: { name: "HQ" } }, { fetchImpl: f })
        expect(f.mock.calls[0][0]).toMatch(/\/api\/my-assets$/)
        expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "HQ" })
    })
})
