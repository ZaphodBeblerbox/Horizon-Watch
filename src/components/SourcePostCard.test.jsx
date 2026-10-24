import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import SourcePostCard from "./SourcePostCard.jsx"
import SourceLink from "./SourceLink.jsx"

describe("a source as our own card", () => {
    it("a Telegram post is our card, never Telegram's embed", () => {
        const html = renderToStaticMarkup(<SourcePostCard url="https://t.me/rybar/1234" given={{ source: "Rybar" }} />)
        expect(html).toContain('data-testid="source-card"')
        expect(html).toContain("Rybar")
        expect(html).toContain("What happened")
        expect(html).toContain("Open original")
        expect(html).not.toContain("<iframe")
        expect(html).not.toContain("embed=1")
    })
    it("a source link keeps its address but opens inside Parallax", () => {
        const html = renderToStaticMarkup(<SourceLink url="https://www.reuters.com/a">Original</SourceLink>)
        expect(html).toContain('href="https://www.reuters.com/a"')
        expect(html).not.toContain("_blank")
    })
})
