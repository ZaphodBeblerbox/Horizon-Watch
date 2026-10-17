/**
 * chatTyping.js — the "I am typing" pings, throttled. Shared by the phone
 * thread (mobile/screens/MMessages.jsx) and the desktop chat (chat/Chat.jsx).
 *
 * The owner, 2026-10-17: "On X, if people type in the DMs, it should show a
 * typing indicator." AT MOST ONE PING EVERY `every` MS while the box changes:
 * a keystroke-per-request indicator is a request per letter for a fact that
 * lasts seconds. The server holds each ping for a few seconds (TYPING_TTL_S
 * in routers/chat.py), longer than `every`, so steady typing never flickers
 * off between pings. Clearing the box or sending says "stopped" once, so the
 * other side's dots go at once instead of timing out.
 */

export function createTypingPinger(send, { every = 3000, now = () => Date.now() } = {}) {
    let last = -Infinity
    let on = false
    return {
        /** The box changed; `text` is what is in it now. */
        changed(text) {
            if (!String(text || "").trim()) { this.stop(); return }
            const t = now()
            if (t - last < every) return
            last = t
            on = true
            Promise.resolve().then(() => send(true)).catch(() => {})
        },
        /** Sent, cleared, or left the thread. */
        stop() {
            if (!on) return
            on = false
            last = -Infinity
            Promise.resolve().then(() => send(false)).catch(() => {})
        },
    }
}

/** "Ana is typing", "Ana and Ben are typing", "3 people are typing". */
export function typingLabel(typing) {
    const names = (typing || []).map((p) => String(p?.name || "Someone").split(/\s+/)[0])
    if (!names.length) return ""
    if (names.length === 1) return `${names[0]} is typing`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
    return `${names.length} people are typing`
}
