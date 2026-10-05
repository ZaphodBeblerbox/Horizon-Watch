/**
 * GlobeTelegramLayer.jsx — Telegram posts that passed relevance and precise
 * geolocation (backend/telegram_ingest.py), as pins. Clicking one opens the
 * inspector with the post's picture, its headline and the original, which
 * plays in the console through Telegram's embed.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, DistanceDisplayCondition, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { setEntity, deleteEntity } from "./entityStore.js"

const SIZE = 18
let _icon = null
function icon() {
    if (_icon) return _icon
    // A blue diamond: the console's marker shape for an event, in
    // Telegram blue so it reads as "from a channel" at a glance.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#229ED9" stroke="#0b1220" stroke-width="2.5"/></svg>`
    _icon = `data:image/svg+xml;base64,${btoa(svg)}`
    return _icon
}

export default function GlobeTelegramLayer({ enabled = false, hours = 72 }) {
    const [posts, setPosts] = useState([])
    useEffect(() => {
        if (!enabled) { setPosts([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/posts?hours=${hours}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setPosts(safeArray(d?.posts)) }).catch(() => {})
        load()
        const iv = setInterval(load, 120_000)
        return () => { live = false; clearInterval(iv) }
    }, [enabled, hours])
    useEffect(() => {
        posts.forEach((p) => setEntity(p.id, "telegram", { ...p, thumb_url: p.thumb_url ? `${API_BASE}${p.thumb_url}` : null }))
        return () => posts.forEach((p) => deleteEntity(p.id))
    }, [posts])
    if (!enabled || !posts.length) return null
    return (
        <>
            {posts.map((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) ? (
                <Entity key={p.id} id={p.id} position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{ image: icon(), width: SIZE, height: SIZE, heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000), eyeOffset: new Cartesian3(0, 0, -60) }} />
            ) : null)}
        </>
    )
}
