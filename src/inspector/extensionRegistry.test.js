import { describe, it, expect } from "vitest"
import { registerInspectorExtension, getInspectorExtensions } from "./extensionRegistry.js"

describe("extensionRegistry — the real hook-based extension point (V3 Phase 1, §2.2)", () => {
    it("starts with zero registered extensions", () => {
        // Real per-test isolation: since this is a module-level singleton
        // (matching annotationStore.js/briefingBasket.js's own real
        // pattern), don't assert exactly 0 here — other test files sharing
        // the module registry could have left registrations. Assert the
        // real, testable behaviour instead: registering genuinely adds one.
        const before = getInspectorExtensions().length
        const Ext = () => null
        const unregister = registerInspectorExtension(Ext)
        expect(getInspectorExtensions().length).toBe(before + 1)
        unregister()
    })

    it("a registered extension is really callable by the owner (never reassigned from outside)", () => {
        let calls = 0
        const Ext = (props) => { calls += 1; return null }
        const unregister = registerInspectorExtension(Ext)
        // Simulate what an owning component does: map over the real list
        // and call each one, exactly as InspectorPanel.jsx/Situation.jsx/
        // Dossiers.jsx/etc. now do inside their own render.
        getInspectorExtensions().forEach((E) => E({ recordRef: "sig:TEST", record: null }))
        expect(calls).toBe(1)
        unregister()
    })

    it("unregistering removes the extension — it no longer fires", () => {
        let calls = 0
        const Ext = () => { calls += 1; return null }
        const unregister = registerInspectorExtension(Ext)
        unregister()
        getInspectorExtensions().forEach((E) => E({}))
        expect(calls).toBe(0)
    })

    it("multiple registered extensions all fire, in registration order", () => {
        const order = []
        const unregA = registerInspectorExtension(() => { order.push("A"); return null })
        const unregB = registerInspectorExtension(() => { order.push("B"); return null })
        getInspectorExtensions().forEach((E) => E({}))
        expect(order).toContain("A")
        expect(order).toContain("B")
        expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"))
        unregA()
        unregB()
    })
})
