import { describe, it, expect } from "vitest"
import { nativeContent } from "./nativeNotify.js"

describe("desktop notifications", () => {
    it("title the kind of notification, the headline and its context below (macOS names the app)", () => {
        expect(nativeContent({ kind: "telegram", title: "Drone strike on a depot in Sanaa", sub: "Sanaa, Yemen", advice: "stay away" }))
            .toMatchObject({ title: "Telegram report", body: "Drone strike on a depot in Sanaa — Sanaa, Yemen" })
        expect(nativeContent({ kind: "signal", sev: "critical", title: "Missile strike on Kharkiv" }))
            .toMatchObject({ title: "Critical alert", body: "Missile strike on Kharkiv" })
    })
})
