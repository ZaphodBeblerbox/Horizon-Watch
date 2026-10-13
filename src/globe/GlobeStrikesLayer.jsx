/**
 * GlobeStrikesLayer.jsx — "Strikes & control": airstrikes, missile and
 * drone strikes, shelling, naval strikes, assaults, territory taken and
 * interceptions (backend/strike_events.py, /api/strikes).
 *
 * One marker per event (strikes.js: glyph = act, colour = actor, size =
 * casualties, hollow = rough place, fading = age in its window). Markers
 * only: launch→target trajectories and frontline changes are drawn by
 * their own layers.
 *
 * TIME. `at` is the time strip's playhead (Situation's geoConfirmedEndDate,
 * a YYYY-MM-DD day or null for live): dragging it back shows only what had
 * happened by then, faded by its age THEN — so scrubbing across a week
 * shows a campaign build up. A campaign's own replay (the inspector card's
 * "Replay campaign", event akili:strike-campaign-replay) runs that clock
 * by itself from the campaign's first event to its last over ~10 s, draws
 * only that campaign, joined in order, and flies to it.
 *
 * A click opens the event in the inspector (entity type strike_event,
 * inspector/StrikeEventDetail.jsx), with the campaign it belongs to.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { Entity, useCesium } from "resium"
import {
    Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference, LabelStyle, NearFarScalar,
    PolylineDashMaterialProperty, VerticalOrigin,
} from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import {
    actorColor, filterStrikes, isHollow, strikeIconUri, strikeOpacity, strikeSize, strikesUrl,
    dayLabel, strikeWindowHours,
} from "./strikes.js"
import { useStrikeSettings } from "./useStrikeSettings.js"

const REFRESH_MS = 3 * 60_000
const REPLAY_MS = 10_000

/** The playhead as ms: a YYYY-MM-DD day means the end of that day. */
export function playheadMs(at) {
    if (!at) return Date.now()
    const s = String(at)
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : s)
    return Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now()
}

