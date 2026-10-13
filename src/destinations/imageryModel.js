/**
 * imageryModel.js — what the Imagery page says, derived from the scans.
 *
 * A "scan" is a check; a "pass" is an acquisition — one moment the satellite
 * actually photographed the area. Before the scanner learnt to skip passes
 * it already held, one acquisition was stored once per check (fourteen
 * copies of 4 Oct), so the page groups scans by acquisition and shows each
 * pass once, saying how many times it was checked and what triggered it.
 */

/** Detection outline colours, everywhere imagery is drawn: bright enough to
 *  read over water, desert and city at a glance, each drawn over a dark halo. */
export const DET_COLORS = { new: "#FFB300", removed: "#FF3B30", existing: "#00E5FF", expanded: "#FFB300", unconfirmed: "#B8BCC6" }

/**
 * WHAT A DETECTION IS, BY COLOUR (owner, 2026-10-13: "the detector reports
 * dark fields and runways as smoke plumes"). Every detection now carries a
 * class, and the class is the outline's colour wherever imagery detections
 * are drawn; the change against the last pass (new / gone / there before /
 * one model only) is the line's style. Chosen to stay apart over desert,
 * water, city and fields, each drawn over a dark halo.
 */
export const CLASS_COLORS = {
    active_fire: "#FF2D2D",          // red
    burn_scar: "#FF8A00",            // orange
    smoke_plume: "#E6E9EF",          // pale smoke grey
    runway: "#FFE600",               // yellow
    airfield: "#A66BFF",             // violet
    port_infrastructure: "#4D8DFF",  // blue
    storage_tank: "#FF4FD8",         // magenta
    aircraft: "#76FF03",             // lime
    vessel: "#00E5FF",               // cyan
    // the rest: muted, so the classes above stand out
    vehicle: "#C9B48F", bridge: "#9FC79A", structural_change: "#D9A0A0",
    recreation: "#9DB9CC", road_feature: "#B3AC93",
}
const DEFAULT_CLASS_COLOR = "#B8BCC6"

export const CLASS_LABELS = {
    smoke_plume: "Smoke plume", burn_scar: "Burn scar / impact point", active_fire: "Active fire",
    runway: "Runway / landing strip", airfield: "Airfield", port_infrastructure: "Port infrastructure",
    storage_tank: "Storage tank", aircraft: "Aircraft", vessel: "Vessel", vehicle: "Vehicle",
    bridge: "Bridge", structural_change: "Structural change", recreation: "Recreation ground",
    road_feature: "Road feature", cloud: "Cloud", cloud_shadow: "Cloud shadow", field_change: "Field change",
    field: "Field", other: "Other",
}

/** Not findings: the classifier names them so they can be set aside, and an
 *  analyst can answer with them — they are never drawn as detections. */
export const NON_FINDING_CLASSES = new Set(["cloud", "cloud_shadow", "field_change"])

const classOf = (d) => (d && typeof d === "object" ? d.object_type || d.label : d)
export const classColor = (type) => CLASS_COLORS[type] || DEFAULT_CLASS_COLOR
export const classLabel = (type) => CLASS_LABELS[type]
    || (type ? String(type).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Object")
/** Is this detection (or class) a finding worth drawing? */
export const isFindingClass = (d) => !NON_FINDING_CLASSES.has(classOf(d))
export const findingDetections = (list) => (list || []).filter(isFindingClass)

/** The answers an analyst can give to "Not this — it's:". */
export const FEEDBACK_CLASSES = [
    { key: "field", label: "Field" }, { key: "runway", label: "Runway" }, { key: "cloud", label: "Cloud" },
    { key: "cloud_shadow", label: "Shadow" }, { key: "port_infrastructure", label: "Port" },
    { key: "storage_tank", label: "Tanks" }, { key: "aircraft", label: "Aircraft" }, { key: "vessel", label: "Ship" },
    { key: "smoke_plume", label: "Smoke" }, { key: "burn_scar", label: "Burn scar" }, { key: "other", label: "Other" },
]
export const feedbackLabel = (key) => FEEDBACK_CLASSES.find((c) => c.key === key)?.label || classLabel(key)

/** From GET …/feedback's items: the caller's own answer (latest), and how
 *  many other analysts answered. Answers are stored one per user. */
export function feedbackState(items) {
    const list = [...(items || [])].filter(Boolean)
        .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
    const mine = list.find((r) => r.mine) || null
    const others = list.filter((r) => !r.mine)
    return { mine, others: others.length, othersAgree: mine ? others.filter((r) => r.verdict === mine.verdict && r.actual_class === mine.actual_class).length : 0 }
}

/** The classes present in a pass, in legend order (most first). */
export function legendClasses(changes) {
    const n = new Map()
    for (const c of changes || []) {
        const t = classOf(c)
        if (!t || c?.type === "finding" || !isFindingClass(t)) continue
        n.set(t, (n.get(t) || 0) + 1)
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count, label: classLabel(key), color: classColor(key) }))
}

