import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import { StatementList, topStatements } from "./StatementsSection.jsx"

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

describe("topStatements", () => {
    const at = (m) => new Date(Date.UTC(2026, 9, 23, 12, m)).toISOString()
    const many = [
        { id: "1", party: "IDF", headline: "IDF says it struck a launch site in Gaza", posted_at: at(1) },
        { id: "2", party: "IDF", headline: "IDF struck launch site Gaza again", posted_at: at(5) },
        { id: "3", party: "IDF", headline: "IDF says it intercepted a drone", posted_at: at(9) },
        { id: "4", party: "Hamas", headline: "Hamas says it fired rockets at Ashkelon", posted_at: at(2) },
        { id: "5", party: "Houthi", headline: "Houthis claim a ship attack", posted_at: at(3) },
        { id: "6", party: "Houthi", headline: "Houthis claim another ship attack", posted_at: at(4) },
        { id: "7", party: "RSF", headline: "RSF says El Fasher taken", posted_at: at(0) },
    ]
    it("keeps one per party, its latest, the most repeated first, the rest behind Show more", () => {
        const { top, rest } = topStatements(many)
        expect(top.map((s) => s.id)).toEqual(["6", "3", "4"])
        expect(top[0].repeats).toBe(2)
        expect(rest.map((s) => s.id)).toEqual(["2", "5", "1", "7"])
        const out = html(<StatementList items={many} />)
        expect(out.match(/data-testid="statement"/g)).toHaveLength(3)
        expect(out).toContain("Show 4 more")
        expect(out).toContain("said 2 times")
        expect(html(<StatementList items={many} initiallyOpen />).match(/data-testid="statement"/g)).toHaveLength(7)
    })
})
