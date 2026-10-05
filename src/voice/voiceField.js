/**
 * voiceField.js — the three decisions the command field has to make.
 *
 * They live here as pure functions because each is a rule with edge cases
 * that matter, and because this repo's test environment is plain node with
 * no DOM testing library — a decision expressed as a function can be
 * tested exhaustively, the same decision buried in a React handler cannot.
 */

/** More than this many characters in one input event is a dictation. */
export const DICTATION_MIN = 3

/**
 * Is this input event a dictation, or someone typing?
 *
 * Wispr inserts a whole sentence at once. A person produces one character
 * per event. The threshold is on the GROWTH, not the length: pausing
 * mid-sentence and resuming must not re-fire, and a long value that grows
 * by one is still typing.
 */
export function isDictation(prevLength, nextLength, min = DICTATION_MIN) {
    return (nextLength - prevLength) > min
}

/**
 * May the field take focus right now?
 *
 * Only from nothing, from itself, or from the map. Never from another real
 * input — a command bar that grabs the caret while you are writing a note
 * is worse than no command bar.
 *
 * @param active   document.activeElement, or null
 * @param self     the field's own element
 */
export function mayTakeFocus(active, self) {
    if (!active) return true
    if (active === self) return true
    if (active.tagName === "BODY") return true
    const tag = String(active.tagName || "").toUpperCase()
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false
    if (active.isContentEditable) return false
    if (tag === "CANVAS") return true
    if (active.closest?.(".cesium-widget")) return true
    // A button or a link is a transient focus; taking it back is fine.
    return tag === "BUTTON" || tag === "A" || tag === "DIV" || tag === "SECTION"
}

/**
 * Should this keystroke be handed back to the app as a shortcut?
 *
 * Only a bare printable key, with no modifier, in an EMPTY field. Without
 * the empty check, dictating or typing a sentence would fire a shortcut on
 * every letter.
 */
export function isShortcutPassthrough(e, value) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (value !== "") return false
    return /^[a-zA-Z0-9]$/.test(e.key)
}
