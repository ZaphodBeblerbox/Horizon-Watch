/**
 * GlobeTelegramMoodLayer.jsx — the mood on Telegram as signals on the globe
 * (owner, 2026-10-18): a spike in calls for conflict, demonstrations likely,
 * tension rising sharply, and each single call to violence with its quote
 * and link — the alerts telegram_mood_alert.py and telegram_unrest.py raise,
 * drawn with globe/telegramMood.js's mark and opened in the inspector as the
 * alert they are. Read every minute while on.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, DistanceDisplayCondition, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { MOOD_PATH, MOOD_REFRESH_MS, moodIconUri, moodPoint } from "./telegramMood.js"
import { MARKER_DEPTH_TEST_M } from "./entityIcons.js"

const SIZE = 22

export default function GlobeTelegramMoodLayer({ enabled = true }) {
    const [items, setItems] = useState([])
    useEffect(() => {
        if (!enabled) { setItems([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}${MOOD_PATH}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setItems(safeArray(Array.isArray(d) ? d : d.alerts).map(moodPoint).filter(Boolean)) })
            .catch(() => {})
        load()
        const iv = setInterval(load, MOOD_REFRESH_MS)
        return () => { live = false; clearInterval(iv) }
    }, [enabled])
    useEffect(() => {
        items.forEach((m) => setEntity(m.id, "alert", m.raw))
        return () => items.forEach((m) => deleteEntity(m.id))
    }, [items])
    if (!enabled || !items.length) return null
    return (
        <>
            {items.map((m) => (
                <Entity key={m.id} id={m.id} name={m.title} position={Cartesian3.fromDegrees(m.lon, m.lat, 0)}
                    billboard={{ image: moodIconUri(m.severity, m.precise), width: SIZE, height: SIZE,
                                 heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: MARKER_DEPTH_TEST_M,
                                 distanceDisplayCondition: new DistanceDisplayCondition(0, 2.5e7) }} />
            ))}
        </>
    )
}
