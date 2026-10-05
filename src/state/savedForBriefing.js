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

/**
 * Also file it in the open case, under Signals/<type> or Screenshots/<type>.
 *
 * Deliberately not awaited and deliberately silent on failure. The saved
 * pane is the thing the user just acted on and it must update at once; the
 * case copy is the durable record and can land a moment later. A case that
 * is unreachable must not make the save itself appear to fail — the item is
 * already in the pane either way, and a red toast for a background copy
 * teaches people that saving is unreliable when it is not.
 */

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
        // WHAT THE THING ACTUALLY SAYS. This used to keep a label and a
        // coordinate pair, which produced sidebar entries reading "Signal
        // (50.5N 30.4E)" — true, and useless to write from. A saved item
        // has to carry the report: the headline, where it happened, who
        // reported it and when.
        label: item.label || item.id,
        headline: item.headline || null,
        region: item.region || null,
        source: item.source || null,
        severity: item.severity || null,
        // THE SECTOR IS CARRIED, NOT RE-DERIVED. filing.js works it out
        // from the record as it then was — domain, source, kind — and this
        // cache keeps only a thinned copy of that record. Dropping the
        // sector here (which it did) meant the picker had to guess it back
        // from four fields that are no longer present, and everything
        // saved from the map landed in "Other".
        sector: item.sector || null,
        urgency: item.urgency || item.severity || null,
        when: item.when || null,
        url: item.url || null,
        context: item.context || null,
        lat: item.lat ?? null,
        lon: item.lon ?? null,
        imageUrl: item.imageUrl || null,
        detail: item.detail || null,
        savedAt: Date.now(),
    }, ...now].slice(0, 120)   // a sidebar, not an archive
    updateSetting("savedForBriefing", next)
    /* FILING IS NOT THIS STORE'S JOB ANY MORE. state/filing.js owns it,
       because it is the one place that knows the theater and can create
       the case. Calling it from here as well filed everything twice —
       once without a theater, into whatever case happened to be last
       used. This function is the local cache; nothing else. */
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
/**
 * What the item reads as in the sidebar and on the page.
 *
 * The headline first, always, when there is one — "Russian strike on a
 * business centre in Kyiv" is what you are writing about; "Signal
 * (50.5°N 30.4°E)" is a grid reference that happens to be attached to it.
 * The generic form is only for items that genuinely have no text.
 */
export function savedLabel(item) {
    if (item.headline) return item.headline

    /* THEN THE LABEL, WHICH IS WHERE THE SENTENCE ACTUALLY IS.
       Every caller of addToBriefing() passes the record's own title as the
       label — "Sanctioned vessel VEGA in the Baltic Sea", "Protests mark
       President Naqi's 1st visit". Only a handful also pass a `headline`
       in `extra`, so this fell through to the generic for nearly
       everything and the sidebar read "Signal (50.5°N 30.4°E)" — a line
       you cannot write a briefing from, which is the one job it has.

       The id is excluded explicitly: saveForBriefing stores `label ||
       id`, so an item saved without a label would otherwise put a uuid on
       screen, which is worse than the generic. */
    if (item.label && item.label !== item.id) return item.label

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

/** The attribution line under a saved item: where, who, when. */
export function savedMeta(item) {
    const where = item.region
        || (item.lat != null && item.lon != null
            ? `${Math.abs(item.lat).toFixed(2)}°${item.lat >= 0 ? "N" : "S"} ${Math.abs(item.lon).toFixed(2)}°${item.lon >= 0 ? "E" : "W"}`
            : null)
    const when = item.when ? String(item.when).slice(0, 10) : null
    // Source last and lower-cased: it is provenance, not the headline.
    return [where, when, item.source].filter(Boolean).join(" · ")
}
