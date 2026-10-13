// @vitest-environment jsdom
// Owner, 2026-10-13: the smoke detector called fields and runways smoke.
// An analyst answers "Correct" or "Not this — it's: …"; the answer is stored
// per user (POST …/feedback) and read back as *theirs*, not someone else's.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import DetectionFeedback, { feedbackId } from "./DetectionFeedback.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DET = {
    id: "DET-98216ce6858e", object_type: "smoke_plume", conf: 0.9,
    attributes: JSON.stringify({ class_confidence: 0.71, classifier: "rules v1", tier: "confirmed",
        reasons: [{ kind: "fire", sign: "+", text: "hot spot at its edge" }] }),
}

let root, host, calls, items
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
    // Node's own (flag-less) localStorage has no getItem; auth.js reads the token from it.
    const store = new Map()
    vi.stubGlobal("localStorage", { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) })
    calls = []
    items = []
    globalThis.fetch = vi.fn(async (url, init) => {
        calls.push({ url: String(url), init })
        if (init?.method === "POST") {
            const b = JSON.parse(init.body)
            return { ok: true, status: 200, json: async () => ({ status: "saved", feedback: { ...b, mine: true, user: "me" } }) }
        }
        return { ok: true, status: 200, json: async () => ({ items }) }
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe("DetectionFeedback", () => {
    it("takes the reference detection's id for a 'gone' outline", () => {
        expect(feedbackId({ id: "removed-DET-1" })).toBe("DET-1")
        expect(feedbackId({ detection_id: "DET-2", id: "x" })).toBe("DET-2")
    })

    it("shows the class and reasons, and sends 'Not this — it's: Field' as the user's answer", async () => {
        await act(async () => root.render(<DetectionFeedback det={DET} />))
        await flush()
        expect(host.querySelector("[data-detection-class]").textContent).toBe("Smoke plume")
        expect(host.textContent).toContain("71% sure")
        expect(host.querySelector("[data-class-reasons]").textContent).toContain("hot spot at its edge")
        // every distinct class an analyst may answer with, the detection's own left out
        const keys = [...host.querySelectorAll("[data-feedback-class]")].map((b) => b.dataset.feedbackClass)
        expect(keys).toEqual(expect.arrayContaining(["field", "runway", "cloud_shadow", "port_infrastructure", "storage_tank", "aircraft", "vessel", "burn_scar"]))
        expect(keys).not.toContain("smoke_plume")

        await act(async () => host.querySelector('[data-feedback-class="field"]').click())
        await flush()
        const post = calls.find((c) => c.init?.method === "POST")
        expect(post.url).toContain("/api/imagery/detections/DET-98216ce6858e/feedback")
        expect(JSON.parse(post.init.body)).toEqual({ verdict: "incorrect", actual_class: "field", note: null })
        expect(host.querySelector("[data-feedback-state]").textContent).toContain("Marked as: Field")
    })

    it("reads back only the caller's own answer; others are counted", async () => {
        items = [
            { verdict: "correct", actual_class: null, mine: false, user: "JC", updated_at: "2026-10-13T12:00:00Z" },
            { verdict: "incorrect", actual_class: "runway", mine: true, user: "me", updated_at: "2026-10-13T09:00:00Z" },
        ]
        await act(async () => root.render(<DetectionFeedback det={DET} />))
        await flush()
        expect(host.querySelector("[data-feedback-state]").textContent).toContain("Marked as: Runway")
        expect(host.textContent).toContain("0 of 1 other analyst agree")
    })

    it("someone else's answer is not shown as mine: the choices stay open", async () => {
        items = [{ verdict: "correct", actual_class: null, mine: false, user: "JC", updated_at: "2026-10-13T12:00:00Z" }]
        await act(async () => root.render(<DetectionFeedback det={DET} />))
        await flush()
        expect(host.querySelector("[data-feedback-state]")).toBeNull()
        expect(host.querySelector('[data-feedback="correct"]')).toBeTruthy()
        expect(host.textContent).toContain("1 other analyst has answered")
    })

    it("says so when the answer was not saved", async () => {
        globalThis.fetch = vi.fn(async (url, init) => init?.method === "POST"
            ? { ok: false, status: 422, json: async () => ({ detail: "say what it is instead" }) }
            : { ok: true, status: 200, json: async () => ({ items: [] }) })
        await act(async () => root.render(<DetectionFeedback det={DET} />))
        await flush()
        await act(async () => host.querySelector('[data-feedback="correct"]').click())
        await flush()
        expect(host.querySelector("[data-feedback-error]").textContent).toContain("say what it is instead")
    })
})
