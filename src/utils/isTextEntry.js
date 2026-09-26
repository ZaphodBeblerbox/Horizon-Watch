/**
 * isTextEntry.js — "is the person typing right now?"
 *
 * Every keyboard shortcut in the app has to ask this, and each place that
 * asked it separately got it slightly wrong:
 *
 *   - "input,textarea,[contenteditable]" matches the editable HOST but not
 *     anything inside it. Type a digit inside a <b> in the document and the
 *     target is the <b>, which matches nothing, and the shortcut fires.
 *   - Checking activeElement.tagName only catches INPUT and TEXTAREA, so a
 *     bare letter opened a menu while writing a briefing.
 *
 * So it is one function, and it checks the element, its ancestors, and the
 * focused element — because a keydown can be delivered to any of them.
 */

const SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']"

export function isTextEntry(target) {
    const el = target && target.nodeType === 1 ? target : null
    if (el) {
        if (el.matches?.(SELECTOR)) return true
        if (el.isContentEditable) return true
        if (el.closest?.(SELECTOR)) return true
    }
    // A keydown during composition, or on a body that has focus delegated
    // into an editor, still means the person is typing.
    const active = typeof document !== "undefined" ? document.activeElement : null
    if (active && active !== el) {
        if (active.matches?.(SELECTOR)) return true
        if (active.isContentEditable) return true
        if (active.closest?.(SELECTOR)) return true
    }
    return false
}

export default isTextEntry
