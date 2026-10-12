/**
 * useLivePositions.js — React's view of the live position stream
 * (location/positionStream.js): the team, one person, one asset, and a
 * clock that ticks so "live · 3 s ago" counts up between updates.
 */
import { useEffect, useState } from "react"
import { positionStream } from "./positionStream.js"
import { freshness } from "./glide.js"

/** Re-render on every stream change while `on`; returns the stream. */
export function useStream(on = true) {
    const s = positionStream()
    const [, setN] = useState(0)
    useEffect(() => (on ? s.subscribe(() => setN((n) => n + 1)) : undefined), [on, s])
    return s
}

/** Everyone sharing whom this user may see, at their latest. */
export function useLivePeople(on = true) {
    const s = useStream(on)
    return on ? s.people() : []
}

/** The live position of an asset moved by someone's phone, or null. */
export function useLiveAsset(assetId, on = true) {
    const s = useStream(on && !!assetId)
    return assetId ? s.asset(assetId) : null
}

/** A clock for freshness labels, on the server's time. */
export function useNow(everyMs = 1000) {
    const [t, setT] = useState(() => positionStream().serverNow())
    useEffect(() => {
        const id = setInterval(() => setT(positionStream().serverNow()), everyMs)
        return () => clearInterval(id)
    }, [everyMs])
    return t
}

/** "live · 3 s ago" for a position at `at` (ms). */
export function useFreshness(at) {
    const now = useNow(1000)
    return freshness(at, now)
}
