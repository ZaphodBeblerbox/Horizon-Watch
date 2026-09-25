/**
 * offlineAuth.js — logging in when there is no server to ask.
 *
 * The desktop app must open and be usable on a plane, on a ship, or while
 * Railway is restarting. A login screen that can only ever say "network
 * error" makes every other offline capability unreachable, because the
 * user never gets past it.
 *
 * HOW IT WORKS. The server stays the only authority. On a successful
 * ONLINE login this records, locally, an enrolment: the user's identity
 * as the server returned it, a random salt, and PBKDF2-SHA256 over the
 * password. When the server cannot be reached, the entered password is
 * put through the same derivation and compared against that digest. A
 * match re-opens the last known session locally.
 *
 * WHAT THIS DELIBERATELY GIVES UP, AND HOW IT IS BOUNDED. An offline
 * login cannot see a password change, a disabled account or a revoked
 * role — the machine holding the enrolment is the only participant. So:
 *
 * - The enrolment expires. After OFFLINE_GRACE_MS without a successful
 *   server login, offline login stops working and the user must reach the
 *   server again. Revocation is therefore late, not absent.
 * - Every offline session is marked offline. The app knows it is running
 *   on a local grant, so it can refuse anything that must be authorised
 *   server-side rather than quietly appearing to succeed.
 * - The password is never stored, only a derived digest, and the
 *   comparison is constant-time so a local attacker cannot learn the
 *   digest a byte at a time.
 *
 * This is a deliberate trade: strictly weaker than an online check, and
 * strictly better than an app that cannot be opened at all.
 */

/** How long an enrolment stays usable without reaching the server. */
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000   // 14 days
/** PBKDF2 rounds. High enough to be costly to grind, fast enough to log in. */
export const PBKDF2_ITERATIONS = 310000
const KEY = "parallax.enrolment"

const enc = (s) => new TextEncoder().encode(s)

function toHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Constant-time compare. Length is allowed to leak; content is not. */
export function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export async function deriveDigest(password, saltHex, { crypto, iterations = PBKDF2_ITERATIONS } = {}) {
    const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
    const key = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"])
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)
    return toHex(bits)
}

function randomSaltHex(crypto) {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    return toHex(b.buffer)
}

/**
 * Record that this user authenticated against the real server.
 * Call ONLY after a 2xx from /api/auth/login.
 */
export async function enrol({ email, password, user, store, crypto, now = () => Date.now(),
                              iterations = PBKDF2_ITERATIONS }) {
    const saltHex = randomSaltHex(crypto)
    const digest = await deriveDigest(password, saltHex, { crypto, iterations })
    const record = {
        email: String(email || "").trim().toLowerCase(),
        salt: saltHex, digest, iterations,
        user: user || null,
        enrolledAt: now(),
        lastServerLoginAt: now(),
    }
    await store.set(KEY, record)
    return record
}

/** Why an offline login was refused, in words a person can act on. */
export const REFUSAL = {
    NONE: "This machine has never signed in to Parallax. "
        + "Connect once so it can remember you.",
    OTHER_USER: "This machine last signed in as a different account. "
        + "Connect to switch users.",
    EXPIRED: "It has been too long since this machine reached the server. "
        + "Connect once to sign in again.",
    BAD: "That password does not match the one this machine remembers.",
}

/**
 * Try to authenticate without a server.
 * Returns { ok: true, user, offline: true } or { ok: false, reason }.
 */
export async function offlineLogin({ email, password, store, crypto,
                                     now = () => Date.now(),
                                     graceMs = OFFLINE_GRACE_MS }) {
    let rec = null
    try { rec = await store.get(KEY) } catch { rec = null }
    if (!rec || !rec.digest) return { ok: false, reason: REFUSAL.NONE }

    if (String(email || "").trim().toLowerCase() !== rec.email) {
        return { ok: false, reason: REFUSAL.OTHER_USER }
    }
    if ((now() - (rec.lastServerLoginAt || rec.enrolledAt || 0)) > graceMs) {
        return { ok: false, reason: REFUSAL.EXPIRED }
    }
    const digest = await deriveDigest(password, rec.salt,
        { crypto, iterations: rec.iterations || PBKDF2_ITERATIONS })
    if (!safeEqual(digest, rec.digest)) return { ok: false, reason: REFUSAL.BAD }

    return { ok: true, user: rec.user, offline: true }
}

/** Forget this machine's enrolment — used on explicit sign-out. */
export async function forgetEnrolment(store) {
    try { await store.del(KEY) } catch { /* nothing to forget */ }
}

export async function enrolmentFor(store) {
    try { return (await store.get(KEY)) || null } catch { return null }
}
