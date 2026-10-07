// The situation-report reader renders a real document (a weekly rehearsal,
// backend/briefing/) with its references live and every part it holds.
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { IssueView } from "./IssueReader.jsx"
import doc from "./__fixtures__/issue.json"

describe("IssueView", () => {
    it("renders the issue with its parts and references", () => {
        const html = renderToStaticMarkup(<IssueView doc={doc} ev={{ events: [], findings: [] }} />)
        expect(html).toContain(doc.meta.title)
        expect(html).toContain(doc.labels.sites)
        expect(html).toContain(doc.labels.key_judgments)
        expect(html).toMatch(/<sup[^>]*><span><button[^>]*>S-\d+<\/button>/)
        for (const s of doc.sections) expect(html).toContain(s.title)
    })
    it("opens a reference in the side panel", () => {
        const sid = doc.sources.find((s) => s.id.startsWith("S-"))?.id || "S-01"
        const html = renderToStaticMarkup(<IssueView doc={doc} ev={{ events: [{ sid, title: "A signal", when: "2026-10-06T10:00", lat: 1, lon: 2, sources: ["AIS"], corroboration: 1, category: "maritime" }], findings: [] }} refId={sid} />)
        expect(html).toContain("A signal")
        expect(html).toContain("Show on the globe")
    })
})
