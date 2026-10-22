import { describe, it, expect } from "vitest"
import { pushNotification, getNotifications } from "./notificationStore.js"

describe("notification cards from Telegram carry no emoji", () => {
    it("strips the title and the sub line", () => {
        pushNotification({ id: "ls-1", kind: "telegram", sev: "high", title: "\u{1F6A8} Arrest at rue de Rivoli, Paris \u{1F1EB}\u{1F1F7}", sub: "Eyewitness, unverified \u26A1\uFE0F", ts: Date.now() })
        const items = getNotifications().items
        expect(items.length).toBeGreaterThan(0)
        expect(items[0].title).toBe("Arrest at rue de Rivoli, Paris")
        expect(JSON.stringify(items)).not.toMatch(/[\u{1F000}-\u{1FAFF}\u26A1\uFE0F]/u)
    })
})
