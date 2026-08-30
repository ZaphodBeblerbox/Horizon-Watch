import { describe, it, expect } from "vitest"
import { TYPE_META } from "./TopBar.jsx"
import { ICON_NAMES } from "../ui/Icon.jsx"

// Real-Icon.jsx replacement for TopBar.jsx's InlineSearch search-result-type
// table, which used to be a raw emoji table (✈⚓〰🔺⚡🔮👁⚙📌🌍🏙) per the
// full UI rebuild spec ("every icon in the app routes through Icon.jsx").
describe("TopBar TYPE_META", () => {
    it("maps every real search-result type to a real Icon.jsx name", () => {
        for (const [type, meta] of Object.entries(TYPE_META)) {
            expect(ICON_NAMES, `TYPE_META.${type} references an unknown icon name`).toContain(meta.iconName)
        }
    })

    it("gives every entry a real hex color, never an emoji character", () => {
        for (const [type, meta] of Object.entries(TYPE_META)) {
            expect(meta.color, `TYPE_META.${type}.color`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
            expect(meta).not.toHaveProperty("icon") // the old emoji field name
        }
    })

    it("covers every real result type the backend /api/search endpoint returns", () => {
        const expected = [
            "airport", "port", "cable", "chokepoint", "assessment",
            "fusion", "zone", "rule", "location", "country", "city",
        ]
        for (const type of expected) {
            expect(TYPE_META, `missing TYPE_META.${type}`).toHaveProperty(type)
        }
    })
})
