import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const APP = readFileSync(fileURLToPath(new URL("../app.jsx", import.meta.url)), "utf8")
const STORE = readFileSync(fileURLToPath(new URL("./authStore.js", import.meta.url)), "utf8")

describe("the app can be opened with no server", () => {
    // The desktop build reported "cannot connect to server" and stopped
    // there. All the offline machinery existed — enrolment, PBKDF2 digest,
    // local session — and none of it was reachable, because a transient
    // failure of GET /api/auth/me rendered a dead-end screen with a Retry
    // button and the login form never mounted. The capability had no door.

    it("a transient failure does not by itself block the login screen", () => {
        // The old gate was `if (!authUser && authTransientError) return <dead end>`.
        // It must now also require that offline login is unavailable.
        const gate = /if \(!authUser && authTransientError && !offlineLoginAvailable\)/
        expect(APP).toMatch(gate)
    })

    it("the login screen is told it is running offline", () => {
        expect(APP).toMatch(/<LoginScreen[^>]*offline=\{authTransientError\}/)
    })

    it("the boot asks whether this machine can sign in offline", () => {
        expect(APP).toMatch(/canLoginOffline\(\)/)
    })

    it("authStore answers that question from the stored enrolment", () => {
        expect(STORE).toMatch(/export async function canLoginOffline/)
        expect(STORE).toMatch(/enrolmentFor/)
    })

    it("it uses the same expiry rule the offline login enforces", () => {
        // Offering a door that is going to refuse is worse than not
        // offering one: the two must read the same field.
        const fn = STORE.slice(STORE.indexOf("export async function canLoginOffline"))
        expect(fn).toMatch(/lastServerLoginAt \|\| rec\.enrolledAt/)
        expect(fn).toMatch(/OFFLINE_GRACE_MS/)
    })

    it("a machine that never reached the server still gets an honest dead end", () => {
        // There is genuinely nothing to sign in against, and saying so
        // beats a login form that cannot succeed.
        expect(APP).toMatch(/has not signed in before/)
    })
})
