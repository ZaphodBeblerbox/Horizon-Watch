/**
 * sourceEmbed.js — which sources can be read inside the console, and how.
 *
 * A post page cannot be framed: x.com sends X-Frame-Options SAMEORIGIN and
 * t.me sends frame-ancestors https://web.telegram.org (both measured
 * 2026-10-05). Each publishes an embed endpoint that IS frameable, built
 * for exactly this, and those are what this returns. Nearly every
 * GeoConfirmed citation is one or the other.
 *
 * Everything else — news sites set the same headers and have no embed —
 * returns null, and the caller opens it in a new tab. A frame that loads a
 * refusal page is worse than a link that works.
 */

const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)\/status(?:es)?\/(\d+)/i
const TG_POST = /^https?:\/\/(?:www\.)?t(?:elegram)?\.me\/(?:s\/)?([A-Za-z0-9_]{3,})\/(\d+)/i

export function embedFor(url, { dark = false } = {}) {
    const u = String(url || "").trim()
    let m = X_STATUS.exec(u)
    if (m) {
        const q = new URLSearchParams({ id: m[2], dnt: "true", theme: dark ? "dark" : "light" })
        return { kind: "x", label: `@${m[1]} on X`, src: `https://platform.twitter.com/embed/Tweet.html?${q}` }
    }
    m = TG_POST.exec(u)
    if (m) {
        const q = new URLSearchParams({ embed: "1", ...(dark ? { dark: "1" } : {}) })
        return { kind: "telegram", label: `${m[1]} on Telegram`, src: `https://t.me/${m[1]}/${m[2]}?${q}` }
    }
    return null
}

/** Ask the shell to show this source in its in-console viewer. */
export function openSource(url) {
    window.dispatchEvent(new CustomEvent("akili:open-source", { detail: { url } }))
}

const URLS = /https?:\/\/[^\s,]+/g

/**
 * Pull attribute rows whose value is nothing but links out of the table
 * and into a Sources list. A citation is not an attribute: in the table it
 * was a column of URLs; as a list each one can say what it is and offer to
 * open in place. A row with prose AND a link stays where it is.
 */
export function splitSources(attributes = []) {
    const keep = [], sources = []
    for (const a of attributes) {
        const v = String(a?.value ?? "")
        const urls = v.match(URLS) || []
        const rest = v.replace(URLS, "").replace(/[\s,;]+/g, "")
        if (!urls.length || rest) { keep.push(a); continue }
        urls.forEach((url, i) => sources.push({
            label: urls.length > 1 ? `${a.label} ${i + 1}` : a.label,
            url,
        }))
    }
    return { attributes: keep, sources }
}

export function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "" }
}
