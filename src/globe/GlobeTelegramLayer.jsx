/**
 * GlobeTelegramLayer.jsx — Telegram posts that passed relevance and precise
 * geolocation (backend/telegram_ingest.py), as pins. Clicking one opens the
 * inspector with the post's picture, its headline and the original, which
 * plays in the console through Telegram's embed.
 */
import { useEffect, useRef, useState } from "react"
import { Entity } from "resium"
import { Cartesian3, Color, DistanceDisplayCondition, HeightReference } from "cesium"
import { recencyAlpha, makeArrivalTracker, arrivalScale, ARRIVAL_MS } from "./liveness.js"
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

/* SAME LOGIC AS THE OTHER EVENT LAYERS (liveness.js): poll for the newest
   every minute; a post is at full weight for 30 minutes and dims with age to
   a floor at 24 hours, when it leaves the map; one that lands while the
   analyst is watching grows briefly, and nothing already there pulses. */
export default function GlobeTelegramLayer({ enabled = false, hours = 24 }) {
    const [posts, setPosts] = useState([])
    const arrivalsRef = useRef(null)
    const [arrivedAt, setArrivedAt] = useState({})
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const h = setInterval(() => setNowMs(Date.now()), 15000)
        return () => clearInterval(h)
    }, [])
    useEffect(() => {
        if (!enabled) { setPosts([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/posts?hours=${hours}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                const ps = safeArray(d.posts)
                setPosts(ps)
                if (!arrivalsRef.current) arrivalsRef.current = makeArrivalTracker()
                const fresh = arrivalsRef.current.arrivals(ps.map((p) => p.id))
                if (fresh.length) {
                    const t = Date.now()
                    setArrivedAt((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((id) => [id, t])) }))
                    setTimeout(() => setArrivedAt((prev) => {
                        const next = { ...prev }
                        for (const id of fresh) delete next[id]
                        return next
                    }), ARRIVAL_MS + 500)
                }
            })
            .catch(() => { /* a dropped poll is not an empty world */ })
        load()
        const iv = setInterval(load, 60_000)
        return () => { live = false; clearInterval(iv) }
    }, [enabled, hours])
    useEffect(() => {
        posts.forEach((p) => setEntity(p.id, "telegram", { ...p, thumb_url: p.thumb_url ? `${API_BASE}${p.thumb_url}` : null }))
        return () => posts.forEach((p) => deleteEntity(p.id))
    }, [posts])
    if (!enabled || !posts.length) return null
    return (
        <>
            {posts.map((p) => {
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
                const alpha = recencyAlpha(Date.parse(p.posted_at), nowMs)
                const size = Math.round(SIZE * arrivalScale(arrivedAt[p.id], nowMs))
                return (
                <Entity key={p.id} id={p.id} position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{ image: icon(), width: size, height: size, color: Color.WHITE.withAlpha(alpha),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000), eyeOffset: new Cartesian3(0, 0, -60) }} />
                )
            })}
        </>
    )
}