/** The change against the last pass, as a line style (SVG dash array; null = solid). */
export function kindDash(c) {
    if (c?.type === "removed" || c?.doubtful) return "6 4"
    if (c?.type === "unconfirmed" || c?.tier === "probable") return "2 3"
    return null
}

/** Classifier detail from a detection's attributes (object or JSON string),
 *  or from the same fields on the row itself. */
export function classDetail(d) {
    let a = d?.attributes
    if (typeof a === "string") { try { a = JSON.parse(a) } catch { a = null } }
    a = a && typeof a === "object" ? a : {}
    const pick = (k) => a[k] ?? d?.[k] ?? null
    const conf = Number(pick("class_confidence"))
    const reasons = pick("reasons")
    return {
        classConfidence: Number.isFinite(conf) && pick("class_confidence") !== null ? conf : null,
        classifier: pick("classifier"),
        reasons: Array.isArray(reasons) ? reasons.filter((r) => r && r.text) : [],
        description: pick("description"),
        tier: pick("tier"),
    }
}

const SINGULAR = {
    storage_tank: ["storage tank", "storage tanks"], vessel: ["vessel", "vessels"],
    port_infrastructure: ["port structure", "port structures"], aircraft: ["aircraft", "aircraft"],
    vehicle: ["vehicle", "vehicles"], bridge: ["bridge", "bridges"], airfield: ["airfield", "airfields"],
    helicopter: ["helicopter", "helicopters"], large_vehicle: ["large vehicle", "large vehicles"],
    smoke_plume: ["smoke plume", "smoke plumes"], active_fire: ["active fire", "active fires"],
    runway: ["runway", "runways"], burn_scar: ["burn scar", "burn scars"],
}
export function noun(label, n) {
    const [one, many] = SINGULAR[label] || [String(label || "object").replace(/_/g, " "), `${String(label || "object").replace(/_/g, " ")}s`]
    return n === 1 ? one : many
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : null)

/** Scans -> passes, newest first. Failed checks are not passes. */
export function acquisitions(scans) {
    const groups = new Map()
    for (const s of scans || []) {
        if (s?.status !== "completed" || !s.image_timestamp_utc) continue
        // One pass a day per sensor: a change-detection run stores the same
        // acquisition at day precision under its own id.
        const key = `${s.instrument || "OPTICAL"}:${day(s.image_timestamp_utc)}`
        const g = groups.get(key)
        if (!g) {
            groups.set(key, { key, scan: s, scans: [s], triggers: new Set([s.triggered_by]) })
            continue
        }
        g.scans.push(s)
        g.triggers.add(s.triggered_by)
        // Represent the pass by the newest check that still holds the image.
        const better = (s.has_image && !g.scan.has_image)
            || (Boolean(s.has_image) === Boolean(g.scan.has_image) && String(s.created_at) > String(g.scan.created_at))
        if (better || (!g.scan.result_summary?.by_type && s.result_summary?.by_type)) g.scan = s
    }
    return [...groups.values()]
        .map((g) => ({
            key: g.key, scanId: g.scan.scan_id, when: g.scan.image_timestamp_utc,
            instrument: g.scan.instrument || "OPTICAL", cloud: g.scan.cloud_cover_percent,
            byType: g.scan.result_summary?.by_type || {},
            // Counted at all? Older runs stored no summary — unknown, not zero.
            counted: Boolean(g.scans.find((x) => x.result_summary?.by_type)),
            hasImage: Boolean(g.scans.some((x) => x.has_image)),
            checks: g.scans.length, fire: g.triggers.has("firms_fire"),
            triggers: [...g.triggers].filter(Boolean),
        }))
        .sort((a, b) => String(b.when).localeCompare(String(a.when)))
}

