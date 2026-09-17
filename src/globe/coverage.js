/**
 * coverage.js — PARALLAX §13. The only layer that draws what we CANNOT know.
 *
 * "'Press only' is the dangerous state, not 'blind'. Blind is obvious and an
 * analyst treats it with suspicion. Press-only LOOKS like coverage, REPORTS
 * like coverage, and means 'we would find out if a journalist happened to
 * write about it'."
 *
 * The other half of the rule is the class gate: only origin classes A and B
 * count toward instrumented coverage. "A cell reached solely by class-D
 * reporting is not covered, it is rumoured."
 */

export const STATE = {
    instrumented: {
        key: "instrumented", color: "var(--green)", fill: null,
        label: "Instrumented",
        meaning: "Two or more instrument modalities, with a standing task over the cell.",
    },
    archive: {
        key: "archive", color: "var(--steel)", fill: "var(--tr16)",
        label: "Archive only",
        meaning: "The imagery exists and nobody is looking. Discoverable after the fact, not detectable now.",
    },
    presswatch: {
        key: "presswatch", color: "var(--amber)", fill: "var(--tr14)",
        label: "Press only",
        meaning: "The only thing that reaches here is open reporting. It looks like coverage and reports like coverage, and means we would find out if a journalist happened to write about it.",
    },
    blind: {
        key: "blind", color: "var(--red)", fill: "var(--tr19)",
        label: "Blind",
        meaning: "Nothing reaches this cell. Absence of signal carries no information.",
    },
}

/**
 * The modalities, with the origin class each one actually is.
 *
 * `press` is class D and is the whole point of the table: it is listed so it
 * can be EXCLUDED from the instrument count, not so it can pad it.
 */
export const MOD = {
    sar:   { cls: "A", label: "SAR" },
    opt:   { cls: "A", label: "Optical" },
    atmo:  { cls: "A", label: "Atmospheric" },
    therm: { cls: "A", label: "Thermal" },
    ais:   { cls: "B", label: "AIS" },
    adsb:  { cls: "A", label: "ADS-B" },
    net:   { cls: "A", label: "Network" },
    press: { cls: "D", label: "Press" },
}

/** §13's cell size — deliberately coarse; coverage is a regional question. */
export const CELL_DEG = 10

export const cellKey = (lat, lon) =>
    `${Math.floor(lat / CELL_DEG) * CELL_DEG}:${Math.floor(lon / CELL_DEG) * CELL_DEG}`

export function cellBounds(key) {
    const [south, west] = key.split(":").map(Number)
    return { south, west, north: south + CELL_DEG, east: west + CELL_DEG }
}

/**
 * §13's classifier, verbatim:
 *
 *   const instr = Object.keys(mods).filter(k => MOD[k].cls!=='D' && mods[k]>=.5).length
 *   const state = instr>=2 ? 'instrumented' : anyInstr ? 'archive'
 *               : mods.press>=.3 ? 'presswatch' : 'blind'
 *
 * `mods` maps a modality key to a 0-1 strength.
 */
export function classify(mods = {}, { tasked = false } = {}) {
    const instrumentKeys = Object.keys(mods).filter(
        (k) => MOD[k] && MOD[k].cls !== "D" && mods[k] >= 0.5,
    )
    const instr = instrumentKeys.length
    const anyInstr = Object.keys(mods).some((k) => MOD[k] && MOD[k].cls !== "D" && mods[k] > 0)

    // §13's own wording is "two or more instrument modalities, WITH A STANDING
    // TASK over the cell" — two feeds that nobody has pointed at anything are
    // an archive, not a watch. The classifier line in the spec drops the task
    // term; it is kept here because "instrumented" is the one state that
    // claims someone would notice, and that claim needs the task behind it.
    if (instr >= 2 && tasked) return STATE.instrumented
    if (instr >= 1 || anyInstr) return STATE.archive
    if ((mods.press || 0) >= 0.3) return STATE.presswatch
    return STATE.blind
}

/** §13 draws the GAPS by default. "Rendering what works is decoration;
 *  rendering what does not is the product." */
export const isGap = (state) => state.key !== "instrumented"

/**
 * §13's closing requirement: "The panel must end in a list of your assets you
 * cannot see, sorted by fewest instruments. A coverage map that does not end
 * in that list is wallpaper."
 */
export function underCoveredAssets(assets, cellStates) {
    return (assets || [])
        .map((a) => {
            const lat = a.lat ?? a.latitude
            const lon = a.lon ?? a.longitude ?? a.lng
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
            const cell = cellStates[cellKey(lat, lon)]
            if (!cell) return { asset: a, instruments: 0, tag: "none", state: STATE.blind }
            return {
                asset: a,
                instruments: cell.instruments,
                tag: cell.instruments === 0 ? "none" : "thin",
                state: cell.state,
            }
        })
        .filter((r) => r && r.state.key !== "instrumented")
        .sort((a, b) => a.instruments - b.instruments)
}

/** §13's per-cell note, which changes with the instrument count. */
export function scoreNote(instr) {
    if (instr >= 2) return "Two independent instruments agree here, so a score computed for this cell rests on corroboration rather than on one feed."
    if (instr === 1) return "One instrument reaches this cell. A score here rests on a single feed, and an outage in that feed is indistinguishable from a quiet week."
    return "No instrument reaches this cell. Any score computed here is a statement about reporting, not about the world."
}
