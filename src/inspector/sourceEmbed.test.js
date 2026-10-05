import { describe, it, expect } from "vitest"
import { embedFor, splitSources } from "./sourceEmbed.js"

describe("embedFor", () => {
    it("turns an X status into its frameable embed", () => {
        const e = embedFor("https://x.com/InsiderGeo/status/2107034484210086357")
        expect(e.kind).toBe("x")
        expect(e.src).toContain("platform.twitter.com/embed/Tweet.html?id=2107034484210086357")
        expect(e.label).toBe("@InsiderGeo on X")
        expect(embedFor("https://twitter.com/a/status/1", { dark: true }).src).toContain("theme=dark")
    })

    it("turns a Telegram post into its embed", () => {
        const e = embedFor("https://t.me/Sila_GO/125270")
        expect(e.kind).toBe("telegram")
        expect(e.src).toBe("https://t.me/Sila_GO/125270?embed=1")
        expect(embedFor("https://t.me/s/Sila_GO/125270").src).toBe("https://t.me/Sila_GO/125270?embed=1")
    })

    it("refuses what cannot be framed, so the caller opens a tab", () => {
        expect(embedFor("https://www.bbc.com/news/world-123")).toBeNull()
        expect(embedFor("https://x.com/InsiderGeo")).toBeNull()      // a profile, not a post
        expect(embedFor("https://t.me/Sila_GO")).toBeNull()
        expect(embedFor("")).toBeNull()
    })
})


describe("splitSources", () => {
    it("moves link-only rows into sources, numbered, and keeps the rest", () => {
        const { attributes, sources } = splitSources([
            { label: "Faction", value: "Neutral" },
            { label: "Original post", value: "https://x.com/a/status/1\nhttps://t.me/b/2" },
            { label: "Note", value: "see https://example.org for more" },
        ])
        expect(attributes.map((a) => a.label)).toEqual(["Faction", "Note"])
        expect(sources).toEqual([
            { label: "Original post 1", url: "https://x.com/a/status/1" },
            { label: "Original post 2", url: "https://t.me/b/2" },
        ])
    })
})
