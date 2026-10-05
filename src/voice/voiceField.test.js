import { describe, it, expect } from "vitest"
import { isDictation, mayTakeFocus, isShortcutPassthrough } from "./voiceField.js"

const el = (tagName, extra = {}) => ({
    tagName, isContentEditable: false, closest: () => null, ...extra,
})

describe("telling a dictation from typing", () => {
    it("a whole sentence arriving at once is a dictation", () => {
        expect(isDictation(0, "add this to the briefing".length)).toBe(true)
    })
    it("one character at a time is typing, at any length", () => {
        expect(isDictation(0, 1)).toBe(false)
        expect(isDictation(40, 41)).toBe(false)
    })
    it("the threshold is on growth, not on total length", () => {
        // Resuming a long sentence must not re-fire the parser.
        expect(isDictation(120, 122)).toBe(false)
        expect(isDictation(120, 160)).toBe(true)
    })
    it("deleting is never a dictation", () => {
        expect(isDictation(50, 0)).toBe(false)
    })
})

describe("it never steals focus from a real input", () => {
    const self = el("INPUT")
    it("takes focus from nothing, from itself and from the map", () => {
        expect(mayTakeFocus(null, self)).toBe(true)
        expect(mayTakeFocus(self, self)).toBe(true)
        expect(mayTakeFocus(el("BODY"), self)).toBe(true)
        expect(mayTakeFocus(el("CANVAS"), self)).toBe(true)
    })
    it("leaves another input, textarea, select or editor alone", () => {
        expect(mayTakeFocus(el("INPUT"), self)).toBe(false)
        expect(mayTakeFocus(el("TEXTAREA"), self)).toBe(false)
        expect(mayTakeFocus(el("SELECT"), self)).toBe(false)
        expect(mayTakeFocus(el("DIV", { isContentEditable: true }), self)).toBe(false)
    })
    it("a cesium child counts as the map", () => {
        expect(mayTakeFocus(el("DIV", { closest: (s) => (s === ".cesium-widget" ? {} : null) }), self)).toBe(true)
    })
})

describe("single keystrokes stay shortcuts", () => {
    const k = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods })
    it("a bare letter in an empty field is a shortcut", () => {
        expect(isShortcutPassthrough(k("t"), "")).toBe(true)
        expect(isShortcutPassthrough(k("G"), "")).toBe(true)
    })
    it("not once there is text — otherwise typing fires shortcuts", () => {
        expect(isShortcutPassthrough(k("t"), "add this")).toBe(false)
    })
    it("not with a modifier, and not for a non-printable key", () => {
        expect(isShortcutPassthrough(k("t", { metaKey: true }), "")).toBe(false)
        expect(isShortcutPassthrough(k("Enter"), "")).toBe(false)
        expect(isShortcutPassthrough(k("Escape"), "")).toBe(false)
    })
})
