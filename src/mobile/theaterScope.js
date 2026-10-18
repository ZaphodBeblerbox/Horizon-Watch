/**
 * theaterScope.js — THE THEATER YOU ARE LOOKING AT, on the phone (owner,
 * 2026-10-17: "I should be able to filter by the theater I'm currently
 * looking at"). One choice for the whole phone: picked on the map (its
 * theaters sheet) or from the chips over Home's For you, the Desk's General
 * feed and Alerts; every list then keeps what lies in that theater.
 *
 * In a theater: a point within its view's reach, or a country its view
 * covers (state/interests.js countriesInView — the same reach the desktop
 * uses to say what a theater watches). "All" (null) keeps everything.
 */
import { useEffect, useState } from "react"
import { countriesInView } from "../state/interests.js"

const KEY = "m2.theaterScope"
let scope = (() => { try { return localStorage.getItem(KEY) || null } catch { return null } })()
const subs = new Set()

export const getTheaterScope = () => scope
export function setTheaterScope(id) {
    scope = id && id !== "global" ? String(id) : null
    try { if (scope) localStorage.setItem(KEY, scope); else localStorage.removeItem(KEY) } catch { /* private mode */ }
    for (const f of [...subs]) { try { f(scope) } catch { /* one list failing must not stop the others */ } }
}
export function useTheaterScope() {
    const [s, setS] = useState(scope)
    useEffect(() => { subs.add(setS); return () => subs.delete(setS) }, [])
    return s
}

const kmBetween = (a, b) => {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 12742 * Math.asin(Math.sqrt(h))
}

/** A test for "is this item in the theater": (item) => bool. Null theater: always true. */
export function inTheater(theater, countries = [], iso2Name = null) {
    const v = theater?.view
    if (!v || !Number.isFinite(+v.lat) || !Number.isFinite(+v.lon)) return () => true
    const center = { lat: +v.lat, lon: +v.lon }
    const reach = Math.max(350, (Number(v.height) || 2_000_000) / 1000 * 0.9)
    const names = new Set(countriesInView(center && { ...v, lat: +v.lat, lon: +v.lon }, countries).map((n) => String(n).toLowerCase()))
    return (x) => {
        const lat = +(x?.lat ?? x?.ref?.lat), lon = +(x?.lon ?? x?.lng ?? x?.ref?.lon)
        if (Number.isFinite(lat) && Number.isFinite(lon)) return kmBetween(center, { lat, lon }) <= reach
        const c = x?.location_country || (x?.country_code && iso2Name?.get(String(x.country_code).toLowerCase())) || x?.country
        return c ? names.has(String(c).toLowerCase()) : false
    }
}
