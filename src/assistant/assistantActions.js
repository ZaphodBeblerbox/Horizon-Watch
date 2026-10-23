/**
 * assistantActions.js — the assistant's map actions, carried out.
 *
 * The server has already allowlisted every step (navigate, layer, zoom,
 * open_page, search, focus) and resolved every place to coordinates, so the
 * desktop globe and the phone map fly to the same point without a second
 * lookup. planActions() is pure (what to dispatch); runAssistantActions()
 * dispatches it.
 *
 * Desktop: the voice command events (akili:fly-to, akili:voice-layer, ...),
 * the same ones runVoiceActions.js sends.
 * Phone: m2:assistant-fly (MobileApp centres the map), m2:layers with the
 * phone's own layer keys, m2:go for pages. Zoom is the user's pinch there.
 */

/** The voice/desktop layer key -> the phone map's layer key(s). */
export const PHONE_LAYER = {
    vessels: ["ships"], aircraft: ["aircraft"], heat: ["fires"], imagery_signals: ["imagerySignals"],
    telegram: ["liveSignals"], unrest: ["liveSignals"], demonstrations: ["liveSignals"],
    geoconfirmed: ["geoConfirmed"], gps_interference: ["gpsInterference"], airspace: ["airspace"],
    risk: ["risk"], frontlines: ["frontlines"], flows: ["flows"], aois: ["aois"], cables: ["cables"],
    ports: ["ports"], airfields: ["airports"], chokepoints: ["chokepoints"], power: ["power"],
    military_sites: ["facMilitary"], alerts: ["derivedAlerts"], assets: ["assets"],
}
const PHONE_PAGE = { situation: "map", home: "home", assets: "assets", settings: "settings", inbox: "alerts" }

/**
 * @param actions  the server's actions [{intent, slots}]
 * @param platform "desktop" | "phone"
 * @param layersOn the phone's current layers (for a flip with on=null)
 * @returns {{events: Array<[string, object]>, labels: string[], focus: object|null}}
 */
export function planActions(actions, platform = "desktop", layersOn = {}) {
    const events = []
    const labels = []
    let focus = null
    const phone = platform === "phone"
    for (const a of actions || []) {
        const s = a?.slots || {}
        switch (a?.intent) {
            case "navigate":
                if (!Number.isFinite(+s.lat) || !Number.isFinite(+s.lon)) break
                if (phone) events.push(["m2:assistant-fly", { lat: +s.lat, lon: +s.lon, zoom: s.zoom ?? 11, label: s.place }])
                else {
                    events.push(["akili:open-map", null])
                    events.push(["akili:fly-to", { lat: +s.lat, lon: +s.lon, altitude: s.altitude ?? 60000 }])
                }
                labels.push(`Flying to ${s.place}`)
                break
            case "layer": {
                if (phone) {
                    const keys = PHONE_LAYER[s.layer]
                    if (!keys) break
                    const on = s.on === null || s.on === undefined ? !layersOn[keys[0]] : !!s.on
                    events.push(["m2:layers", Object.fromEntries(keys.map((k) => [k, on]))])
                    events.push(["m2:assistant-map", null])
                } else {
                    events.push(["akili:open-map", null])
                    events.push(["akili:voice-layer", { layer: s.layer, on: s.on ?? null }])
                }
                labels.push(`${s.on === false ? "Hiding" : "Showing"} ${String(s.layer).replace(/_/g, " ")}`)
                break
            }
            case "zoom":
                if (!phone) {
                    events.push(["akili:open-map", null])
                    events.push(["akili:voice-zoom", { direction: s.direction }])
                    labels.push(`Zoomed ${s.direction}`)
                } else labels.push("Pinch the map to zoom")
                break
            case "open_page":
                if (phone) { if (PHONE_PAGE[s.page]) events.push(["m2:go", PHONE_PAGE[s.page]]) }
                else events.push(["akili:navigate", { destination: s.page }])
                labels.push(`Opened ${s.page === "situation" ? "the map" : s.page}`)
                break
            case "search":
                if (!phone) events.push(["akili:search", { query: s.query, go: true }])
                labels.push(`Searching “${s.query}”`)
                break
            case "focus":
                focus = s
                labels.push(`Opened ${s.label || "the item"}`)
                break
            default:
                break
        }
    }
    return { events, labels, focus }
}

/** A cited item as the signal opener reads it (notify/openSignal.js). */
export function citationRoute(c) {
    if (!c) return null
    if (c.kind === "asset" && c.assetId) return { assetId: c.assetId, title: c.label }
    if (c.kind === "vessel" && c.mmsi) return { mmsi: c.mmsi, title: c.label, lat: c.lat, lon: c.lon }
    return { id: c.id, alertId: c.kind === "alert" ? c.id : undefined, title: c.label, lat: c.lat, lon: c.lon,
             kind: c.kind === "live_signal" ? "live_signal" : undefined }
}

/** A cited source read inside Parallax (components/SourceViewer.jsx): a Telegram or X post in its
 *  embed, anything else as a card (title, source, date, summary) with the original a secondary link.
 *  Never a navigation away (owner, 2026-10-23). */
export function sourceCard(c) {
    return { title: c?.label || c?.title || "", source: c?.source || null, summary: c?.summary || null,
             when: c?.when || null, place: c?.place || null,
             note: c?.kind === "web" ? "Found on the web; not our own reporting." : null }
}

export function openCitationSource(c) {
    if (!c) return
    window.dispatchEvent(new CustomEvent("akili:open-source", { detail: { url: c.url || null, card: sourceCard(c) } }))
}

export async function openCitation(c, platform = "desktop") {
    if (!c) return
    // a web finding has no item of ours to open: it is read in the source viewer
    if (c.kind === "web") { openCitationSource(c); return }
    // the signal opener moves the map and opens the item on either surface
    try {
        const { openSignal } = await import("../notify/openSignal.js")
        if (await openSignal(citationRoute(c))) return
    } catch { /* fall back to flying there */ }
    if (c.lat != null && c.lon != null) {
        const { events } = planActions([{ intent: "navigate", slots: { lat: c.lat, lon: c.lon, zoom: 12, altitude: 40000, place: c.label } }], platform)
        for (const [n, d] of events) window.dispatchEvent(new CustomEvent(n, { detail: d }))
    } else {
        openCitationSource(c)
    }
}

export async function runAssistantActions(actions, platform = "desktop") {
    const layersOn = (typeof window !== "undefined" && window.__m2LayersOn) || {}
    const { events, labels, focus } = planActions(actions, platform, layersOn)
    for (const [name, detail] of events) {
        window.dispatchEvent(new CustomEvent(name, { detail }))
        // the globe mounts when the map tab opens: a fly sent in the same
        // tick can find nobody listening, so it is said once more
        if (name === "akili:fly-to") setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail })), 450)
    }
    if (focus) await openCitation(focus, platform)
    return labels
}
