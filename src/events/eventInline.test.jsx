import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DevelopingList, FollowingList } from "./EventLists.jsx"
import EventInline from "./EventInline.jsx"
import { BriefBlock } from "./EventDetail.jsx"

const data = { items: [{ id: "ev_1", headline: "Strike on the port", status: "developing" }, { id: "ev_2", headline: "Protest at the square", status: "ongoing" }] }

describe("a Home item opens inside Home", () => {
    it("the open event slides open under its own row, not in a dialog", () => {
        const html = renderToStaticMarkup(<DevelopingList data={data} openId="ev_2"
            renderOpen={(ev) => <EventInline label={ev.headline}><p>DETAIL {ev.id}</p></EventInline>} />)
        expect(html).toContain("DETAIL ev_2")
        expect(html).not.toContain("DETAIL ev_1")
        expect(html.indexOf("Protest at the square")).toBeLessThan(html.indexOf("DETAIL ev_2"))
        expect(html).toContain('data-testid="home-inline-detail"')
        expect(html).not.toContain('role="dialog"')
        expect(html).toContain('aria-expanded="true"')
    })
    it("'First brief' opens the brief: every version with its text and sources", () => {
        const b1 = { version: 1, created_at: "2026-10-24T12:32:00", summary: "Smoke over the port.", by: "code",
                     facts: [{ text: "A fire at the pier", sources: [{ label: "Rybar", url: "https://t.me/rybar/1" }] }] }
        const b2 = { version: 2, created_at: "2026-10-24T12:50:00", summary: "A warehouse burns at the port.", what_changed: "the warehouse named", by: "model", facts: [] }
        const closed = renderToStaticMarkup(<BriefBlock ev={{ headline: "x", brief: b2 }} briefs={[b2, b1]} onToggle={() => {}} />)
        expect(closed).toContain('data-testid="ev-brief-open"')
        expect(closed).not.toContain("ev-brief-versions")
        const open = renderToStaticMarkup(<BriefBlock ev={{ headline: "x", brief: b2 }} briefs={[b2, b1]} open onToggle={() => {}} />)
        expect(open).toContain("ev-brief-versions")
        expect(open).toContain("Smoke over the port.")
        expect(open).toContain("the warehouse named")
        expect(open).toContain('href="https://t.me/rybar/1"')
    })
    it("a followed item opens under its row too", () => {
        const f = { items: [{ target: "protest:paris", lead_event_id: "ev_9", headline: "Paris march", line: "moving east" }] }
        const html = renderToStaticMarkup(<FollowingList data={f} openId="ev_9" renderOpen={() => <b>OPEN</b>} />)
        expect(html.indexOf("Paris march")).toBeLessThan(html.indexOf("OPEN"))
    })
})
