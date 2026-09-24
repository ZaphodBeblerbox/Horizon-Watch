/**
 * outbox.js — writes that survive being offline.
 *
 * A local-first app never blocks the UI on the network. An action the
 * user takes is recorded locally and succeeds immediately; sending it is
 * a separate, retryable job. The queue is VISIBLE, because a write that
 * silently waits is indistinguishable to the user from one that silently
 * failed.
 *
 * WHAT GOES IN HERE AND WHAT DOES NOT. Only operations that are safe to
 * retry. Every entry carries a client-generated id which the server uses
 * to deduplicate, so a reply lost on the way back cannot become a second
 * note or a second report.
 *
 * WHAT IS DELIBERATELY NOT SOLVED HERE. Merging two offline edits of the
 * same document. That is a CRDT's job and belongs with the editor; this
 * queue moves whole operations and flags a conflict rather than guessing.
 */

export const OUTBOX_KEY = "parallax.outbox.v1"

/** Give up after this many attempts and surface it to the user. */
export const MAX_ATTEMPTS = 6

/** Exponential, so a server that is down is not hammered. */
export function backoffMs(attempt) {
    const n = Math.max(0, Number(attempt) || 0)
    return Math.min(5 * 60_000, 1000 * 2 ** n)
}

function read(storage) {
    try {
        const raw = storage?.getItem(OUTBOX_KEY)
        const v = raw ? JSON.parse(raw) : []
        return Array.isArray(v) ? v : []
    } catch {
        return []
    }
}

function write(storage, items) {
    try { storage?.setItem(OUTBOX_KEY, JSON.stringify(items)) } catch { /* full or private */ }
}

/** A stable id the server can deduplicate on. */
export function newOpId() {
    const r = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return `op_${r}`
}

/** Queue an operation. Returns the stored entry. */
export function enqueue(storage, { method = "POST", url, body = null, label = "" }) {
    if (!url) throw new Error("an outbox entry needs a url")
    const entry = {
        id: newOpId(), method, url, body, label,
        queuedAt: new Date().toISOString(),
        attempts: 0, lastError: null, state: "pending",
    }
    const items = read(storage)
    items.push(entry)
    write(storage, items)
    return entry
}

export function list(storage) {
    return read(storage)
}

export function pending(storage) {
    return read(storage).filter((e) => e.state === "pending")
}

export function failed(storage) {
    return read(storage).filter((e) => e.state === "failed")
}

export function remove(storage, id) {
    write(storage, read(storage).filter((e) => e.id !== id))
}

/** Record an attempt's outcome without losing the rest of the queue. */
export function markAttempt(storage, id, { ok, error = null, now = Date.now() }) {
    const items = read(storage)
    const e = items.find((x) => x.id === id)
    if (!e) return null
    if (ok) {
        write(storage, items.filter((x) => x.id !== id))
        return { ...e, state: "sent" }
    }
    e.attempts += 1
    e.lastError = error ? String(error).slice(0, 300) : "failed"
    e.nextAttemptAt = now + backoffMs(e.attempts)
    // Given up on, NOT deleted. A write the user made must not vanish
    // because the network stayed down; it becomes something they can see
    // and retry.
    e.state = e.attempts >= MAX_ATTEMPTS ? "failed" : "pending"
    write(storage, items)
    return e
}

/** Entries due for another try. */
export function due(storage, now = Date.now()) {
    return read(storage).filter(
        (e) => e.state === "pending" && (!e.nextAttemptAt || e.nextAttemptAt <= now))
}

/**
 * Send what is due, oldest first.
 *
 * Sequential on purpose: these are user operations and their order is
 * often meaningful — a note then its edit, a report then its share.
 */
export async function flush(storage, fetchImpl = fetch, now = Date.now()) {
    const items = due(storage, now)
    let sent = 0, stillFailing = 0
    for (const e of items) {
        try {
            const res = await fetchImpl(e.url, {
                method: e.method,
                credentials: "include",
                headers: { "Content-Type": "application/json",
                           "X-Operation-Id": e.id },
                body: e.body == null ? undefined : JSON.stringify(e.body),
            })
            if (res.ok) { markAttempt(storage, e.id, { ok: true }); sent += 1 }
            else {
                markAttempt(storage, e.id, { ok: false, error: `HTTP ${res.status}`, now })
                stillFailing += 1
            }
        } catch (err) {
            markAttempt(storage, e.id, { ok: false, error: err?.message, now })
            stillFailing += 1
        }
    }
    return { sent, stillFailing, remaining: pending(storage).length }
}
