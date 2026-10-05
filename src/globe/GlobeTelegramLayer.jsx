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

const SIZE = 16
let _icon = null
function icon() {
    if (_icon) return _icon
    // Telegram's paper plane in a disc: recognisably "from a channel" and
    // distinct from the GeoConfirmed and wire-report markers.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="#229ED9" stroke="#0b1220" stroke-width="2"/>
      <path d="M8 15.5l15-6c.7-.3 1.3.2 1.1.9l-2.6 12c-.2.8-.9 1-1.5.6l-4-3-2 1.9c-.2.2-.5.4-.9.4l.3-4.1 7.4-6.7c.3-.3-.1-.4-.5-.2l-9.1 5.8-3.9-1.2c-.8-.3-.8-.9.1-1.3z" fill="#fff"/></svg>`
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
