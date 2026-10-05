/**
 * The explorer's maths: paths, cycle-safe moves, unique names, sorting and
 * the bytes/date formatting the details columns print.
 */
import { describe, it, expect } from "vitest"
import {
    fmtBytes, fmtDate, typeLabel, uniqueName, pathOf, isDescendant, descendants, SORTERS,
} from "./FileExplorer.jsx"

const F = (id, name, parent_id = null, extra = {}) =>
    ({ id, name, parent_id, kind: "folder", ...extra })
const FILE = (id, name, parent_id, extra = {}) =>
    ({ id, name, parent_id, kind: "file", mime: "image/png", size_bytes: 2048, ...extra })

const tree = [
    F("a", "Red Sea watch"),
    F("b", "Signals", "a"),
    F("c", "Vessels", "b"),
    FILE("f1", "scan.png", "c"),
    F("z", "Decks"),
]

describe("pathOf", () => {
    it("walks root-first to the node", () => {
        expect(pathOf(tree, "c").map((n) => n.name)).toEqual(["Red Sea watch", "Signals", "Vessels"])
    })
    it("survives a parent that points at itself", () => {
        const loop = [{ id: "x", name: "x", parent_id: "x", kind: "folder" }]
        expect(pathOf(loop, "x").map((n) => n.id)).toEqual(["x"])
    })
})

describe("isDescendant", () => {
    it("knows a grandchild from a sibling", () => {
        expect(isDescendant(tree, "c", "a")).toBe(true)
        expect(isDescendant(tree, "z", "a")).toBe(false)
    })
    // A folder dropped into its own subtree would orphan everything below it.
    it("refuses the move that would detach a subtree", () => {
        expect(isDescendant(tree, "c", "b")).toBe(true)
    })
})

describe("descendants", () => {
    it("is the whole subtree, not just the children", () => {
        expect(descendants(tree, "a").map((n) => n.id).sort()).toEqual(["b", "c", "f1"])
    })
})

describe("uniqueName", () => {
    it("leaves a free name alone", () => {
        expect(uniqueName(tree, null, "New folder")).toBe("New folder")
    })
    it("numbers a collision, ignoring case", () => {
        expect(uniqueName(tree, null, "decks")).toBe("decks (2)")
    })
    it("keeps counting past the first collision", () => {
        const t = [F("1", "New folder"), F("2", "New folder (2)")]
        expect(uniqueName(t, null, "New folder")).toBe("New folder (3)")
    })
})

describe("fmtBytes", () => {
    it("steps through the units", () => {
        expect(fmtBytes(512)).toBe("512 B")
        expect(fmtBytes(2048)).toBe("2 KB")
        expect(fmtBytes(5 * 1048576)).toBe("5.0 MB")
    })
    it("prints nothing for a folder's absent size", () => {
        expect(fmtBytes(null)).toBe("")
    })
})

describe("fmtDate", () => {
    // The backend sends naive UTC. Read as local, a file saved at 15:00 UTC
    // is stamped 15:00 in Berlin — two hours early.
    it("reads a bare timestamp as UTC", () => {
        const bare = fmtDate("2026-10-04T15:00:00")
        const zed = fmtDate("2026-10-04T15:00:00Z")
        expect(bare).toBe(zed)
        expect(bare).not.toBe("")
    })
    it("leaves an explicit offset alone", () => {
        expect(fmtDate("2026-10-04T15:00:00+02:00")).toBe(fmtDate("2026-10-04T13:00:00Z"))
    })
    it("is empty rather than Invalid Date", () => {
        expect(fmtDate(null)).toBe("")
        expect(fmtDate("not a date")).toBe("")
    })
})

describe("typeLabel", () => {
    it("names each kind the way the column should read", () => {
        expect(typeLabel(F("a", "x"))).toBe("File folder")
        expect(typeLabel({ kind: "doc", name: "Brief" })).toBe("Document")
        expect(typeLabel({ kind: "file", name: "a.png", mime: "image/png" })).toBe("PNG image")
        expect(typeLabel({ kind: "file", name: "a.pdf", mime: "application/pdf" })).toBe("PDF document")
        expect(typeLabel({ kind: "file", name: "track.geojson", mime: "" })).toBe("GEOJSON file")
    })
    it("does not claim an extension a name has not got", () => {
        expect(typeLabel({ kind: "file", name: "README", mime: "" })).toBe("File")
    })
})

describe("sorting", () => {
    it("orders names the way a person reads them", () => {
        const names = ["scan10.png", "scan2.png", "Alpha"].map((n, i) => FILE(String(i), n, null))
        expect([...names].sort(SORTERS.name).map((n) => n.name)).toEqual(["Alpha", "scan2.png", "scan10.png"])
    })
    it("sorts by size numerically, not as text", () => {
        const a = FILE("a", "a", null, { size_bytes: 9 })
        const b = FILE("b", "b", null, { size_bytes: 100 })
        expect([b, a].sort(SORTERS.size)[0].id).toBe("a")
    })
    it("puts a missing date last-stable rather than throwing", () => {
        const a = { id: "a", name: "a", kind: "file", updated_at: null }
        const b = { id: "b", name: "b", kind: "file", updated_at: "2026-01-01T00:00:00" }
        expect([a, b].sort(SORTERS.updated_at)[0].id).toBe("a")
    })
})
