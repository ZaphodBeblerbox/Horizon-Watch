import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DevelopingList, FollowingList } from "./EventLists.jsx"
import EventInline from "./EventInline.jsx"

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
    it("a followed item opens under its row too", () => {
        const f = { items: [{ target: "protest:paris", lead_event_id: "ev_9", headline: "Paris march", line: "moving east" }] }
        const html = renderToStaticMarkup(<FollowingList data={f} openId="ev_9" renderOpen={() => <b>OPEN</b>} />)
        expect(html.indexOf("Paris march")).toBeLessThan(html.indexOf("OPEN"))
    })
})
