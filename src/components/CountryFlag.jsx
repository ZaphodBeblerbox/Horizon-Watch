/**
 * A small country flag: a vessel's flag state, an aircraft's state of
 * registry. The name shows on hover (title) and on tap (it opens beside
 * the flag), so the flag is never a riddle on a phone.
 */
import { useState } from "react"
import { countryName, flagEmoji } from "../lib/icaoCountry.js"

export default function CountryFlag({ iso2, name, size = 18, style }) {
    const [open, setOpen] = useState(false)
    const emoji = flagEmoji(iso2)
    if (!emoji) return null
    const label = name || countryName(iso2)
    return (
        <span
            data-testid="country-flag"
            role="img"
            aria-label={label}
            title={label}
            onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
                     verticalAlign: "middle", flexShrink: 0, ...style }}>
            <span style={{ fontSize: size, lineHeight: 1,
                           fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}>
                {emoji}
            </span>
            {open && (
                <span style={{ fontFamily: "var(--font, inherit)", fontSize: 12, fontWeight: 500,
                               color: "var(--text-secondary, var(--txt-2, inherit))" }}>{label}</span>
            )}
        </span>
    )
}
