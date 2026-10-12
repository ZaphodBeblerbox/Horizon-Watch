/**
 * takeover.js — what the WARNING takeover shows and when it sounds. Pure,
 * so the rules can be tested without a screen, a speaker or a phone.
 *
 * THE OWNER, 2026-10-12: a warning "must go above everything else:
 * different noise, different vibration, so it gets noticed". So:
 *   · any unacknowledged warning takes the whole screen and sounds the
 *     alarm, repeating, until "Acknowledge";
 *   · Do Not Disturb, muted sounds and the notification rules DO NOT APPLY:
 *     alarming() takes the settings and deliberately ignores them;
 *   · a warning acknowledged here, acknowledged on another device or
 *     withdrawn by its sender leaves the screen; the alarm stops when none is
 *     left.
 *
 * state: { active: [warning], done: [id] } — `done` holds what this device
 * acknowledged, so a poll answered before the server heard the
 * acknowledgement cannot bring it back.
 */

export const initialTakeover = () => ({ active: [], done: [] })

const over = (w) => !w || w.status === "acknowledged" || w.status === "cancelled" || !!w.acked_at || !!w.cancelled_at

export function reduceTakeover(state, ev) {
    switch (ev?.type) {
        case "inbox": {
            // the server's whole list: anything missing was acknowledged elsewhere or withdrawn
            const list = (ev.warnings || []).filter((w) => w?.id && !over(w) && !state.done.includes(w.id))
            const same = list.length === state.active.length && list.every((w, i) => w.id === state.active[i].id)
            return same ? state : { ...state, active: list }
        }
        case "arrive": {
            const w = ev.warning
            if (!w?.id) return state
            if (over(w)) return state.active.some((x) => x.id === w.id) ? { ...state, active: state.active.filter((x) => x.id !== w.id) } : state
            if (state.done.includes(w.id)) return state
            const i = state.active.findIndex((x) => x.id === w.id)
            if (i >= 0) return { ...state, active: state.active.map((x, j) => (j === i ? { ...x, ...w } : x)) }
            return { ...state, active: [...state.active, w] }
        }
        case "ack":
            return { active: state.active.filter((x) => x.id !== ev.id), done: [...state.done.filter((d) => d !== ev.id), ev.id].slice(-200) }
        case "ack_failed":
            // the server did not hear it: it comes back with the next poll
            return { ...state, done: state.done.filter((d) => d !== ev.id) }
        default:
            return state
    }
}

/** Sound and take the screen? Settings are passed and IGNORED on purpose:
 *  a warning overrides Do Not Disturb and muted sounds. */
// eslint-disable-next-line no-unused-vars
export function alarming(state, settings) {
    return state.active.length > 0
}

/** What changed between two states: start or stop the alarm, and which
 *  warnings are new (each buzzes, goes in the tray, and on the desktop with
 *  the window away, becomes a macOS notification). */
export function takeoverEffects(prev, next, settings) {
    const was = alarming(prev, settings), is = alarming(next, settings)
    const seen = new Set(prev.active.map((w) => w.id))
    return { start: !was && is, stop: was && !is, fresh: next.active.filter((w) => !seen.has(w.id)) }
}

/** What the device can and cannot do, said plainly on the takeover. */
export function deviceNote({ ua = "", canVibrate = false, desktop = false } = {}) {
    if (desktop) return ""
    if (/iPhone|iPad|iPod/.test(ua)) {
        return "On an iPhone the silent switch and Focus can mute this alarm, and a web app cannot make an iPhone vibrate. Keep Parallax open, or allow its notifications in Focus."
    }
    return canVibrate ? "" : "This device cannot vibrate for a web app."
}
