/**
 * strikes.js — the "Strikes & control" layer's pure parts, shared by the
 * desktop globe (GlobeStrikesLayer.jsx), the layers panel legend and the
 * phone registry (mobile/mapLayers.js). Backend: strike_events.py,
 * GET /api/strikes and /api/strikes/campaigns.
 *
 * ONE GLYPH PER ACT — a bomb for an airstrike, a missile, a delta-wing
 * drone, an artillery shell, a ship, crossed swords, a flag for territory
 * taken, a shield for an interception — inside the one typology's circle
 * (lib/mapIcons.js: a strike is a reported event). COLOUR is the priority
 * for you; the ACTOR's colour stays on lines, areas and in the card. One
 * constant size (what it did is in the card). A place known only roughly
 * (an oblast, a governorate, a GeoConfirmed camera position) is drawn
 * uncorroborated-style. FADING is age within the event's persistence window
 * (14 days for strikes, 30 for control), through the marker's opacity.
 */
import { markerUri, ICON_PX, PRIORITY } from "../lib/mapIcons.js"

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

// ── icons ───────────────────────────────────────────────────────────────
// The act's glyph (24-unit grid); the map draws it through lib/mapIcons.js GLYPH (same keys).
export const STRIKE_GLYPH = {
    // an aerial bomb falling nose-down, with its tail fins
    airstrike: "M12 22c-2.9 0-4.6-2.7-4.6-6.6S9.1 8.2 12 8.2s4.6 3.3 4.6 7.2S14.9 22 12 22zM9.4 8.7 8 3h8l-1.4 5.7M12 3v5.2",
    // a missile climbing to the upper right, fins at the tail
    missile: "M20.5 3.5c-3.2.2-6 1.6-8.2 3.8L7.8 11.8l4.4 4.4 4.5-4.5c2.2-2.2 3.6-5 3.8-8.2zM7.8 11.8 4.5 11 3 12.5l3.3 1.7M12.2 16.2l.8 3.3-1.5 1.5-1.7-3.3M15 9h.01M6.3 17.7l-2.3 2.3",
    // a delta-wing one-way attack drone (the Shahed/Geran planform), seen from above
    drone: "M12 2.5 21 18.5l-6.3-1.8L12 21l-2.7-4.3L3 18.5zM12 2.5v14.2",
    // an artillery shell: ogive nose, body, driving band, base
    shelling: "M9 21V10.5C9 7 10.3 4.4 12 2.5c1.7 1.9 3 4.5 3 8V21zM7.5 21h9M9 14.5h6M9 17h6",
    // a warship in profile: hull, superstructure, mast and a gun
    naval: "M2 15.5h20l-3 4.5H5zM5 15.5V12h10v3.5M8 12V8.5h4V12M10 8.5V4M15 13l5-2.5",
    // crossed swords: a ground assault
    assault: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2",
    // a flag planted on a pole: ground taken
    control: "M5.5 22V2.5M5.5 3.5h12.5l-2.8 4.3 2.8 4.2H5.5",
    // a shield with a tick: something stopped in the air
    interception: "M12 22s8-3.8 8-10V5.2L12 2 4 5.2V12c0 6.2 8 10 8 10zM8.6 12.2l2.4 2.4 4.6-4.8",
}

/** The glyph an act draws with (unknown → the bomb). */
export function glyphFor(act) {
    return STRIKE_GLYPH[act] ? act : "airstrike"
}

/** The marker's on-screen box: one constant size (lib/mapIcons.js SIZE.event), centred on the place. */
export function strikeIconDims(size = ICON_PX) {
    const w = Math.round(size)
    return { width: w, height: w, anchor: [Math.round(w / 2), Math.round(w / 2)] }
}

/** Priority for you: the server's when it sends one; else what the event did (in the card too, never in the size). */
export function strikePriority(e) {
    if (e?.priority && PRIORITY[e.priority]) return e.priority
    const c = e?.casualties
    const n = c ? (Number(c.killed) || 0) + (Number(c.injured) || 0) * 0.5 : 0
    return n >= 5 ? "urgent" : "alert"
}

/**
 * The marker for one event: a strike is a REPORTED EVENT, so a circle (lib/mapIcons.js) with the act's glyph,
 * coloured by priority for you, never by actor (the actor is in the card and on the lines). A place known only
 * roughly (`hollow`) is drawn uncorroborated-style: faint with a dotted edge. `color` and `opacity` are accepted
 * for old callers and ignored: age fades through the billboard / marker opacity (liveness.recencyAlpha).
 */
export function strikeIconUri({ act = "airstrike", hollow = false, priority = "alert" } = {}) {
    return markerUri({ kind: "event", glyph: glyphFor(act), priority, state: hollow ? "muted" : "live" })
}

/** One constant size whatever the event did (owner, 2026-10-23: no marker grows with data). */
export function strikeSize() {
    return ICON_PX
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

// ── reports a strike pin stands for ─────────────────────────────────────
// The Telegram posts and GeoConfirmed placemarks behind the strike pins on
// the map (the server's `covers`). Their own markers give way to the pin
// (owner, 2026-10-13); their videos and photos open from the pin's card.
let _covered = new Set()
const _coveredSubs = new Set()
export function coveredIds() { return _covered }
export function setCoveredIds(ids) {
    const next = new Set(ids)
    if (next.size === _covered.size && [...next].every((x) => _covered.has(x))) return
    _covered = next
    _coveredSubs.forEach((fn) => fn(_covered))
}
export function subscribeCovered(fn) { _coveredSubs.add(fn); return () => _coveredSubs.delete(fn) }
/** The ids the strike events cover, for a set of events. */
export const coversOf = (events) => (events || []).flatMap((e) => e?.covers || [])
