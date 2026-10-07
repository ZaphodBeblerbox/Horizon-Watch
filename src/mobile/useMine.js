/**
 * useMine.js — what is this user's, on the phone: their theaters, the
 * countries they chose, their assets — the same rule as desktop Home
 * (state/interests.js), so the phone and the desktop agree on "yours".
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"
import { watched, partition } from "../state/interests.js"
import { places as loadPlaces } from "../voice/gazetteer.js"

export const getJSON = (path) => fetch(`${API_BASE}${path}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
export const arr = (v) => (Array.isArray(v) ? v : [])

/** Poll a JSON endpoint; null while the first answer is on its way. */
export function usePoll(path, everyMs, pick = (d) => d) {
    const [v, setV] = useState(null)
    useEffect(() => {
        if (!path) return undefined
        let live = true
        const load = () => getJSON(path).then((d) => { if (live && d != null) setV(pick(d)) })
        load()
        const t = everyMs ? setInterval(load, everyMs) : null
        return () => { live = false; if (t) clearInterval(t) }
    }, [path, everyMs]) // eslint-disable-line react-hooks/exhaustive-deps
    return v
}

export function useMine() {
    const [theaters, setTheaters] = useState(null)
    const [assets, setAssets] = useState(null)
    const [countries, setCountries] = useState([])
    const [interests, setInterests] = useState(() => getSettings()?.interests || {})
    useEffect(() => subscribeSettings((st) => setInterests(st?.interests || {})), [])
    useEffect(() => {
        let live = true
        getJSON("/api/theaters").then((d) => { if (live) setTheaters(arr(d)) })
        getJSON("/api/my-assets").then((d) => { if (live) setAssets(arr(d?.assets)) })
        loadPlaces().then((ps) => { if (live) setCountries(ps.filter((p) => p.kind === "country")) }).catch(() => {})
        const again = () => getJSON("/api/theaters").then((d) => { if (live) setTheaters(arr(d)) })
        window.addEventListener("akili:theater-created", again)
        return () => { live = false; window.removeEventListener("akili:theater-created", again) }
    }, [])
    const w = useMemo(() => watched(interests || {}, theaters || [], countries, assets || []), [interests, theaters, countries, assets])
    const iso2Name = useMemo(() => new Map(countries.filter((p) => p.iso2).map((p) => [String(p.iso2).toLowerCase(), p.name])), [countries])
    const ready = theaters !== null && assets !== null && countries.length > 0
    const has = !!(w.countries.size || w.topics.size || w.assets.length)
    /** Split a list into what is this user's and the rest (Telegram posts carry a country code). */
    const split = (items) => partition(arr(items).map((x) => (x.location_country || !x.country_code ? x
        : { ...x, location_country: iso2Name.get(String(x.country_code).toLowerCase()) })), w)
    return { theaters: theaters || [], assets: assets || [], w, ready, has, split, iso2Name }
}
