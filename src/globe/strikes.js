/**
 * strikes.js — the "Strikes & control" layer's pure parts, shared by the
 * desktop globe (GlobeStrikesLayer.jsx), the layers panel legend and the
 * phone registry (mobile/mapLayers.js). Backend: strike_events.py,
 * GET /api/strikes and /api/strikes/campaigns.
 *
 * ONE GLYPH PER ACT — a bomb for an airstrike, a missile, a delta-wing
 * drone, an artillery shell, a ship, crossed swords, a flag for territory
 * taken, a shield for an interception — drawn in the facility-glyph style
 * (entityIcons.getFacilityMarkerDataUri: a dark disc, a thin ring, a
 * filled glyph, supersampled). COLOUR IS THE ACTOR, the same colour for
 * that actor everywhere. SIZE is what it did (casualties when known).
 * HOLLOW (no disc, dashed ring) is a place known only roughly — an oblast,
 * a governorate, a GeoConfirmed camera position. FADING is age within the
 * event's persistence window (14 days for strikes, 30 for control).
 */
import { MARKER_SUPERSAMPLE } from "./entityIcons.js"

export const STRIKE_ACTS = [
    { key: "airstrike", label: "Airstrike / bombing" },
    { key: "missile", label: "Missile strike" },
    { key: "drone", label: "Drone strike" },
    { key: "shelling", label: "Shelling / artillery" },
    { key: "naval", label: "Naval strike" },
    { key: "assault", label: "Ground assault" },
    { key: "control", label: "Territory taken" },
    { key: "interception", label: "Interception" },
]
export const STRIKE_ACT_KEYS = STRIKE_ACTS.map((a) => a.key)
export const actLabel = (k) => STRIKE_ACTS.find((a) => a.key === k)?.label || k

export const STRIKE_WINDOWS = [
    { key: "24h", label: "24 h", hours: 24 },
    { key: "7d", label: "7 d", hours: 24 * 7 },
    { key: "14d", label: "14 d", hours: 24 * 14 },
    { key: "30d", label: "30 d", hours: 24 * 30 },
]

// ── colour by actor ─────────────────────────────────────────────────────
// Fixed for the actors that matter, so "Houthi orange" means the same
// thing on every screen; anything else hashes into a spare palette.
export const ACTOR_COLOR = {
    "Saudi-led coalition": "#22C55E",
    "UAE": "#4ADE80",
    "Yemeni government forces": "#86EFAC",
    "Houthis": "#F97316",
    "Israel": "#3B82F6",
    "Hezbollah": "#EAB308",
    "Hamas": "#10B981",
    "Palestinian Islamic Jihad": "#34D399",
    "Iran": "#A855F7",
    "United States": "#60A5FA",
    "United Kingdom": "#93C5FD",
    "Russia": "#EF4444",
    "Ukraine": "#FACC15",
    "RSF": "#F59E0B",
    "Sudanese Armed Forces": "#14B8A6",
    "Islamic State": "#CBD5E1",
}
export const UNKNOWN_ACTOR_COLOR = "#9CA3AF"
const SPARE = ["#F472B6", "#38BDF8", "#C084FC", "#FB7185", "#2DD4BF", "#FDE047", "#A3E635", "#FDBA74"]

