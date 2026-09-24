import { describe, it, expect, beforeEach } from "vitest"
import {
    enqueue, list, pending, failed, remove, markAttempt, due, flush,
    backoffMs, newOpId, MAX_ATTEMPTS, OUTBOX_KEY,
} from "./outbox.js"

function store() {
    const m = new Map()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }
}

describe("the outbox", () => {
    let s
    beforeEach(() => { s = store() })

    it("records a write immediately, so the UI never waits on the network", () => {
        const e = enqueue(s, { url: "/api/notes", body: { t: "x" }, label: "note" })
        expect(e.state).toBe("pending")
        expect(pending(s)).toHaveLength(1)
    })

    it("gives every operation an id the server can deduplicate on", () => {
        // A reply lost on the way back must not become a second note.
        const a = enqueue(s, { url: "/a" }), b = enqueue(s, { url: "/b" })
        expect(a.id).not.toBe(b.id)
        expect(newOpId()).toMatch(/^op_/)
    })

    it("backs off exponentially and caps, so a dead server is not hammered", () => {
        expect(backoffMs(0)).toBe(1000)
        expect(backoffMs(3)).toBe(8000)
        expect(backoffMs(99)).toBe(300000)
    })

    it("keeps a write the user made even after giving up on sending it", () => {
        // It becomes something they can see and retry, not something that
        // vanished because the network stayed down.
        const e = enqueue(s, { url: "/a" })
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            markAttempt(s, e.id, { ok: false, error: "offline" })
        }
        expect(pending(s)).toHaveLength(0)
        expect(failed(s)).toHaveLength(1)
        expect(list(s)[0].lastError).toContain("offline")
    })

    it("drops an entry once it is actually sent", () => {
        const e = enqueue(s, { url: "/a" })
        markAttempt(s, e.id, { ok: true })
        expect(list(s)).toHaveLength(0)
    })

    it("does not retry before its backoff has elapsed", () => {
        const e = enqueue(s, { url: "/a" })
        markAttempt(s, e.id, { ok: false, error: "x", now: 1_000_000 })
        expect(due(s, 1_000_000)).toHaveLength(0)
        expect(due(s, 1_000_000 + 2000)).toHaveLength(1)
    })

    it("flushes in order, because user operations are often sequential", async () => {
        enqueue(s, { url: "/1" }); enqueue(s, { url: "/2" }); enqueue(s, { url: "/3" })
        const seen = []
        const fake = async (url) => { seen.push(url); return { ok: true, status: 200 } }
        const out = await flush(s, fake)
        expect(seen).toEqual(["/1", "/2", "/3"])
        expect(out.sent).toBe(3)
        expect(list(s)).toHaveLength(0)
    })

    it("keeps the queue when the network fails mid-flush", async () => {
        enqueue(s, { url: "/1" }); enqueue(s, { url: "/2" })
        let n = 0
        const fake = async () => { n += 1; if (n === 1) return { ok: true, status: 200 }
                                   throw new Error("offline") }
        const out = await flush(s, fake)
        expect(out.sent).toBe(1)
        expect(out.stillFailing).toBe(1)
        expect(pending(s)).toHaveLength(1)
    })

    it("sends the operation id as a header", async () => {
        const e = enqueue(s, { url: "/a", body: { x: 1 } })
        let headers = null
        await flush(s, async (_u, init) => { headers = init.headers; return { ok: true } })
        expect(headers["X-Operation-Id"]).toBe(e.id)
    })

    it("survives storage that throws or holds junk", () => {
        const bad = { getItem() { throw new Error("no") }, setItem() { throw new Error("no") } }
        expect(list(bad)).toEqual([])
        expect(() => enqueue(bad, { url: "/a" })).not.toThrow()
        const junk = store(); junk.setItem(OUTBOX_KEY, "{not json")
        expect(list(junk)).toEqual([])
    })

    it("refuses an entry with nowhere to send it", () => {
        expect(() => enqueue(s, { body: {} })).toThrow()
    })

    it("can drop a failed entry the user gives up on", () => {
        const e = enqueue(s, { url: "/a" })
        remove(s, e.id)
        expect(list(s)).toHaveLength(0)
    })
})
