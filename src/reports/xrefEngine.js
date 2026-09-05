// xrefEngine.js — real, deterministic .xref wrapping over already-compiled
// briefing text (rework build spec §A1). The drafting step (report_draft.py,
// a real Claude call or the deterministic fallback templates) never emits
// markup — nothing forces it to. So this module never trusts the model to
// mark up its own citations: it scans the COMPILED text for real, already-
// known identifiers/labels (GET /api/reports/{id}/xref-index's real
// signals/scenes/nodes, plus each region name DocumentRenderer already
// computes for real from claim lat/lon) and wraps only genuine matches.
//
// A reference that looks real (matches a known ID shape) but isn't part of
// this document's real evidence set is never wrapped — see
// checkForUnwrappedReferences() below, which logs a real warning instead.

const ID_PATTERN_HINTS = [
    /\bALT-[0-9A-F]{6,10}\b/gi,
    /\bDET-[0-9A-F]{4,10}\b/gi,
    /\bFUS-[0-9A-F]{6,10}\b/gi,
    /\bSUR-[0-9A-F]{6,10}\b/gi,
    /\bHW-\d{3,6}\b/gi,
    /\bSCN-\d{2,6}\b/gi,
]

const MIN_LABEL_LEN = 4

function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/**
 * Flat, longest-label-first candidate list from the real xref index plus
 * real region names — longest-first so e.g. "Horn of Africa" wins over a
 * shorter label that happens to be its substring.
 * @param {{signals?:Array, scenes?:Array, nodes?:Array}} xrefIndex
 * @param {string[]} regionNames
 */
export function buildXrefCandidates(xrefIndex, regionNames = []) {
    const out = []
    const seen = new Set()
    function push(k, id, label, record) {
        if (!label || label.length < MIN_LABEL_LEN) return
        const dedupeKey = `${k}:${label.toLowerCase()}`
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        out.push({ k, id, label, record })
    }
    for (const s of xrefIndex?.signals || []) push("signal", s.id, s.label, s)
    for (const s of xrefIndex?.scenes || []) push("scene", s.id, s.label, s)
    for (const n of xrefIndex?.nodes || []) push("node", n.id, n.label, n)
    for (const r of regionNames) push("region", r, r, { region: r })
    out.sort((a, b) => b.label.length - a.label.length)
    return out
}

/**
 * Wrap real matches of `candidates` inside `text`, returning a real HTML
 * string with `<span class="xref" data-k="..." data-id="...">` around each
 * match — case-insensitive, longest-candidate-wins, no overlapping wraps.
 * Everything else is HTML-escaped (this text ultimately comes from a Claude
 * completion — escaped before ever reaching dangerouslySetInnerHTML).
 */
export function wrapXrefsHtml(text, candidates) {
    const raw = String(text ?? "")
    if (!raw) return ""
    const escapedLabels = candidates.map((c) => c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean)
    if (!escapedLabels.length) return escapeHtml(raw)
    const re = new RegExp(`(${escapedLabels.join("|")})`, "gi")
    const byLabelLower = new Map(candidates.map((c) => [c.label.toLowerCase(), c]))

    let out = ""
    let lastIndex = 0
    let match
    while ((match = re.exec(raw)) !== null) {
        const matchedText = match[0]
        const cand = byLabelLower.get(matchedText.toLowerCase())
        if (cand) {
            out += escapeHtml(raw.slice(lastIndex, match.index))
            out += `<span class="xref" data-k="${escapeHtml(cand.k)}" data-id="${escapeHtml(cand.id)}">${escapeHtml(matchedText)}</span>`
            lastIndex = match.index + matchedText.length
        }
        if (re.lastIndex === match.index) re.lastIndex += 1 // guard against zero-length-match infinite loop
    }
    out += escapeHtml(raw.slice(lastIndex))
    return out
}

/**
 * Real hallucination guard — logs a console warning (never a fabricated UI
 * error toast, since this is a developer/analyst-facing content-validation
 * signal, not a user-facing failure) for any text mentioning what looks
 * like a real signal/scene/fusion id that isn't actually part of this
 * document's real evidence set.
 */
export function checkForUnwrappedReferences(text, candidates, docLabel = "") {
    const raw = String(text ?? "")
    if (!raw) return
    const knownIds = new Set(candidates.map((c) => String(c.id).toLowerCase()))
    for (const pattern of ID_PATTERN_HINTS) {
        pattern.lastIndex = 0
        let m
        while ((m = pattern.exec(raw)) !== null) {
            if (!knownIds.has(m[0].toLowerCase())) {
                console.warn(
                    `[xref-validation]${docLabel ? " " + docLabel : ""}: drafted text references "${m[0]}" `
                    + "which is not part of this document's real evidence set — not wrapped as a clickable reference."
                )
            }
        }
    }
}
