/**
 * theaterScope.js — what a theater is ABOUT, in one place.
 *
 * A theater already carries where the camera goes and which map layers
 * belong to it (see app.jsx). This adds the third thing it needs: which
 * countries it covers. Insight uses that to decide which forecast boards
 * are relevant to the theater you are standing in.
 *
 * WHY IT IS A LIST OF NAMES AND NOT ISO CODES. The forecast boards are
 * built on UCDP's country vocabulary, which carries its own historical
 * spellings — "Yemen (North Yemen)", "DR Congo (Zaire)", "Russia (Soviet
 * Union)". Matching on ISO would mean maintaining a second mapping that
 * silently drops exactly those rows, so the match is on the board's own
 * names, with `aliases` carrying the variants. A board that matches
 * nothing is still shown; it is just not promoted.
 */

export const THEATER_SCOPE = {
    redsea: {
        label: "Red Sea watch",
        blurb: "Bab el-Mandeb and the approaches: the Yemeni coast, the Horn, and the Sudanese and Egyptian shores.",
        countries: ["Yemen", "Somalia", "Sudan", "Ethiopia", "Eritrea", "Djibouti", "Egypt", "Saudi Arabia"],
    },
    hormuz: {
        label: "Hormuz transit",
        blurb: "The Gulf and its only way out: Iranian littoral, the Arabian shore, and the Iraqi north.",
        countries: ["Iran", "Iraq", "Oman", "United Arab Emirates", "Saudi Arabia", "Kuwait", "Qatar", "Bahrain"],
    },
    taiwan: {
        label: "Taiwan Strait",
        blurb: "The strait and the first island chain, from the Philippine approaches to the East China Sea.",
        countries: ["China", "Taiwan", "Philippines", "Japan", "Vietnam", "Indonesia", "Myanmar"],
    },
}

/** UCDP spellings → the plain name a theater lists. */
const ALIAS = {
    "yemen (north yemen)": "Yemen",
    "dr congo (zaire)": "DR Congo",
    "russia (soviet union)": "Russia",
    "myanmar (burma)": "Myanmar",
    "serbia (yugoslavia)": "Serbia",
    "cambodia (kampuchea)": "Cambodia",
    "zimbabwe (rhodesia)": "Zimbabwe",
}

/** The country a forecast board is about, normalised. */
export function boardCountry(board) {
    const q = board?.question || board?.name || ""
    const m = /violence in (.+?) escalate/i.exec(q)
    const raw = (m ? m[1] : board?.country || board?.name || "").trim()
    return ALIAS[raw.toLowerCase()] || raw
}

/**
 * Split boards into the ones this theater is about and the rest.
 * An unknown theater returns everything as `other`, which is the honest
 * answer: no claim of relevance is better than a guessed one.
 */
export function splitByTheater(boards, theaterKey) {
    const scope = THEATER_SCOPE[theaterKey]
    const names = new Set((scope?.countries || []).map((c) => c.toLowerCase()))
    const inScope = [], other = []
    for (const b of boards || []) {
        ;(names.has(boardCountry(b).toLowerCase()) ? inScope : other).push(b)
    }
    return { scope, inScope, other }
}
