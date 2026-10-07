import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import TelegramMedia, { SafeThumb, warnFor } from "./TelegramMedia.jsx"

const post = { id: "tg-x-1", channel: "x", msg_id: 1, media: "video", thumb_url: "/api/telegram/media/a.jpg", headline: "h" }

describe("sensitive footage", () => {
    it("only graphic posts are covered", () => {
        expect(warnFor(post)).toBe(false)
        expect(warnFor({ ...post, graphic: true })).toBe(true)
    })
    it("a graphic post opens behind the warning and loads no video", () => {
        const html = renderToStaticMarkup(<TelegramMedia post={{ ...post, graphic: true }} />)
        expect(html).toContain("Sensitive content")
        expect(html).toContain("dead or injured")
        expect(html).not.toContain("<video")
    })
    it("an ordinary post plays at once", () => {
        expect(renderToStaticMarkup(<TelegramMedia post={post} />)).toContain("<video")
    })
    it("a list thumbnail is blurred when graphic", () => {
        expect(renderToStaticMarkup(<SafeThumb post={{ ...post, graphic: true }} src="a.jpg" />)).toContain("blur(")
        expect(renderToStaticMarkup(<SafeThumb post={post} src="a.jpg" />)).not.toContain("blur(")
    })
})
