/**
 * filingCase.js — which case the things you keep get filed into.
 *
 * Saving from the map, or taking a screenshot, used to drop the item into
 * one flat list of 120 entries held in a settings blob. That list is a
 * scratchpad: it is capped, it is not part of any record, and a week later
 * nothing in it can be found. Anything worth keeping belongs in a case.
 *
 * So there is one remembered case that new items file into. It is set when
 * you open a case, and the save path uses it silently — a save that stops
 * to ask "which case?" every time is a save people stop doing.
 *
 * If nothing is set, items still go to the scratchpad, because losing a
 * capture because no case was open would be worse than filing it loosely.
 */

import { getSettings, updateSetting } from "./settingsStore.js"

const KEY = "filingCaseId"

/** The case new signals and screenshots file into, or null. */
export function getFilingCase() {
    const v = getSettings()?.[KEY]
    return typeof v === "string" && v ? v : null
}

/** Remember a case as the filing target. Called when a case is opened. */
export function setFilingCase(caseId) {
    updateSetting(KEY, typeof caseId === "string" && caseId ? caseId : null)
}

/**
 * What kind of thing this is, for the folder it lands in.
 *
 * The server owns the taxonomy and maps these to folder names; this only
 * has to say what the item IS. Derived from the item's own fields rather
 * than from whatever screen was open, because a vessel saved from the
 * Inbox is still a vessel.
 */
export function categoryOf(item) {
    if (!item) return "other"
    const hay = `${item.kind || ""} ${item.source || ""} ${item.entity_type || ""}`.toLowerCase()
    for (const key of ["fusion", "surge", "geoconfirmed", "confirm", "gdelt",
                       "sentinel", "detection", "imagery", "firms", "fires",
                       "adsb", "aircraft", "ais", "vessel", "zone"]) {
        if (hay.includes(key)) return key
    }
    return item.kind || "other"
}