export function actorColor(actor) {
    if (!actor) return UNKNOWN_ACTOR_COLOR
    if (ACTOR_COLOR[actor]) return ACTOR_COLOR[actor]
    let h = 0
    for (const ch of String(actor)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return SPARE[h % SPARE.length]
}

// ── glyphs ──────────────────────────────────────────────────────────────
// Each draws inside a px×px box centred on (c, c), radius r ≈ a third.
const GLYPH = {
    // a round bomb with its fuse and a spark
    airstrike: (px) => {
        const c = px / 2, r = px * 0.3
        return `<circle cx="${c - r * 0.12}" cy="${c + r * 0.2}" r="${r * 0.68}"/>`
            + `<rect x="${c + r * 0.12}" y="${c - r * 0.62}" width="${r * 0.36}" height="${r * 0.42}" transform="rotate(40 ${c + r * 0.3} ${c - r * 0.41})"/>`
            + `<path d="M ${c + r * 0.42} ${c - r * 0.66} Q ${c + r * 0.62} ${c - r * 1.02} ${c + r * 0.95} ${c - r * 0.9}" fill="none" stroke-width="${px * 0.045}"/>`
            + `<circle cx="${c + r * 0.98}" cy="${c - r * 0.92}" r="${r * 0.16}"/>`
    },
    // a missile, nose up-right, with fins
    missile: (px) => {
        const c = px / 2, r = px * 0.34
        return `<path transform="rotate(45 ${c} ${c})" d="M ${c} ${c - r} L ${c + r * 0.2} ${c - r * 0.6} L ${c + r * 0.2} ${c + r * 0.45} `
            + `L ${c + r * 0.48} ${c + r * 0.95} L ${c - r * 0.48} ${c + r * 0.95} L ${c - r * 0.2} ${c + r * 0.45} L ${c - r * 0.2} ${c - r * 0.6} Z"/>`
    },
    // a delta-wing one-way drone (the Shahed planform)
    drone: (px) => {
        const c = px / 2, r = px * 0.32
        return `<path d="M ${c} ${c - r} L ${c + r} ${c + r * 0.62} L ${c + r * 0.2} ${c + r * 0.36} L ${c} ${c + r * 0.72} `
            + `L ${c - r * 0.2} ${c + r * 0.36} L ${c - r} ${c + r * 0.62} Z"/>`
    },
    // an artillery shell: ogive nose, body, driving band
    shelling: (px) => {
        const c = px / 2, r = px * 0.34, w = r * 0.36
        return `<path d="M ${c - w} ${c + r * 0.75} L ${c - w} ${c - r * 0.15} Q ${c - w} ${c - r * 0.85} ${c} ${c - r} `
            + `Q ${c + w} ${c - r * 0.85} ${c + w} ${c - r * 0.15} L ${c + w} ${c + r * 0.75} Z"/>`
            + `<rect x="${c - w * 1.18}" y="${c + r * 0.8}" width="${w * 2.36}" height="${r * 0.22}" rx="${r * 0.05}"/>`
    },
    // a warship in profile
    naval: (px) => {
        const c = px / 2, r = px * 0.34
        return `<path d="M ${c - r} ${c + r * 0.15} L ${c + r} ${c + r * 0.15} L ${c + r * 0.62} ${c + r * 0.7} L ${c - r * 0.62} ${c + r * 0.7} Z"/>`
            + `<rect x="${c - r * 0.42}" y="${c - r * 0.3}" width="${r * 0.7}" height="${r * 0.42}"/>`
            + `<rect x="${c - r * 0.1}" y="${c - r * 0.8}" width="${r * 0.12}" height="${r * 0.5}"/>`
    },
    // crossed swords (the facility "military" glyph, with hilts)
    assault: (px) => {
        const c = px / 2, r = px * 0.33, w = px * 0.075
        const blade = (deg) => `<rect x="${c - w / 2}" y="${c - r}" width="${w}" height="${r * 2}" transform="rotate(${deg} ${c} ${c})"/>`
            + `<rect x="${c - w * 2}" y="${c + r * 0.45}" width="${w * 4}" height="${w}" transform="rotate(${deg} ${c} ${c})"/>`
        return blade(45) + blade(-45)
    },
    // a flag on a pole: ground taken
    control: (px) => {
        const c = px / 2, r = px * 0.34
        return `<rect x="${c - r * 0.62}" y="${c - r}" width="${r * 0.16}" height="${r * 2}"/>`
            + `<path d="M ${c - r * 0.48} ${c - r} L ${c + r * 0.85} ${c - r * 0.55} L ${c - r * 0.48} ${c - r * 0.08} Z"/>`
    },
    // a shield: something stopped in the air
    interception: (px) => {
        const c = px / 2, r = px * 0.33
        return `<path d="M ${c} ${c - r} L ${c + r * 0.85} ${c - r * 0.55} L ${c + r * 0.85} ${c + r * 0.1} `
            + `Q ${c + r * 0.85} ${c + r * 0.8} ${c} ${c + r} Q ${c - r * 0.85} ${c + r * 0.8} ${c - r * 0.85} ${c + r * 0.1} `
            + `L ${c - r * 0.85} ${c - r * 0.55} Z"/>`
    },
}

/** The glyph an act draws with (unknown → the bomb). */
export function glyphFor(act) {
    return GLYPH[act] ? act : "airstrike"
}

const _cache = new Map()

/**
 * A crisp marker for one event. `hollow` = low-precision place;
 * `opacity` is quantised to tenths so the cache stays small.
 */
export function strikeIconUri({ act = "airstrike", color = UNKNOWN_ACTOR_COLOR, size = 22, hollow = false, opacity = 1 } = {}) {
    const op = Math.max(0.1, Math.min(1, Math.round((Number(opacity) || 1) * 10) / 10))
    const key = `${glyphFor(act)}:${color}:${size}:${hollow}:${op}`
    if (_cache.has(key)) return _cache.get(key)
    const px = size * MARKER_SUPERSAMPLE
    const ring = 1.4 * MARKER_SUPERSAMPLE
    const disc = hollow
        ? `<circle cx="${px / 2}" cy="${px / 2}" r="${px * 0.44}" fill="#0B0F1A" fill-opacity="0.25" stroke="${color}" stroke-width="${ring}" stroke-dasharray="${px * 0.09} ${px * 0.06}"/>`
        : `<circle cx="${px / 2}" cy="${px / 2}" r="${px * 0.44}" fill="#0B0F1A" fill-opacity="0.8" stroke="${color}" stroke-width="${ring}"/>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" opacity="${op}">`
        + disc
        + `<g fill="${hollow ? "none" : color}" stroke="${color}" stroke-width="${(hollow ? 1.1 : 0.4) * MARKER_SUPERSAMPLE}" stroke-linejoin="round">${GLYPH[glyphFor(act)](px)}</g>`
        + `</svg>`
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    _cache.set(key, uri)
    return uri
}

/** Marker size by what the event did: casualties when known. */
export function strikeSize(e) {
    const c = e?.casualties
    const n = c ? (Number(c.killed) || 0) + (Number(c.injured) || 0) * 0.5 : 0
    const base = e?.act === "control" ? 24 : 20
    if (n >= 100) return base + 12
    if (n >= 20) return base + 8
    if (n >= 5) return base + 5
    if (n >= 1) return base + 2
    return base
}

export const isHollow = (e) => e?.precision === "region"

/**
 * Age → opacity within the event's window: 1 when new, 0.25 at the end of
 * its window, measured from `atMs` (the time strip's playhead, or now).
 */
export function strikeOpacity(e, atMs = Date.now()) {
    const t = Date.parse(e?.time)
    const win = (Number(e?.window_days) || 14) * 86400e3
    if (!Number.isFinite(t)) return 0.5
    const age = Math.max(0, atMs - t)
    return Math.max(0.25, 1 - 0.75 * Math.min(1, age / win))
}

/**
 * Is the event on the map at `atMs`? It must have happened by then, be
 * within its own persistence window, and within the chosen time chip.
 */
export function visibleAt(e, atMs = Date.now(), windowHours = 24 * 14) {
    const t = Date.parse(e?.time)
    if (!Number.isFinite(t) || t > atMs) return false
    const ownH = (Number(e?.window_days) || 14) * 24
    return atMs - t <= Math.min(ownH, windowHours) * 3600e3
}

export function filterStrikes(events, { acts = STRIKE_ACT_KEYS, atMs = Date.now(), windowHours = 24 * 14 } = {}) {
    const on = new Set(acts)
    return (Array.isArray(events) ? events : []).filter((e) =>
        on.has(e.act) && Number.isFinite(+e.lat) && Number.isFinite(+e.lon) && visibleAt(e, atMs, windowHours))
}

/** One line for a card: who did what where, when, how many reports. */
export function strikeSummary(e, campaign = null) {
    const what = e.act === "airstrike" && e.weapon_stated === false ? "Strike (weapon not stated)" : actLabel(e.act)
    const bits = [
        `${what}${e.actor ? ` by ${e.actor}` : ""}${e.target_name ? ` — ${String(e.target_name).split(",").slice(0, 2).join(",")}` : ""}.`,
        e.casualties ? `${e.casualties.killed || 0} killed, ${e.casualties.injured || 0} injured reported.` : null,
        e.source_count > 1 ? `${e.source_count} reports merged.` : null,
        e.precision === "region" ? "Place known only roughly." : null,
        campaign ? `Part of ${campaign.title}: ${campaign.count} events, ${dayLabel(campaign.first)}–${dayLabel(campaign.last)}.` : null,
    ]
    return bits.filter(Boolean).join(" ")
}

export function dayLabel(iso) {
    const d = new Date(iso)
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : ""
}

// ── the chosen time window and acts, shared by the panel and the layers ──
// Module state + localStorage, so the desktop panel, the globe layer and
// the phone Filters sheet read one value without threading props through
// Situation and GlobeView.
const LS_WIN = "plx.strikes.window"
const LS_ACTS = "plx.strikes.acts"
const _read = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }
let _settings = {
    window: STRIKE_WINDOWS.some((w) => w.key === _read(LS_WIN, "14d")) ? _read(LS_WIN, "14d") : "14d",
    acts: (() => { const a = _read(LS_ACTS, null); return Array.isArray(a) ? a.filter((k) => STRIKE_ACT_KEYS.includes(k)) : STRIKE_ACT_KEYS })(),
}
const _subs = new Set()
const _emit = () => _subs.forEach((fn) => fn(_settings))

