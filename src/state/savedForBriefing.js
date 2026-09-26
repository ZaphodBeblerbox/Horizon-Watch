/**
 * savedForBriefing.js — the things you kept off the map to write about.
 *
 * briefingBasket.js already held "evidence selected for the next report",
 * but only as {id, label}: enough to show a count, not enough to put
 * anything on a page. Writing needs the artefact itself — the satellite
 * crop, where it was, what found it — so this carries the whole item and
 * the basket keeps its own narrower job.
 *
 * PERSISTED PER USER, not in memory. Something you saved on Tuesday to
 * write up on Wednesday has to still be there on Wednesday. It goes through
 * settingsStore (User.settings on the server) for the same reason every
 * other per-user preference does: it must follow the account, not the
 * machine you last used.
 *
 * Items are deliberately small — a URL and coordinates, never the image
 * bytes. A few hundred KB of base64 per saved crop would be written back to
 * the user's settings row on every save.
 */

import { useEffect, useState } from "react"
import { getSettings, subscribeSettings, updateSetting } from "./settingsStore.js"

/** kind: "imagery" | "signal" | "entity" | "note" */
function read() {
    const v = getSettings()?.savedForBriefing
    return Array.isArray(v) ? v : []
}

export function getSaved() { return read() }

export function saveForBriefing(item) {
    if (!item?.id) return false
    const now = read()
    if (now.some((x) => x.id === item.id)) return false
    const next = [{
        id: item.id,
        kind: item.kind || "signal",
        label: item.label || item.id,
        region: item.region || null,
        lat: item.lat ?? null,
        lon: item.lon ?? null,
        imageUrl: item.imageUrl || null,
        detail: item.detail || null,
        savedAt: Date.now(),
    }, ...now].slice(0, 120)   // a sidebar, not an archive
    updateSetting("savedForBriefing", next)
    return true
}

export function removeSaved(id) {
    updateSetting("savedForBriefing", read().filter((x) => x.id !== id))
}

export function clearSaved() { updateSetting("savedForBriefing", []) }

export function useSaved() {
    const [items, setItems] = useState(read)
    useEffect(() => subscribeSettings((s) => {
        const v = s?.savedForBriefing
        setItems(Array.isArray(v) ? v : [])
    }), [])
    return items
}

/**
 * How an item reads in the sidebar: "Sat image detection (Hormuz)".
 * The region is in the label because "Sat image detection" on its own,
 * eleven times, is not a list you can pick from.
 */
export function savedLabel(item) {
    const base = item.kind === "imagery" ? "Sat image detection"
              : item.kind === "entity"  ? "Entity"
              : item.kind === "note"    ? "Note"
              : "Signal"
    const where = item.region
        || (item.lat != null && item.lon != null
            ? `${Math.abs(item.lat).toFixed(1)}°${item.lat >= 0 ? "N" : "S"} ${Math.abs(item.lon).toFixed(1)}°${item.lon >= 0 ? "E" : "W"}`
            : null)
    return where ? `${base} (${where})` : base
}
