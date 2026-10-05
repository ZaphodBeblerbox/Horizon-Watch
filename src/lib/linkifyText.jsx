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
 *
 * THE LINK READS "Source ↗", NOT THE URL. A GeoConfirmed record's citation
 * is a full x.com status URL, and printing it made the inspector a column
 * of ninety-character strings that wrapped mid-token. The address is still
 * one hover away (title) and the host is shown beside the arrow, so where
 * it goes is never hidden. Several links in one value are numbered.
 */
const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "" }
}
const URL_RE = /https?:\/\/[^\s,]+/g

export function linkifyText(value) {
    if (value === null || value === undefined || value === "") return value
    const str = String(value)
    const re = new RegExp(URL_RE)
    const parts = []
    let lastIndex = 0
    let match
    const total = (str.match(new RegExp(URL_RE)) || []).length
    let n = 0
    while ((match = re.exec(str)) !== null) {
        if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index))
        const url = match[0]
        parts.push(
            <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" title={url}
                style={{ color: "var(--acc-hi)", whiteSpace: "nowrap", textDecoration: "none" }}>
                {total > 1 ? `Source ${++n}` : "Source"} ↗
                {hostOf(url) ? <span style={{ color: "var(--txt-4, var(--txt4))", marginLeft: 4, fontSize: "0.9em" }}>{hostOf(url)}</span> : null}
            </a>
        )
        lastIndex = match.index + url.length
    }
    if (lastIndex < str.length) parts.push(str.slice(lastIndex))
    return parts.length ? parts : str
}
