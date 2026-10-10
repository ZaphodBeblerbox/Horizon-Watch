import { describe, it, expect } from "vitest"
import { nativeContent } from "./nativeNotify.js"

describe("desktop notifications", () => {
    it("show the app's name and the headline only", () => {
        expect(nativeContent({ title: "Drone strike on a depot in Sanaa", sub: "reason · region", advice: "stay away" }))
            .toEqual({ title: "Parallax", body: "Drone strike on a depot in Sanaa" })
    })
})
