import { describe, it, expect } from "vitest"
import { stripEmoji, liveSignalDrawn, cardText, declutterAll, labelsToShow, actIcon, ACTS, mediaSources } from "./liveSignals.js"

const NOW = Date.parse("2026-10-22T16:00:00Z")
const ago = (m) => new Date(NOW - m * 60_000).toISOString()

describe("emoji guard", () => {
    it("strips pictographs, flags, variation selectors and joiners, keeps accents", () => {
        expect(stripEmoji("🇫🇷 ALERTE ⚡️ Arrest 🚨 at rue de Rivoli 👮‍♂️")).toBe("ALERTE Arrest at rue de Rivoli")
        expect(stripEmoji("Île-de-France, café")).toBe("Île-de-France, café")
        expect(stripEmoji(null)).toBe("")
        expect(stripEmoji("Pas de sauvage du coup 😢😂")).toBe("Pas de sauvage du coup")
    })
})

describe("the age rule", () => {
    it("draws a signal for 60 minutes after its event, a crowd up to 3 h from its first report", () => {
        expect(liveSignalDrawn({ act: "arrest", event_time: ago(59) }, NOW)).toBe(true)
        expect(liveSignalDrawn({ act: "arrest", event_time: ago(61) }, NOW)).toBe(false)
        expect(liveSignalDrawn({ act: "crowd_movement", event_time: ago(10), first_event_time: ago(170) }, NOW)).toBe(true)
        expect(liveSignalDrawn({ act: "crowd_movement", event_time: ago(10), first_event_time: ago(200) }, NOW)).toBe(false)
        expect(liveSignalDrawn({ act: "arrest" }, NOW)).toBe(false)
    })
})

describe("the card", () => {
    it("is one plain sentence and one source line", () => {
        const c = cardText({ title: "Police charge at Sorbonne, Paris 🚨", corroboration: { line: "Eyewitness, unverified" }, event_time: ago(8),
                             lines: [{ text: "Arrest at Sorbonne, Paris" }] }, NOW)
        expect(c.title).toBe("Police charge at Sorbonne, Paris")
        expect(c.line).toBe("Eyewitness, unverified, 8 min ago")
        expect(c.lines).toEqual(["Arrest at Sorbonne, Paris"])
        expect(JSON.stringify(c)).not.toMatch(/footage from|report/i)
    })
    it("gives ReportMedia the signal's media only", () => {
        const s = { event_time: ago(5), sources: [{ channel_title: "AlertesInfos" }], all_media: [{ kind: "video", thumb_url: "/t.jpg", video_url: "/v", channel: "A", msg_id: 3 }] }
        expect(mediaSources(s)).toEqual([expect.objectContaining({ media: "video", video_url: "/v", msg_id: 3 })])
        expect(mediaSources({})).toEqual([])
    })
})

describe("one family of icons", () => {
    it("has an icon for each of the nine acts, fainter when muted", () => {
        expect(Object.keys(ACTS)).toHaveLength(9)
        for (const a of Object.keys(ACTS)) expect(actIcon(a)).toMatch(/^data:image\/svg\+xml/)
        expect(actIcon("arrest")).not.toBe(actIcon("arrest", { muted: true }))
    })
})

const boxesTouch = (a, b) => Math.abs(a.x - b.x) < (a.size + b.size) / 2 && Math.abs(a.y - b.y) < (a.size + b.size) / 2

describe("collision pass", () => {
    it("three markers on one place become one cluster", () => {
        const out = declutterAll([{ id: "a", x: 100, y: 100, size: 28 }, { id: "b", x: 104, y: 98, size: 28 }, { id: "c", x: 97, y: 103, size: 28 }])
        expect(out).toHaveLength(1)
        expect(out[0].cluster).toBe(true)
        expect(out[0].members.map((m) => m.id).sort()).toEqual(["a", "b", "c"])
    })
    it("markers apart stay markers, and no two results touch", () => {
        const items = []
        for (let i = 0; i < 60; i++) items.push({ id: `m${i}`, x: (i * 37) % 400, y: (i * 53) % 300, size: 28 })
        const out = declutterAll(items)
        const size = (o) => (o.cluster ? 44 : 28)
        for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
            expect(boxesTouch({ ...out[i], size: size(out[i]) }, { ...out[j], size: size(out[j]) })).toBe(false)
        }
        expect(out.flatMap((o) => o.members)).toHaveLength(60)
    })
    it("a lone marker is left exactly where it is", () => {
        const [o] = declutterAll([{ id: "a", x: 10, y: 20, size: 28 }])
        expect(o).toMatchObject({ id: "a", x: 10, y: 20, cluster: false })
    })
})

describe("labels", () => {
    it("hides a label before it overlaps a marker or another label", () => {
        const markers = [{ x: 100, y: 100, size: 28 }]
        const labels = [{ id: "over", x: 95, y: 90, w: 60, h: 14 }, { id: "ok", x: 130, y: 90, w: 60, h: 14 }, { id: "clash", x: 140, y: 95, w: 60, h: 14 }]
        expect(labelsToShow(labels, markers).map((l) => l.id)).toEqual(["ok"])
    })
})
