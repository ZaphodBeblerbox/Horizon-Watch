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
let _unrest = null, _soon = null
/** Unrest: an amber diamond with a crowd mark; an announced one: a hollow
 *  amber diamond with a clock — it has not happened yet. */
function unrestIcon(announced = false) {
    if (announced ? _soon : _unrest) return announced ? _soon : _unrest
    const svg = announced
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#0b1220" stroke="#F5A524" stroke-width="3"/>
      <circle cx="16" cy="16" r="4.6" fill="none" stroke="#F5A524" stroke-width="1.8"/><path d="M16 13.6V16l1.8 1.2" stroke="#F5A524" stroke-width="1.6" fill="none"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="7" width="18" height="18" transform="rotate(45 16 16)" fill="#F5A524" stroke="#0b1220" stroke-width="2.5"/>
      <g fill="#0b1220"><circle cx="12.5" cy="14" r="1.7"/><circle cx="16" cy="13" r="1.9"/><circle cx="19.5" cy="14" r="1.7"/><path d="M10.5 19c.4-2 1.2-3 2-3s1.6 1 2 3zM14 19c.4-2.3 1.2-3.4 2-3.4s1.6 1.1 2 3.4zM17.5 19c.4-2 1.2-3 2-3s1.6 1 2 3z"/></g></svg>`
    const uri = `data:image/svg+xml;base64,${btoa(svg)}`
    if (announced) _soon = uri; else _unrest = uri
    return uri
}
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
/**
 * enabled: Telegram's conflict posts. unrest: riots, protests and civil
 * unrest — its own layer (the owner, 2026-10-07), with the gatherings
 * announced for the coming days as hollow pins.
 */
export default function GlobeTelegramLayer({ enabled = false, unrest = false, hours = 24 }) {
    const [allPosts, setPosts] = useState([])
    const [upcoming, setUpcoming] = useState([])
    const posts = allPosts.filter((p) => (p.category === "unrest" ? unrest : enabled))
    useEffect(() => {
        if (!unrest) { setUpcoming([]); return undefined }
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/upcoming?days=14`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setUpcoming(safeArray(d.upcoming)) }).catch(() => {})
        load()
        const iv = setInterval(load, 10 * 60_000)
        return () => { live = false; clearInterval(iv) }
    }, [unrest])
    useEffect(() => {
        upcoming.forEach((a) => setEntity(a.id, "telegram", a))
        return () => upcoming.forEach((a) => deleteEntity(a.id))
    }, [upcoming])
    const arrivalsRef = useRef(null)
    const [arrivedAt, setArrivedAt] = useState({})
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const h = setInterval(() => setNowMs(Date.now()), 15000)
        return () => clearInterval(h)
    }, [])
    useEffect(() => {
        if (!enabled && !unrest) { setPosts([]); return undefined }
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
    }, [enabled || unrest, hours]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        posts.forEach((p) => setEntity(p.id, "telegram", { ...p, thumb_url: p.thumb_url ? `${API_BASE}${p.thumb_url}` : null }))
        return () => posts.forEach((p) => deleteEntity(p.id))
    }, [posts])
    if (!posts.length && !upcoming.length) return null
    return (
        <>
            {posts.map((p) => {
                if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
                const alpha = recencyAlpha(Date.parse(p.posted_at), nowMs)
                const size = Math.round(SIZE * arrivalScale(arrivedAt[p.id], nowMs))
                return (
                <Entity key={p.id} id={p.id} position={Cartesian3.fromDegrees(p.lon, p.lat, 0)}
                        billboard={{ image: p.category === "unrest" ? unrestIcon() : icon(), width: size, height: size, color: Color.WHITE.withAlpha(alpha),
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000), eyeOffset: new Cartesian3(0, 0, -60) }} />
                )
            })}
            {upcoming.map((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon) && (
                <Entity key={a.id} id={a.id} position={Cartesian3.fromDegrees(a.lon, a.lat, 0)}
                        billboard={{ image: unrestIcon(true), width: SIZE + 2, height: SIZE + 2,
                                     heightReference: HeightReference.CLAMP_TO_GROUND,
                                     distanceDisplayCondition: new DistanceDisplayCondition(0, 12_000_000), eyeOffset: new Cartesian3(0, 0, -60) }} />
            ))}
        </>
    )
}
