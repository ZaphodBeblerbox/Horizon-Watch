import { describe, it, expect } from "vitest"
import { resolveTabAction, TAB_LABELS } from "./tabModel.js"

describe("resolveTabAction — record-scoped tabs (V3 Phase 1, §3.4)", () => {
    it("switching modules with no record ref reuses the module's existing base tab", () => {
        const tabs = [{ id: "t1", type: "situation", label: "Situation" }]
        const d = resolveTabAction(tabs, "situation", undefined, "new-id")
        expect(d).toEqual({ action: "switch", id: "t1" })
    })

    it("switching to a module with no base tab yet creates exactly one", () => {
        const d = resolveTabAction([], "dossiers", undefined, "new-id")
        expect(d.action).toBe("create")
        expect(d.tab).toEqual({ id: "new-id", type: "dossiers", label: "Dossiers" })
    })

    it("switching modules five times with no record opened never creates more than one tab per module", () => {
        let tabs = []
        for (let i = 0; i < 5; i++) {
            const d = resolveTabAction(tabs, "dossiers", undefined, `id-${i}`)
            if (d.action === "create") tabs = [...tabs, d.tab]
        }
        expect(tabs.filter(t => t.type === "dossiers").length).toBe(1)
    })

    it("opening a specific record creates exactly one new tab, distinct from the module's base tab", () => {
        const baseTabs = [{ id: "base", type: "dossiers", label: "Dossiers" }]
        const d = resolveTabAction(baseTabs, "dossiers", { recordRef: "ent:SZONE-011", label: "Dossier · Red Sea corridor" }, "rec-id")
        expect(d.action).toBe("create")
        expect(d.tab).toEqual({
            id: "rec-id", type: "dossiers", recordRef: "ent:SZONE-011",
            kind: "record", label: "Dossier · Red Sea corridor",
        })
    })

    it("re-opening the SAME record reuses its tab rather than duplicating", () => {
        const tabs = [
            { id: "base", type: "dossiers", label: "Dossiers" },
            { id: "rec-id", type: "dossiers", recordRef: "ent:SZONE-011", kind: "record", label: "Dossier · Red Sea corridor" },
        ]
        const d = resolveTabAction(tabs, "dossiers", { recordRef: "ent:SZONE-011", label: "Dossier · Red Sea corridor" }, "would-be-new-id")
        expect(d).toEqual({ action: "switch", id: "rec-id" })
    })

    it("re-opening the same record with an updated label retitles instead of duplicating", () => {
        const tabs = [{ id: "rec-id", type: "dossiers", recordRef: "ent:SZONE-011", kind: "record", label: "Dossier · Old Name" }]
        const d = resolveTabAction(tabs, "dossiers", { recordRef: "ent:SZONE-011", label: "Dossier · New Name" }, "new-id")
        expect(d).toEqual({ action: "retitle-and-switch", id: "rec-id", label: "Dossier · New Name" })
    })

    it("opening a DIFFERENT record of the same module creates a second, separate tab", () => {
        const tabs = [{ id: "rec-a", type: "dossiers", recordRef: "ent:SZONE-011", kind: "record", label: "Dossier · A" }]
        const d = resolveTabAction(tabs, "dossiers", { recordRef: "ent:SZONE-099", label: "Dossier · B" }, "rec-b")
        expect(d.action).toBe("create")
        expect(d.tab.recordRef).toBe("ent:SZONE-099")
    })

    it("a record tab and the module's base tab never collide with each other", () => {
        const tabs = [{ id: "rec-a", type: "dossiers", recordRef: "ent:SZONE-011", kind: "record", label: "Dossier · A" }]
        // Opening the module with no record must NOT match the record tab.
        const d = resolveTabAction(tabs, "dossiers", undefined, "base-id")
        expect(d.action).toBe("create")
        expect(d.tab).toEqual({ id: "base-id", type: "dossiers", label: "Dossiers" })
    })

    it("every real module type has a real display label", () => {
        for (const type of ["situation", "inbox", "dossiers", "analytics", "generate", "briefings", "replay", "ontology", "imagery"]) {
            expect(TAB_LABELS[type]).toBeTruthy()
        }
    })
})