export function strikeSettings() { return _settings }
export function strikeWindowKey() { return _settings.window }
export function strikeWindowHours(key = _settings.window) {
    return (STRIKE_WINDOWS.find((w) => w.key === key) || STRIKE_WINDOWS[2]).hours
}
export function setStrikeWindow(key) {
    if (!STRIKE_WINDOWS.some((w) => w.key === key)) return
    _settings = { ..._settings, window: key }
    try { localStorage.setItem(LS_WIN, JSON.stringify(key)) } catch { /* private window */ }
    _emit()
}
export function toggleStrikeAct(key) {
    if (!STRIKE_ACT_KEYS.includes(key)) return
    const on = _settings.acts.includes(key)
    _settings = { ..._settings, acts: on ? _settings.acts.filter((k) => k !== key) : [..._settings.acts, key] }
    try { localStorage.setItem(LS_ACTS, JSON.stringify(_settings.acts)) } catch { /* private window */ }
    _emit()
}
export function subscribeStrikeSettings(fn) { _subs.add(fn); return () => _subs.delete(fn) }

/** The URL the layers fetch: the whole 30-day window once, filtered client-side. */
export function strikesUrl(base, { bbox = null, since = "30d" } = {}) {
    const q = new URLSearchParams({ since })
    if (bbox) q.set("bbox", bbox.map((v) => Number(v).toFixed(2)).join(","))
    return `${base}/api/strikes?${q}`
}
