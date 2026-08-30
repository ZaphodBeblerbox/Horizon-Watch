import { describe, it, expect } from "vitest"
import { articleKey, hasRealCoordinates, getPlottableArticles, findHighlightedMarker, buildStoryActions } from "./newsMapUtils.js"

describe("hasRealCoordinates", () => {
    it("accepts a real finite lat/lon pair", () => {
        expect(hasRealCoordinates({ lat: 51.5, lon: -0.1 })).toBe(true)
    })

    it("rejects missing coordinates", () => {
        expect(hasRealCoordinates({})).toBe(false)
        expect(hasRealCoordinates({ lat: 51.5 })).toBe(false)
        expect(hasRealCoordinates(null)).toBe(false)
    })

    it("rejects non-finite coordinates", () => {
        expect(hasRealCoordinates({ lat: "n/a", lon: -0.1 })).toBe(false)
        expect(hasRealCoordinates({ lat: NaN, lon: 1 })).toBe(false)
    })

    it("treats (0,0) as a placeholder, not a real location", () => {
        expect(hasRealCoordinates({ lat: 0, lon: 0 })).toBe(false)
    })
})

describe("getPlottableArticles", () => {
    it("excludes articles without real coordinates rather than defaulting them", () => {
        const articles = [
            { id: "a1", lat: 40.7, lon: -74.0 },
            { id: "a2" }, // no coords at all
            { id: "a3", lat: 0, lon: 0 }, // placeholder
            { id: "a4", lat: 48.8, lon: 2.35 },
        ]
        const plottable = getPlottableArticles(articles)
        expect(plottable.map(m => m.id)).toEqual(["a1", "a4"])
    })

    it("returns an empty array for non-array input", () => {
        expect(getPlottableArticles(null)).toEqual([])
        expect(getPlottableArticles(undefined)).toEqual([])
    })

    it("carries the original article on each plot record", () => {
        const article = { id: "a1", lat: 1, lon: 2, headline: "Test" }
        const [plot] = getPlottableArticles([article])
        expect(plot.article).toBe(article)
        expect(plot.lat).toBe(1)
        expect(plot.lon).toBe(2)
    })
})

describe("articleKey", () => {
    it("prefers a real id", () => {
        expect(articleKey({ id: "abc" })).toBe("abc")
    })

    it("falls back to url, then headline, then index", () => {
        expect(articleKey({ url: "http://x" })).toBe("http://x")
        expect(articleKey({ headline: "Headline" })).toBe("Headline")
        expect(articleKey({}, 3)).toBe("idx-3")
    })
})

describe("findHighlightedMarker", () => {
    const plottable = [
        { id: "a1", lat: 1, lon: 2, article: { id: "a1", lat: 1, lon: 2 } },
        { id: "a2", lat: 3, lon: 4, article: { id: "a2", lat: 3, lon: 4 } },
    ]

    it("finds the marker matching the selected article by reference", () => {
        const found = findHighlightedMarker(plottable, plottable[1].article)
        expect(found.id).toBe("a2")
    })

    it("returns null when nothing is selected", () => {
        expect(findHighlightedMarker(plottable, null)).toBeNull()
    })

    it("returns null when the selected story has no plottable marker", () => {
        const unplottable = { id: "a3" } // no coordinates, never made it into plottable
        expect(findHighlightedMarker(plottable, unplottable)).toBeNull()
    })
})

describe("buildStoryActions", () => {
    it("invokes the real callbacks with the story object, unmodified", () => {
        const story = { id: "a1", lat: 1, lon: 2 }
        let jumped = null, opened = null
        const actions = buildStoryActions(story, {
            onJumpToLocation: (s) => { jumped = s },
            onOpenInspector: (s) => { opened = s },
        })
        actions.jumpToLocation()
        actions.openInspector()
        expect(jumped).toBe(story)
        expect(opened).toBe(story)
    })

    it("no-ops safely when callbacks are omitted", () => {
        const actions = buildStoryActions({ id: "a1" })
        expect(() => actions.jumpToLocation()).not.toThrow()
        expect(() => actions.openInspector()).not.toThrow()
    })
})
