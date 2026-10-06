import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import { StatementList } from "./StatementsSection.jsx"

const items = [
    { id: "tgs-a", headline: "Houthi forces say they targeted Saudi troop movements near Bab al-Mandab",
      party: "Houthi forces (Ansar Allah)", posted_at: new Date().toISOString(), km: null, url: "https://t.me/x/1" },
    { id: "tgs-b", headline: "IDF says it struck a launch site", party: "Israel Defense Forces (IDF)",
      posted_at: new Date().toISOString(), km: 12 },
]

describe("StatementList", () => {
    it("attributes each claim to its party, says how it was matched, and links the original", () => {
        const out = html(<StatementList items={items} />)
        expect(out).toContain("What the parties say")
        expect(out).toContain("Houthi forces (Ansar Allah) · official statement")
        expect(out).toContain("names the country")
        expect(out).toContain("12 km away")
        expect(out).toContain('href="https://t.me/x/1"')
    })

    it("draws nothing when no party has spoken", () => {
        expect(html(<StatementList items={[]} />)).toBe("")
    })
})
