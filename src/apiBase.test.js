/**
 * The desktop build must never point at localhost.
 *
 * A Tauri webview on macOS serves the page from tauri://localhost, so a
 * hostname-based rule sends the packaged app to http://localhost:8000 —
 * a backend that exists on no user's machine. That is exactly how the
 * DMG shipped unable to reach any server at all.
 */
import { describe, it, expect } from "vitest"
import { isDesktop } from "./apiBase.js"

const win = (over) => ({ location: { protocol: "https:", hostname: "example.com" }, ...over })

describe("desktop detection", () => {
    it("recognises a Tauri v2 webview by its injected globals", () => {
        expect(isDesktop(win({ __TAURI_INTERNALS__: {} }))).toBe(true)
    })

    it("recognises a Tauri v1 webview", () => {
        expect(isDesktop(win({ __TAURI__: {} }))).toBe(true)
    })

    it("recognises the macOS custom protocol, where hostname is a lie", () => {
        // This is the exact shape that broke the DMG: hostname reads
        // "localhost" but there is no local backend.
        expect(isDesktop(win({ location: { protocol: "tauri:", hostname: "localhost" } }))).toBe(true)
    })

    it("recognises the Windows tauri.localhost host", () => {
        expect(isDesktop(win({ location: { protocol: "http:", hostname: "tauri.localhost" } }))).toBe(true)
    })

    it("does not mistake a real browser on localhost for the desktop app", () => {
        // A developer running vite must still reach their own backend.
        expect(isDesktop(win({ location: { protocol: "http:", hostname: "localhost" } }))).toBe(false)
    })

    it("does not mistake the deployed web app for the desktop app", () => {
        expect(isDesktop(win())).toBe(false)
    })

    it("survives having no window at all", () => {
        expect(isDesktop(undefined)).toBe(false)
    })
})
