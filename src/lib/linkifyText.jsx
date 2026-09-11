/**
 * linkifyText.jsx — render any real http(s) URL substring inside a plain
 * text/attribute value as a real clickable `<a target="_blank">`, leaving
 * everything else exactly as plain text. One general algorithm handles both
 * real shapes found in this app: a field that IS one bare URL, and a field
 * that carries several comma-separated URLs in one string (the regex stops
 * each match at the next comma/whitespace, so "url1, url2" naturally becomes
 * two separate real links with the comma preserved as a plain-text
 * separator, never one link whose href is the whole joined string).
 *
 * A value with no URL in it at all round-trips unchanged (returns an array
 * containing just the original string), so this is safe to apply
 * unconditionally to any attribute-style value, not only known citation
 * fields — never invents a link where the field isn't a real URL.
 */
const URL_RE = /https?:\/\/[^\s,]+/g

export function linkifyText(value) {
    if (value === null || value === undefined || value === "") return value
    const str = String(value)
    const re = new RegExp(URL_RE)
    const parts = []
    let lastIndex = 0
    let match
    while ((match = re.exec(str)) !== null) {
        if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index))
        const url = match[0]
        parts.push(
            <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-hi)", wordBreak: "break-all" }}>
                {url}
            </a>
        )
        lastIndex = match.index + url.length
    }
    if (lastIndex < str.length) parts.push(str.slice(lastIndex))
    return parts.length ? parts : str
}
