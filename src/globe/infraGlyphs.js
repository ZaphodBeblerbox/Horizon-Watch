/**
 * infraGlyphs.js — port and airport map glyphs, in the one typology (lib/mapIcons.js infraIcon): static
 * infrastructure context is a line glyph with no fill, neutral, one constant size whatever the port's or the
 * airport's class (owner, 2026-10-23). A crane on a quay for a port, a runway with its terminal for an airport
 * (never a plane: a plane on the ground is not a plane in the air). Congestion colours a port's glyph through
 * the priority ramp; a fine port stays neutral.
 */
import { infraIcon } from "../lib/mapIcons.js"

/** Port state → priority (null = neutral). */
export const PORT_STATE_PRIORITY = { nominal: null, busy: null, congested: "urgent", blocked: "flash" }

/** The glyph's data URI. `size` and `theme` are accepted for old callers and ignored (one size, one style). */
export function infraGlyphUri(kind, { state = "nominal" } = {}) {
    return infraIcon({ glyph: kind === "port" ? "port" : "airport", priority: kind === "port" ? PORT_STATE_PRIORITY[state] || null : null }).uri
}

export function clearInfraGlyphCache() { /* the one module caches by key; nothing depends on the theme */ }
