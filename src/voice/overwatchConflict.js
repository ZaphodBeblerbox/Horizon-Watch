/**
 * overwatchConflict.js — which conflict a spoken sentence names.
 *
 * The ids are backend/seed/conflicts.json's; the aliases mirror ALIASES in
 * backend/overwatch.py, which validates again on the server (an id the
 * server does not know is refused there, never guessed at). Kept here so
 * the rule parser stays synchronous and offline.
 */

export const CONFLICT_ALIASES = {
    ukraine: ["ukraine", "russia ukraine war", "russia ukraine", "ukraine war", "war in ukraine", "ukrainian war",
              "russo ukrainian war", "donbas", "donbass"],
    gaza: ["gaza", "israel hamas", "hamas", "gaza war", "palestine"],
    lebanon: ["lebanon", "hezbollah", "israel hezbollah"],
    yemen: ["yemen", "red sea", "houthis", "houthi"],
    sudan: ["sudan", "sudan war", "sudan civil war", "rsf"],
    sahel: ["sahel", "mali", "burkina faso", "niger"],
    drc: ["drc", "congo", "dr congo", "eastern congo", "m23"],
    somalia: ["somalia", "al shabaab"],
    ethiopia: ["ethiopia", "eritrea", "amhara", "tigray"],
    myanmar: ["myanmar", "burma"],
    syria: ["syria"],
    israel_iran: ["israel iran", "iran"],
    haiti: ["haiti"],
    nigeria: ["nigeria", "boko haram"],
    mozambique: ["mozambique", "cabo delgado"],
    libya: ["libya"],
    pakistan: ["pakistan", "afghanistan", "afghan border"],
    kashmir: ["kashmir", "india pakistan"],
    colombia: ["colombia"],
    mexico: ["mexico", "cartels", "cartel war"],
    cameroon: ["cameroon", "anglophone crisis"],
    south_sudan: ["south sudan"],
}

const clean = (s) => String(s || "").toLowerCase().replace(/[–—-]/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()

/** The conflict id named in a sentence, the longest alias winning
 *  ("south sudan" over "sudan"), or null. */
export function conflictFromText(text) {
    const t = ` ${clean(text)} `
    let best = null
    for (const [id, names] of Object.entries(CONFLICT_ALIASES)) {
        for (const n of names) {
            if (t.includes(` ${n} `) && (!best || n.length > best.len)) best = { id, len: n.length }
        }
    }
    return best?.id || null
}

export const CONFLICT_NAME = {
    ukraine: "Ukraine", gaza: "Gaza", lebanon: "Lebanon", yemen: "Yemen", sudan: "Sudan", sahel: "the Sahel",
    drc: "DR Congo", somalia: "Somalia", ethiopia: "Ethiopia", myanmar: "Myanmar", syria: "Syria",
    israel_iran: "Israel–Iran", haiti: "Haiti", nigeria: "Nigeria", mozambique: "Mozambique", libya: "Libya",
    pakistan: "Pakistan", kashmir: "Kashmir", colombia: "Colombia", mexico: "Mexico", cameroon: "Cameroon",
    south_sudan: "South Sudan",
}