export default function GlobeStrikesLayer({ enabled = false, at = null }) {
    const { viewer } = useCesium()
    // the act chips and the time-window chip (layers panel / phone Filters)
    const settings = useStrikeSettings()
    const acts = settings.acts
    const windowHours = strikeWindowHours(settings.window)
    const [events, setEvents] = useState([])
    const [campaigns, setCampaigns] = useState([])
    const [replay, setReplay] = useState(null)        // { campaign, t }
    const replayTimer = useRef(null)

    useEffect(() => {
        if (!enabled) { setEvents([]); setCampaigns([]); return undefined }
        let live = true
        const load = () => Promise.all([
            fetch(strikesUrl(API_BASE), { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
            fetch(`${API_BASE}/api/strikes/campaigns?since=30d`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
        ]).then(([e, c]) => {
            if (!live) return
            if (e) setEvents(safeArray(e.events))
            if (c) setCampaigns(safeArray(c.campaigns))
        }).catch(() => {})
        load()
        const iv = setInterval(load, REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])

    // a campaign replay: its own clock, first → last
    useEffect(() => {
        const onReplay = (ev) => {
            const id = ev.detail?.id
            const c = campaigns.find((x) => x.id === id) || ev.detail?.campaign
            if (!c) return
            clearInterval(replayTimer.current)
            const t0 = Date.parse(c.first), t1 = Date.parse(c.last) + 3600e3
            const started = performance.now()
            setReplay({ campaign: c, t: t0 })
            const [w, s, e, n] = c.bbox || []
            if ([w, s, e, n].every(Number.isFinite)) {
                const span = Math.max(e - w, n - s, 1)
                window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: {
                    lat: (s + n) / 2, lon: (w + e) / 2, altitude: Math.min(4_000_000, Math.max(250_000, span * 160_000)) } }))
            }
            replayTimer.current = setInterval(() => {
                const k = Math.min(1, (performance.now() - started) / REPLAY_MS)
                setReplay({ campaign: c, t: t0 + (t1 - t0) * k })
                if (k >= 1) {
                    clearInterval(replayTimer.current)
                    replayTimer.current = setTimeout(() => setReplay(null), 6000)
                }
            }, 120)
        }
        window.addEventListener("akili:strike-campaign-replay", onReplay)
        return () => { window.removeEventListener("akili:strike-campaign-replay", onReplay) }
    }, [campaigns])
    useEffect(() => () => { clearInterval(replayTimer.current); clearTimeout(replayTimer.current) }, [])

    const atMs = replay ? replay.t : playheadMs(at)
    const shown = useMemo(() => {
        if (replay) {
            const ids = new Set(replay.campaign.event_ids || [])
            return events.filter((e) => ids.has(e.id) && Date.parse(e.time) <= replay.t)
        }
        return filterStrikes(events, { acts, atMs, windowHours })
    }, [events, acts, atMs, windowHours, replay])

    const byCampaign = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c])), [campaigns])

    useEffect(() => {
        shown.forEach((e) => setEntity(`strike-${e.id}`, "strike_event", { ...e, campaign: byCampaign[e.campaign_id] || null }))
        viewer?.scene?.requestRender?.()
        return () => shown.forEach((e) => deleteEntity(`strike-${e.id}`))
    }, [shown, byCampaign, viewer])

    // campaign labels where at least one of its events is on the map
    const labels = useMemo(() => {
        if (replay) return [replay.campaign]
        const on = new Set(shown.map((e) => e.campaign_id).filter(Boolean))
        return campaigns.filter((c) => on.has(c.id))
    }, [campaigns, shown, replay])

    const path = useMemo(() => {
        if (!replay) return null
        const pts = [...shown].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        return pts.length > 1 ? Cartesian3.fromDegreesArray(pts.flatMap((e) => [+e.lon, +e.lat])) : null
    }, [replay, shown])

    if (!enabled || (!shown.length && !replay)) return null
    return (
        <>
            {shown.map((e) => <StrikeEntity key={e.id} e={e} atMs={atMs} />)}
            {labels.map((c) => <CampaignLabel key={c.id} c={c} replayT={replay?.campaign?.id === c.id ? replay.t : null}
                count={replay ? shown.length : null} />)}
            {path && (
                <Entity id="strike-replay-path" polyline={{
                    positions: path, width: 2, clampToGround: true,
                    material: new PolylineDashMaterialProperty({
                        color: Color.fromCssColorString(actorColor(replay.campaign.actor)).withAlpha(0.7), dashLength: 12 }),
                }} />
            )}
        </>
    )
}

const StrikeEntity = memo(function StrikeEntity({ e, atMs }) {
    const size = strikeSize(e)
    const opacity = strikeOpacity(e, atMs)
    const pos = useMemo(() => Cartesian3.fromDegrees(+e.lon, +e.lat, 0), [e.lon, e.lat])
    const image = strikeIconUri({ act: e.act, color: actorColor(e.actor), size, hollow: isHollow(e), opacity })
    return (
        <Entity id={`strike-${e.id}`} name={e.title} position={pos}
            billboard={{
                image, width: size, height: size,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000),
                scaleByDistance: new NearFarScalar(150_000, 1.0, 8_000_000, 0.6),
                eyeOffset: new Cartesian3(0, 0, -80),
            }} />
    )
})

function CampaignLabel({ c, replayT = null, count = null }) {
    const pos = useMemo(() => Cartesian3.fromDegrees(c.center[1], c.center[0], 0), [c.center])
    const n = count ?? c.count
    const until = replayT ? dayLabel(new Date(replayT).toISOString()) : dayLabel(c.last)
    const text = `${c.title} · ${n} event${n === 1 ? "" : "s"} · ${dayLabel(c.first)}–${until}`
    return (
        <Entity id={`strike-campaign-${c.id}`} position={pos}
            label={{
                text, font: "600 12px system-ui, -apple-system, Segoe UI, sans-serif",
                fillColor: Color.fromCssColorString(actorColor(c.actor)),
                outlineColor: Color.fromCssColorString("#05070C"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -26),
                heightReference: HeightReference.CLAMP_TO_GROUND,
                distanceDisplayCondition: new DistanceDisplayCondition(200_000, replayT ? 20_000_000 : 6_000_000),
                showBackground: true, backgroundColor: Color.fromCssColorString("#0B0F1A").withAlpha(0.72),
                backgroundPadding: new Cartesian2(6, 4),
            }} />
    )
}
