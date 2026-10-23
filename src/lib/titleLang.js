/**
 * titleLang.js — what a screen says about a headline's language.
 *
 * The server puts headlines into English (backend/title_translate.py) and
 * marks each item it touched: title_translated true with the original in
 * title_original / headline_original, or title_translated false while a
 * foreign headline waits for its translation (or the model is off), with
 * the language it is in (title_lang_name). A waiting headline is shown as
 * it is, marked, never passed off as English; a translated one keeps its
 * original one tap away.
 */

/** "Turkish" when this headline is still in another language, else null. */
export function untranslatedLang(item) {
    if (!item || item.title_translated !== false) return null
    return item.title_lang_name || "Another language"
}

/** The original text of a translated headline, else null. */
export function originalTitle(item) {
    if (!item || item.title_translated !== true) return null
    return item.title_original || item.headline_original || null
}

/** One line for a detail view, or null when the headline is English. */
export function langNote(item) {
    const orig = originalTitle(item)
    if (orig) return `Translated from ${item.title_lang_name || "another language"} · original: “${orig}”`
    const lang = untranslatedLang(item)
    return lang ? `In ${lang === "Another language" ? "another language" : lang}, not yet translated` : null
}