/** Per class, the count at each pass, oldest first — for the small charts. */
export function countSeries(passes) {
    const chron = [...(passes || [])].reverse()
    const labels = new Set(chron.flatMap((p) => Object.keys(p.byType || {})))
    return [...labels].map((label) => ({
        label, points: chron.filter((p) => p.counted).map((p) => ({ when: p.when, n: p.byType?.[label] || 0, key: p.key })),
    })).sort((a, b) => Math.max(...b.points.map((x) => x.n)) - Math.max(...a.points.map((x) => x.n)))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const fmtDay = (iso) => {
    const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00Z` : /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    return Number.isNaN(d.getTime()) ? String(iso) : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/**
 * The headline: what changed against the previous pass, in words.
 * counts: [[label, now, delta], ...] from the scene payload.
 */
export function changeHeadline(counts, referenceDate) {
    const rows = (counts || []).filter((r) => Array.isArray(r) && r.length >= 3)
    if (!referenceDate) {
        if (!rows.length) return "First pass over this area — nothing detected yet."
        return `First pass over this area: ${rows.filter((r) => r[1] > 0).map(([l, n]) => `${n} ${noun(l, n)}`).join(", ")}.`
    }
    const since = `Since ${fmtDay(referenceDate)}`
    const moved = rows.filter((r) => r[2] !== 0)
    const still = rows.filter((r) => r[2] === 0 && r[1] > 0)
    if (!moved.length) {
        return still.length ? `${since}: no change — ${still.map(([l, n]) => `${n} ${noun(l, n)}`).join(", ")}, as before.`
                            : `${since}: no change, nothing detected.`
    }
    const parts = moved.map(([l, n, d]) => {
        const a = Math.abs(d)
        return d > 0 ? `${a} more ${noun(l, a)} (${n} now)` : `${a} ${noun(l, a)} fewer (${n} now)`
    })
    const rest = still.length ? `; ${still.map(([l]) => noun(l, 2)).join(" and ")} unchanged` : ""
    return `${since}: ${parts.join(", ")}${rest}.`
}

/** Detections grouped by class, the kinds that changed first. */
export function groupDetections(changes) {
    const m = new Map()
    for (const c of changes || []) {
        const g = m.get(c.label) || { label: c.label, items: [], new: 0, removed: 0 }
        g.items.push(c)
        if (c.type === "new") g.new += 1
        if (c.type === "removed") g.removed += 1
        m.set(c.label, g)
    }
    return [...m.values()].sort((a, b) => (b.new + b.removed) - (a.new + a.removed) || b.items.length - a.items.length)
}

/**
 * Which sensor and pass to open an area on, from its scans.
 *
 * WHY (2026-10-12, "the image sometimes doesn't load"): the page always
 * opened on OPTICAL and picked the newest optical pass — so an area watched
 * by radar only (every border-sweep find, radar-preferred overwatch sites)
 * opened on "This area has not been photographed yet" while its radar passes
 * sat one click away, and an area whose newest optical pass had lost its
 * image opened on an empty frame. Now: the pass asked for (a notification's
 * scan) when it is there; else the newest optical pass that HOLDS an image;
 * else the newest radar pass with an image; else the newest optical pass.
 */
export function pickInitialPass(scans, wantScanId = null) {
    const all = acquisitions(scans)
    if (wantScanId) {
        const hit = all.find((p) => p.scanId === wantScanId)
            || (scans || []).find((s) => s?.scan_id === wantScanId)
        if (hit) {
            const inst = hit.instrument || "OPTICAL"
            // a radar pass without an image (a change run) is not viewable as radar
            const asPass = all.find((p) => p.scanId === wantScanId)
            if (inst === "SAR" && asPass?.hasImage) return { sensor: "radar", scanId: wantScanId }
            if (inst !== "SAR") return { sensor: "optical", scanId: wantScanId }
        }
    }
    const optical = all.filter((p) => p.instrument !== "SAR")
    const radar = all.filter((p) => p.instrument === "SAR" && p.hasImage)
    const opt = optical.find((p) => p.hasImage)
    if (opt) return { sensor: "optical", scanId: opt.scanId }
    if (radar.length) return { sensor: "radar", scanId: radar[0].scanId }
    return { sensor: "optical", scanId: optical[0]?.scanId || null }
}
