import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
    KIND, interrupts, pushNotification, getNotifications,
    setMuted, __resetNotifications,
} from "./notificationStore.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { __resetNotifications(); setMuted(false); __resetNotifications() })

const n = (kind, sev = "moderate") => ({ id: `${kind}-${Math.random()}`, kind, sev, title: "t" })

describe("§A2 — the kinds", () => {
    it("carries the addendum's three new kinds with its icons", () => {
        expect(KIND.confirm).toEqual({ icon: "i-confirm", name: "Confirmed" })
        expect(KIND.surge).toEqual({ icon: "i-surge", name: "Surge" })
        expect(KIND.fusion).toEqual({ icon: "i-fusion", name: "Fusion point" })
    })

    it("every kind's icon exists in the sprite", () => {
        const sprite = readFileSync(path.join(__dirname, "../ui/IconSprite.jsx"), "utf8")
        for (const [kind, { icon }] of Object.entries(KIND)) {
            expect(sprite.includes(`id="${icon}"`), `${kind} -> #${icon} missing from the sprite`).toBe(true)
        }
    })
})

describe("§A13 — a single confirmation never raises a card", () => {
    it("an arrival lands in the tray, not on screen", () => {
        const raised = pushNotification(n("confirm", "low"))
        expect(raised).toBe(false)
        const { items, cards } = getNotifications()
        expect(items).toHaveLength(1)   // the tray is the record
        expect(cards).toHaveLength(0)   // nothing interrupted
    })

    it("stays quiet even at a high severity, because arrival is not a finding", () => {
        expect(interrupts({ kind: "confirm", sev: "high" })).toBe(false)
    })
})

describe("§A2 — surge and fusion DO interrupt", () => {
    it("a surge raises a card", () => {
        expect(pushNotification(n("surge", "moderate"))).toBe(true)
    })

    it("a fusion point raises a card", () => {
        expect(pushNotification(n("fusion", "high"))).toBe(true)
    })

    it("both are statements that something changed — unlike signal/detector/feed", () => {
        for (const k of ["surge", "fusion"]) expect(interrupts({ kind: k, sev: "low" })).toBe(true)
        for (const k of ["signal", "detector", "feed", "system", "confirm"]) {
            expect(interrupts({ kind: k, sev: "low" }), `${k} must not interrupt`).toBe(false)
        }
    })

    it("the original four still interrupt", () => {
        for (const k of ["escalate", "assign", "rfi"]) expect(interrupts({ kind: k, sev: "low" })).toBe(true)
        expect(interrupts({ kind: "signal", sev: "critical" })).toBe(true)
    })
})

describe("muting", () => {
    it("silences cards but keeps the tray filling", () => {
        setMuted(true)
        expect(pushNotification(n("fusion", "critical"))).toBe(false)
        const { items, cards } = getNotifications()
        expect(items).toHaveLength(1)
        expect(cards).toHaveLength(0)
    })
})

// ── the backlog is a record, not an interruption ──────────────────────────
//
// The tray was empty on arrival and the whole notification surface read as
// broken. The cause was not a missing feed: the first load recorded the
// existing backlog in a Set and nowhere else, so nothing reached the tray
// until something NEW happened — and most of what this system detects
// carries a stable id (a surge, a fusion point, a town that changed hands a
// fortnight ago), so "something new" could be hours away.

describe("silent pushes", () => {
    beforeEach(() => __resetNotifications())

    it("records a silent item in the tray", () => {
        pushNotification({ id: "a", kind: "surge", sev: "critical",
                           title: "Backlog", silent: true })
        expect(getNotifications().items.map((i) => i.id)).toEqual(["a"])
    })

    it("raises no card for it, however severe", () => {
        // A critical surge is the most interrupting thing there is, and it
        // still must not card when it was already there before you looked.
        const raised = pushNotification({ id: "a", kind: "surge",
                                          sev: "critical", title: "Backlog",
                                          silent: true })
        expect(raised).toBe(false)
        expect(getNotifications().cards).toEqual([])
    })

    it("still cards what arrives while you are watching", () => {
        pushNotification({ id: "old", kind: "surge", sev: "critical",
                           title: "Backlog", silent: true })
        const raised = pushNotification({ id: "new", kind: "surge",
                                          sev: "critical", title: "Live" })
        expect(raised).toBe(true)
        expect(getNotifications().cards.map((c) => c.id)).toEqual(["new"])
        // Both are in the record.
        expect(getNotifications().items).toHaveLength(2)
    })

    it("a town changing hands is a change, so it interrupts", () => {
        // Filed as `confirm` it was recorded silently forever: the store
        // cards a change and never cards an arrival, and Mokha Port
        // falling is not an arrival.
        expect(interrupts({ kind: "escalate", sev: "high" })).toBe(true)
        expect(interrupts({ kind: "confirm", sev: "high" })).toBe(false)
    })
})
