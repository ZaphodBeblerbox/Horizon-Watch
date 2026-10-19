import { describe, expect, it } from "vitest"
import { moodPoint } from "./telegramMood.js"
import { crowdLabel, crowdSources, dayLabel, itemStatusLabel, mediaItems, protestPoints, protestRaw, span, statusLabel } from "./protests.js"

const NOW = Date.parse("2026-10-18T13:00:00Z")          // 15:00 in Paris
const T = (min) => new Date(NOW + min * 60_000).toISOString().replace(".000Z", "Z")
const TZ = "Europe/Paris"

describe("statusLabel — the same words as backend protest_status.status_label", () => {
    it("planned: starts in …, or the day and hour when far", () => {
        expect(statusLabel({ key: "planned", starts_utc: T(180), tz: TZ }, NOW)).toBe("Planned · starts in 3 h")
        expect(statusLabel({ key: "planned", starts_utc: T(45), tz: TZ }, NOW)).toBe("Planned · starts in 45 min")
        expect(statusLabel({ key: "planned", starts_utc: T(60 * 48), tz: TZ }, NOW)).toBe("Planned · Tue 20 Oct 15:00")
        expect(statusLabel({ key: "planned", starts_utc: T(60 * 22), tz: TZ }, NOW)).toBe("Planned · tomorrow 13:00")
        expect(statusLabel({ key: "planned", starts_utc: T(60 * 24), tz: TZ, start_approx: true }, NOW)).toBe("Planned · tomorrow (no time given)")
    })
    it("starting now", () => {
        expect(statusLabel({ key: "starting", starts_utc: T(5), since: T(5), tz: TZ }, NOW)).toBe("Starting now · 15:05")
        expect(statusLabel({ key: "starting", starts_utc: T(40), since: T(-2), last_report_at: T(-2), tz: TZ }, NOW))
            .toBe("Starting · people already there (reports 2 min ago)")
    })
    it("ongoing, with reports or by the clock only — the minutes keep counting", () => {
        const s = { key: "ongoing", starts_utc: T(-60), since: T(-60), last_report_at: T(-3), tz: TZ }
        expect(statusLabel(s, NOW)).toBe("Ongoing · since 14:00 (reports 3 min ago)")
        expect(statusLabel(s, NOW + 5 * 60_000)).toBe("Ongoing · since 14:00 (reports 8 min ago)")
        expect(statusLabel({ key: "ongoing", starts_utc: T(-60), since: T(-60), tz: TZ }, NOW)).toBe("Ongoing · since 14:00 (no reports from there yet)")
        expect(statusLabel({ key: "ongoing", starts_utc: T(-60), since: T(-60), last_report_at: T(0), tz: TZ }, NOW)).toBe("Ongoing · since 14:00 (reports just now)")
    })
    it("dispersing, ended, no sign it happened", () => {
        expect(statusLabel({ key: "dispersing", last_report_at: T(-40), tz: TZ }, NOW)).toBe("Dispersing · reports 40 min ago")
        expect(statusLabel({ key: "ended", starts_utc: T(-60), since: T(-60), until: T(-50 + 200), tz: TZ }, NOW)).toBe("Ended · 14:00–17:30")
        expect(statusLabel({ key: "no_show", starts_utc: T(-300), tz: TZ }, NOW)).toBe("No sign it happened · planned 10:00")
        expect(statusLabel({ key: "no_show", starts_utc: T(-300), tz: TZ, start_approx: true }, NOW)).toBe("No sign it happened")
    })
    it("hours in UTC when the zone is unknown", () => {
        expect(statusLabel({ key: "ongoing", starts_utc: T(-60), since: T(-60) }, NOW)).toBe("Ongoing · since 12:00 UTC (no reports from there yet)")
    })
    it("other zones: Buenos Aires, Tirana", () => {
        expect(statusLabel({ key: "ongoing", since: "2026-10-18T20:00:00Z", last_report_at: "2026-10-18T20:55:00Z", tz: "America/Argentina/Buenos_Aires" },
                           Date.parse("2026-10-18T21:00:00Z"))).toBe("Ongoing · since 17:00 (reports 5 min ago)")
        expect(statusLabel({ key: "planned", starts_utc: "2026-10-18T16:00:00Z", tz: "Europe/Tirane" }, NOW)).toBe("Planned · starts in 3 h")
    })
})

