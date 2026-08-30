import { describe, it, expect } from "vitest"
import { buttonStyle, panelStyle, emptyStateStyle } from "./styleHelpers.js"

describe("buttonStyle", () => {
    it("renders the primary variant as a solid accent CTA", () => {
        const s = buttonStyle({ variant: "primary" })
        expect(s.background).toBe("var(--accent)")
        expect(s.color).toBe("var(--bg-primary)")
        expect(s.border).toBe("1px solid var(--accent)")
        expect(s.cursor).toBe("pointer")
        expect(s.opacity).toBe(1)
    })

    it("renders the ghost variant transparent with a subtle border", () => {
        const s = buttonStyle({ variant: "ghost" })
        expect(s.background).toBe("transparent")
        expect(s.color).toBe("var(--text-secondary)")
        expect(s.border).toBe("1px solid var(--border-subtle)")
    })

    it("renders an active ghost button in the accent-tinted tab/mode-toggle look", () => {
        const s = buttonStyle({ variant: "ghost", active: true })
        expect(s.background).toBe("var(--accent-faint)")
        expect(s.color).toBe("var(--accent)")
        expect(s.border).toBe("1px solid var(--accent-border)")
    })

    it("renders the danger variant in the critical severity color", () => {
        const s = buttonStyle({ variant: "danger" })
        expect(s.color).toBe("var(--sev-critical)")
        expect(s.border).toBe("1px solid var(--sev-critical)")
    })

    it("dims and disables pointer affordance when disabled", () => {
        const s = buttonStyle({ variant: "primary", disabled: true })
        expect(s.opacity).toBe(0.5)
        expect(s.cursor).toBe("not-allowed")
    })

    it("never emits a boxShadow (hard-edge convention, not soft elevation)", () => {
        for (const variant of ["primary", "ghost", "danger"]) {
            const s = buttonStyle({ variant })
            expect(s.boxShadow).toBeUndefined()
        }
    })

    it("switches padding/font-size between sm and md sizes", () => {
        const sm = buttonStyle({ size: "sm" })
        const md = buttonStyle({ size: "md" })
        expect(sm.fontSize).toBe("var(--text-xs)")
        expect(md.fontSize).toBe("var(--text-sm)")
        expect(sm.padding).not.toBe(md.padding)
    })
})

describe("panelStyle", () => {
    it("uses a hard-edge border token for elevation, never boxShadow", () => {
        const s1 = panelStyle({ elevation: 1 })
        const s2 = panelStyle({ elevation: 2 })
        expect(s1.border).toBe("var(--elevation-1)")
        expect(s2.border).toBe("var(--elevation-2)")
        expect(s1.boxShadow).toBeUndefined()
        expect(s2.boxShadow).toBeUndefined()
    })

    it("steps up to the elevated surface token when requested", () => {
        const base = panelStyle({ elevated: false })
        const raised = panelStyle({ elevated: true })
        expect(base.background).toBe("var(--bg-secondary)")
        expect(raised.background).toBe("var(--bg-elevated)")
    })

    it("omits padding when padded is false", () => {
        expect(panelStyle({ padded: false }).padding).toBe(0)
        expect(panelStyle({ padded: true }).padding).toBe("var(--space-4)")
    })
})

describe("emptyStateStyle", () => {
    it("is left-aligned by construction", () => {
        expect(emptyStateStyle().textAlign).toBe("left")
    })
})
