/**
 * Offline login must work, and must not become a way in that the server
 * cannot close.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { webcrypto } from "node:crypto"
import {
    enrol, offlineLogin, safeEqual, deriveDigest, forgetEnrolment,
    REFUSAL, OFFLINE_GRACE_MS,
} from "./offlineAuth.js"
import { memoryStore } from "./offlineCache.js"

const crypto = webcrypto
// Real PBKDF2 at 310k rounds is deliberately slow; the tests assert
// behaviour, not cost, so they run it at a fraction of the rounds.
const FAST = 1000
const USER = { id: "u1", email: "a@b.com", name: "A" }

describe("constant-time compare", () => {
    it("matches identical strings", () => expect(safeEqual("abc", "abc")).toBe(true))
    it("rejects different strings", () => expect(safeEqual("abc", "abd")).toBe(false))
    it("rejects different lengths", () => expect(safeEqual("ab", "abc")).toBe(false))
    it("rejects non-strings", () => expect(safeEqual(null, "abc")).toBe(false))
})

describe("derivation", () => {
    it("is stable for the same password and salt", async () => {
        const a = await deriveDigest("hunter2", "00112233445566778899aabbccddeeff", { crypto, iterations: FAST })
        const b = await deriveDigest("hunter2", "00112233445566778899aabbccddeeff", { crypto, iterations: FAST })
        expect(a).toBe(b)
    })
    it("differs when the salt differs, so two machines never share a digest", async () => {
        const a = await deriveDigest("hunter2", "00112233445566778899aabbccddeeff", { crypto, iterations: FAST })
        const b = await deriveDigest("hunter2", "ffeeddccbbaa99887766554433221100", { crypto, iterations: FAST })
        expect(a).not.toBe(b)
    })
})

describe("offline login", () => {
    let store
    beforeEach(() => { store = memoryStore() })

    const setup = (now = () => 1000) =>
        enrol({ email: "A@B.com", password: "hunter2", user: USER, store, crypto, now, iterations: FAST })

    it("lets an enrolled user in with the right password", async () => {
        await setup()
        const r = await offlineLogin({ email: "a@b.com", password: "hunter2", store, crypto, now: () => 2000 })
        expect(r.ok).toBe(true)
        expect(r.user).toEqual(USER)
        expect(r.offline).toBe(true)
    })

    it("marks the session as offline so the app knows what it has", async () => {
        await setup()
        const r = await offlineLogin({ email: "a@b.com", password: "hunter2", store, crypto, now: () => 2000 })
        expect(r.offline).toBe(true)
    })

    it("refuses the wrong password", async () => {
        await setup()
        const r = await offlineLogin({ email: "a@b.com", password: "wrong", store, crypto, now: () => 2000 })
        expect(r.ok).toBe(false)
        expect(r.reason).toBe(REFUSAL.BAD)
    })

    it("refuses a machine that has never been online", async () => {
        const r = await offlineLogin({ email: "a@b.com", password: "hunter2", store, crypto })
        expect(r.ok).toBe(false)
        expect(r.reason).toBe(REFUSAL.NONE)
    })

    it("refuses a different account than the one enrolled", async () => {
        await setup()
        const r = await offlineLogin({ email: "someone@else.com", password: "hunter2", store, crypto, now: () => 2000 })
        expect(r.ok).toBe(false)
        expect(r.reason).toBe(REFUSAL.OTHER_USER)
    })

    it("stops working once the grace period lapses", async () => {
        // This is what bounds revocation: a machine that never reaches the
        // server again cannot keep letting someone in forever.
        await setup()
        const r = await offlineLogin({
            email: "a@b.com", password: "hunter2", store, crypto,
            now: () => 1000 + OFFLINE_GRACE_MS + 1,
        })
        expect(r.ok).toBe(false)
        expect(r.reason).toBe(REFUSAL.EXPIRED)
    })

    it("still works on the last day of the grace period", async () => {
        await setup()
        const r = await offlineLogin({
            email: "a@b.com", password: "hunter2", store, crypto,
            now: () => 1000 + OFFLINE_GRACE_MS - 1,
        })
        expect(r.ok).toBe(true)
    })

    it("never writes the password down", async () => {
        await setup()
        const raw = JSON.stringify(await store.get("parallax.enrolment"))
        expect(raw).not.toContain("hunter2")
    })

    it("normalises the email, so case cannot lock someone out", async () => {
        await setup()
        const r = await offlineLogin({ email: "  A@B.COM ", password: "hunter2", store, crypto, now: () => 2000 })
        expect(r.ok).toBe(true)
    })

    it("forgets the enrolment on sign-out", async () => {
        await setup()
        await forgetEnrolment(store)
        const r = await offlineLogin({ email: "a@b.com", password: "hunter2", store, crypto })
        expect(r.ok).toBe(false)
        expect(r.reason).toBe(REFUSAL.NONE)
    })
})