describe("helpers", () => {
    it("span and dayLabel", () => {
        expect(span(12)).toBe("12 min")
        expect(span(200)).toBe("3 h 20")
        expect(span(1500)).toBe("1 day")
        expect(dayLabel(T(60 * 24), NOW, TZ)).toBe("tomorrow")
        expect(dayLabel(T(-60 * 24), NOW, TZ)).toBe("yesterday")
    })
    it("an item that stands for a protest reads its status; others none", () => {
        expect(itemStatusLabel({ protest_status: { key: "ongoing", since: T(-60), last_report_at: T(-3), tz: TZ } }, NOW))
            .toBe("Ongoing · since 14:00 (reports 3 min ago)")
        expect(itemStatusLabel({ posted_at: T(-840) }, NOW)).toBeNull()
    })
    it("the crowd is a range with its basis, the sources apart", () => {
        const p = { crowd: { label: "est. 1,500–3,000 · from 3 photos + 2 reports", by_source_label: "organisers 10,000 · police 2,300" } }
        expect(crowdLabel(p)).toBe("est. 1,500–3,000 · from 3 photos + 2 reports")
        expect(crowdSources(p)).toBe("organisers 10,000 · police 2,300")
        expect(crowdLabel({})).toBeNull()
    })
})

const PROTEST = {
    id: "pr-1", kind: "protest", title: "Protest march at Place de la République", place: "Place de la République, Paris",
    lat: 48.8674, lon: 2.3636, tz: TZ, starts_utc: T(-60), starts_label: "today 14:00",
    status: { key: "ongoing", since: T(-60), last_report_at: T(-3), starts_utc: T(-60), n_reports: 4 },
    status_label: "Ongoing · since 14:00 (reports 3 min ago)",
    crowd: { label: "est. 1,500–3,000 · from 3 photos + 2 reports" },
    media: [{ id: "g/2", type: "video", thumb_url: "/api/telegram/media/g_2.jpg", video_url: "/api/telegram/video/g/2", chat: "Groupe", at: T(-4) }],
    sources: [{ channel: "g", msg_id: 1, channel_title: "Groupe", url: "https://t.me/g/1" }],
}

describe("the map and the card", () => {
    it("a protest's card never says 'announced N h ago'", () => {
        const raw = protestRaw(PROTEST, NOW)
        expect(raw.published_at).toBeNull()
        expect(raw.status_label).toBe("Ongoing · since 14:00 (reports 3 min ago)")
        expect(raw.sub).toBe("Ongoing · since 14:00 (reports 3 min ago) · est. 1,500–3,000 · from 3 photos + 2 reports")
        expect(raw.detail).toMatch(/Ongoing · since 14:00/)
    })
    it("points carry the status mark", () => {
        const [pt] = protestPoints({ protests: [PROTEST, { ...PROTEST, id: "x", lat: null }] }, NOW)
        expect(pt.key).toBe("ongoing")
        expect(pt.iconUri).toMatch(/^data:image\/svg\+xml/)
        expect(decodeURIComponent(pt.iconUri)).toContain("Ongoing · since 14:00")
    })
    it("a protest that is over is no longer on the map (owner, 2026-10-19)", () => {
        const over = [{ ...PROTEST, id: "e", status: { key: "ended" } }, { ...PROTEST, id: "n", status: { key: "no_show" } }]
        expect(protestPoints({ protests: [...over, PROTEST] }, NOW).map((p) => p.raw.id)).toEqual(["pr-1"])
    })
    it("a call to violence (no time said) leaves the map after 12 h", () => {
        const a = { alert_id: "1", alert_type: "Telegram mood: call to violence", lat: 48.8, lon: 2.3, title: "x" }
        expect(moodPoint({ ...a, created_at: T(-60 * 3) }, NOW)).not.toBeNull()
        expect(moodPoint({ ...a, created_at: T(-60 * 13) }, NOW)).toBeNull()
        expect(moodPoint({ ...a, alert_type: "Telegram mood: tension rising sharply", created_at: T(-60 * 13) }, NOW)).not.toBeNull()
    })
    it("media get absolute URLs", () => {
        const [m] = mediaItems(PROTEST, "https://api.example")
        expect(m.thumb).toBe("https://api.example/api/telegram/media/g_2.jpg")
        expect(m.video).toBe("https://api.example/api/telegram/video/g/2")
    })
})
