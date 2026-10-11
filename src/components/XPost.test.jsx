import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import XPost, { XPostView, PhotoGrid, xPostId, photoName } from "./XPost.jsx"
import { GeneralItem } from "../general/GeneralFeed.jsx"

const URL = "https://x.com/giK1893/status/2109331790498279887"
const post = {
    id: "2109331790498279887", author: "PJ", handle: "giK1893", avatar: "https://pbs.twimg.com/profile_images/1/a.jpg",
    text: "A Shahed struck a highrise in Dnipro.", created_at: "2026-10-11T17:14:23Z", sensitive: false,
    photos: ["https://pbs.twimg.com/media/A.jpg", "https://pbs.twimg.com/media/B.jpg", "https://pbs.twimg.com/media/C.jpg"],
    videos: [], url: URL,
}

describe("native X post", () => {
    it("reads the id from x.com and twitter.com links", () => {
        expect(xPostId(URL)).toBe("2109331790498279887")
        expect(xPostId("see https://twitter.com/a_b/status/123456?s=20")).toBe("123456")
        expect(xPostId("https://t.me/x/1")).toBe(null)
    })
    it("draws author, handle, text, photos in a grid and a View on X link — never X's embed", () => {
        const html = renderToStaticMarkup(<XPostView post={post} url={URL} />)
        expect(html).toContain("PJ")
        expect(html).toContain("@giK1893")
        expect(html).toContain("A Shahed struck a highrise in Dnipro.")
        expect(html).toContain('data-testid="xpost-photos"')
        expect((html.match(/<img[^>]+pbs\.twimg\.com\/media\//g) || []).length).toBe(3)
        expect(html).toContain("grid-template-columns:1fr 1fr")
        expect(html).toContain("grid-column:1 / -1")                      // three photos: the first spans the row
        expect(html).toContain("View on X")
        expect(html).not.toContain("twitter-tweet")
        expect(html).not.toContain("platform.twitter.com")
    })
    it("asks X's photo host for a card-sized image, not the original", () => {
        expect(photoName("https://pbs.twimg.com/media/A.jpg?name=orig", "small")).toBe("https://pbs.twimg.com/media/A.jpg?name=small")
        expect(photoName("https://pbs.twimg.com/media/A.jpg", "medium")).toBe("https://pbs.twimg.com/media/A.jpg?name=medium")
        expect(photoName("https://pbs.twimg.com/media/A?format=jpg&name=orig", "large")).toBe("https://pbs.twimg.com/media/A?format=jpg&name=large")
    })
    it("one photo fills the card", () => {
        expect(renderToStaticMarkup(<PhotoGrid photos={["https://pbs.twimg.com/media/A.jpg"]} />)).toContain("grid-template-columns:1fr")
    })
    it("plays video through our server, muted, with the poster", () => {
        const html = renderToStaticMarkup(<XPostView post={{ ...post, photos: [],
            videos: [{ mp4: "https://video.twimg.com/v/480.mp4", poster: "https://pbs.twimg.com/thumb/1.jpg" }] }} url={URL} />)
        expect(html).toContain("<video")
        expect(html).toContain("/api/x/video?u=https%3A%2F%2Fvideo.twimg.com%2Fv%2F480.mp4")
        expect(html).toContain('poster="https://pbs.twimg.com/thumb/1.jpg"')
        expect(html).toMatch(/muted/)
    })
    it("sensitive media opens behind the warning", () => {
        const html = renderToStaticMarkup(<XPostView post={{ ...post, sensitive: true }} url={URL} />)
        expect(html).toContain("Sensitive content")
        expect(html).not.toContain('data-testid="xpost-photos"')
    })
    it("never an empty box: loading placeholder, then text and a link when X gives nothing", () => {
        expect(renderToStaticMarkup(<XPostView post={undefined} url={URL} />)).toContain("Loading the post from X")
        const html = renderToStaticMarkup(<XPostView post={null} url={URL} fallbackText="Strike on a depot near Kherson" />)
        expect(html).toContain('data-testid="xpost-fallback"')
        expect(html).toContain("Strike on a depot near Kherson")
        expect(html).toContain(`href="${URL}"`)
        expect(html).toContain("View on X")
    })
    it("the component starts with the placeholder", () => {
        expect(renderToStaticMarkup(<XPost url={URL} />)).toContain("Loading the post from X")
    })
})

describe("GeoConfirmed in the General desk", () => {
    const gc = { id: "gc:1", kind: "geoconfirmed", at: "2026-10-11T20:53:44", headline: "Russian strike on a depot", text: "",
                 lat: 47.1, lon: 37.5, faction: "Russia", event_date: "2026-10-11", place: "Ukraine", source: "GeoConfirmed" }
    it("without an X link: text, place, side, date and On the map", () => {
        const html = renderToStaticMarkup(<GeneralItem it={{ ...gc, url: "https://geoconfirmed.org/ukraine/1" }} />)
        expect(html).toContain("GeoConfirmed")
        expect(html).toContain("Russian strike on a depot")
        expect(html).toContain("Ukraine")
        expect(html).toContain("Side: Russia")
        expect(html).toContain("Event of 2026-10-11")
        expect(html).toContain("On the map")
        expect(html).toContain("Original")
        expect(renderToStaticMarkup(<GeneralItem it={{ ...gc, faction: "Neutral" }} />)).not.toContain("Side:")
    })
    it("with an X link: the native card, not a blank", () => {
        const html = renderToStaticMarkup(<GeneralItem it={{ ...gc, x_url: URL, url: URL }} />)
        expect(html).toContain("Loading the post from X")
        expect(html).toContain("On the map")
    })
})
