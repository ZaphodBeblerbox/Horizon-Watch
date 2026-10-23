import { describe, it, expect } from "vitest"
import { langNote, originalTitle, untranslatedLang } from "./titleLang.js"

const translated = { title: "State of emergency in France! All protests banned", title_translated: true,
                     title_original: "Fransa'da ohal! Tüm eylemler yasaklandı", title_lang: "tr", title_lang_name: "Turkish" }
const waiting = { title: "Midtvejsvalget i USA", title_translated: false, title_lang: "da", title_lang_name: "Danish" }

describe("a headline's language", () => {
    it("marks a headline still in another language, and only that", () => {
        expect(untranslatedLang(waiting)).toBe("Danish")
        expect(untranslatedLang(translated)).toBe(null)
        expect(untranslatedLang({ title: "Drone strike on Ras Isa terminal" })).toBe(null)
        expect(untranslatedLang({ title: "x", title_translated: false })).toBe("Another language")
    })
    it("keeps the original of a translated headline", () => {
        expect(originalTitle(translated)).toBe("Fransa'da ohal! Tüm eylemler yasaklandı")
        expect(originalTitle({ headline: "Missile launch at Sumy", headline_original: "Missile launch at Суми", title_translated: true }))
            .toBe("Missile launch at Суми")
        expect(originalTitle(waiting)).toBe(null)
    })
    it("says it in one line for a detail view", () => {
        expect(langNote(translated)).toBe("Translated from Turkish · original: “Fransa'da ohal! Tüm eylemler yasaklandı”")
        expect(langNote(waiting)).toBe("In Danish, not yet translated")
        expect(langNote({ title: "English" })).toBe(null)
        expect(langNote(null)).toBe(null)
    })
})
