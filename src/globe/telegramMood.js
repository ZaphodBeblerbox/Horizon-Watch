/**
 * telegramMood.js — THE MOOD ON TELEGRAM AS SIGNALS ON THE MAP (owner,
 * 2026-10-18: "if sentiment is spiking in some country, or calls to action,
 * calls to violence, only one specific call, citations and everything, that
 * has to become a signal: on the desk, a notification, and on the map").
 *
 * The backend raises them as alerts (telegram_mood_alert.py: calls for
 * conflict rising, one call to violence; telegram_unrest.py: demonstrations
 * likely, tension rising sharply). Here they are one shape for both maps
 * (globe/GlobeTelegramMoodLayer.jsx, mobile/mapLayers.js "telegramMood"):
 * a megaphone in a ring, the ring the severity's colour, solid where the
 * post placed it and dashed where it stands at the country's centre.
 */
import { markerUri, priorityOf } from "../lib/mapIcons.js"

export const MOOD_PREFIX = "Telegram mood"
export const MOOD_PATH = "/api/alerts?source=telegram&since_hours=48&limit=0"
export const MOOD_REFRESH_MS = 60_000

const SEV = { critical: "#ff5a4f", high: "#f5a623", elevated: "#f5a623", moderate: "#8fb4e8", medium: "#8fb4e8" }
const KIND = {
    "Telegram mood: call to violence": "Call to violence",
    "Telegram mood: calls for conflict rising": "Calls for conflict rising",
    "Telegram mood: demonstrations likely": "Demonstrations likely",
    "Telegram mood: tension rising sharply": "Tension rising sharply",
}

export const isMoodAlert = (a) => String(a?.alert_type || "").startsWith(MOOD_PREFIX)
export const moodKind = (a) => KIND[a?.alert_type] || String(a?.alert_type || "").replace(/^Telegram mood:\s*/, "") || "Telegram mood"

/** The mark, in the one typology (lib/mapIcons.js): a warning we derived (a triangle, the megaphone); a country's
 *  centre (not `precise`) is drawn uncorroborated-style. */
export function moodIconUri(sev, precise = true) {
    return markerUri({ kind: "derived", glyph: "action", priority: priorityOf(sev, "urgent"), state: precise ? "live" : "muted" })
}

/** A call to violence says no time: after CALL_NO_TIME_H it is no longer a
 *  signal on the map (owner, 2026-10-19: "Once the demonstration is over we
 *  don't want the signal anymore"; backend protest_status.CALL_NO_TIME_H). */
export const CALL_NO_TIME_H = 12
export function callExpired(a, now = Date.now()) {
    if (a?.alert_type !== "Telegram mood: call to violence") return false
    const t = Date.parse(a.created_at || a.published_at || "")
    return Number.isFinite(t) && now - t > CALL_NO_TIME_H * 3_600_000
}

/** An alert row as a map point: {id, lat, lon, precise, title, sub, severity, raw}, or null. */
export function moodPoint(a, now = Date.now()) {
    if (!isMoodAlert(a) || !Number.isFinite(+a?.lat) || !Number.isFinite(+a?.lon)) return null
    if (callExpired(a, now)) return null
    let raw = a.raw_json || a.raw || null
    if (typeof raw === "string") { try { raw = JSON.parse(raw) } catch { raw = null } }
    const precise = raw?.placed ? raw.placed === "post" : a.alert_type === "Telegram mood: call to violence"
    return {
        id: `tgmood-${a.alert_id}`, lat: +a.lat, lon: +a.lon, precise,
        title: a.title, sub: [moodKind(a), a.region].filter(Boolean).join(" · "),
        severity: a.severity || "high",
        raw: { ...a, id: a.alert_id, source: "Telegram", alert_type: a.alert_type, url: raw?.url || null, headline: a.title },
    }
}
