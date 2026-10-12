/**
 * EndangeredCountryChips.jsx — which countries the "Endangered places"
 * layer shows: "All" plus one chip per country the server has places in
 * (GET /api/endangered-places → `countries`, counted whatever the filter).
 * The choice is shared by the desktop globe and the phone map
 * (globe/endangeredPlaces.js country filter) and remembered on this device.
 *
 * variant "desktop": small chips under the layer card's row (Situation).
 * variant "phone":   the phone's m2-chip row (the map's Filters sheet).
 *
 * "ACTIVE ONLY" (owner, 2026-10-12) leads the row: only the places with a
 * dated call today or to come, and those within 2 km of one (the server
 * computes it: /api/endangered-places?active=1). Remembered on this device.
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import API_BASE from "../apiBase.js"
import { getCountryFilter, setCountryFilter, subscribeCountryFilter, toggleCountry,
         getActiveOnly, setActiveOnly, subscribeActiveOnly } from "../globe/endangeredPlaces.js"

/** The chosen ISO2 codes ([] = all), re-rendering when they change. */
export function useEndangeredCountries() {
    return useSyncExternalStore(subscribeCountryFilter, getCountryFilter, getCountryFilter)
}

/** Is "Active only" on, re-rendering when it changes. */
export function useEndangeredActive() {
    return useSyncExternalStore(subscribeActiveOnly, getActiveOnly, getActiveOnly)
}

const ACTIVE_TIP = "Only places with a dated call today or to come, and places within 2 km of one"

function useCountryCounts(enabled) {
    const [rows, setRows] = useState([])
    useEffect(() => {
        if (!enabled) return undefined
        let live = true
        // kind=none: no places in the answer, only the per-country counts
        fetch(`${API_BASE}/api/endangered-places?kind=none`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d && Array.isArray(d.countries)) setRows(d.countries) })
            .catch(() => {})
        return () => { live = false }
    }, [enabled])
    return rows
}

const deskChip = (on) => ({
    height: 20, padding: "0 8px", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap",
    font: "500 10.5px var(--font)", color: on ? "var(--txt)" : "var(--txt-3)",
    background: on ? "rgba(122,167,255,.16)" : "transparent",
    border: `1px solid ${on ? "var(--acc-hi)" : "var(--line-soft)"}`,
})

export default function EndangeredCountryChips({ enabled = true, variant = "desktop" }) {
    const rows = useCountryCounts(enabled)
    const sel = useEndangeredCountries()
    const active = useEndangeredActive()
    if (!enabled) return null
    const all = !sel.length
    const countries = rows.length >= 2
    // with "Active only" on, each country chip counts its active places
    const n = (r) => (active && Number.isFinite(r.active) ? r.active : r.places)
    if (variant === "phone") {
        return (
            <div className="m2-chips" data-testid="endangered-countries" style={{ margin: "4px 0 10px" }}>
                <button className="m2-chip" aria-pressed={active} data-testid="endangered-active"
                        onClick={() => setActiveOnly(!active)} title={ACTIVE_TIP}>
                    Active only
                </button>
                {countries && <button className="m2-chip" aria-pressed={all} onClick={() => setCountryFilter([])}>All countries</button>}
                {countries && rows.map((r) => (
                    <button key={r.code} className="m2-chip" aria-pressed={sel.includes(r.code)} data-country={r.code}
                            onClick={() => toggleCountry(r.code)}>
                        {r.name} {n(r)}
                    </button>
                ))}
            </div>
        )
    }
    return (
        <div data-testid="endangered-countries" role="group" aria-label="Countries shown"
             style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "2px 12px 6px 27px" }}>
            <button style={{ ...deskChip(active), ...(active ? { borderColor: "#F5A524", background: "rgba(245,165,36,.14)" } : null) }}
                    aria-pressed={active} data-testid="endangered-active"
                    onClick={() => setActiveOnly(!active)} title={ACTIVE_TIP}>Active only</button>
            {countries && <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", margin: "2px 2px", background: "var(--line-soft)" }} />}
            {countries && <button style={deskChip(all)} aria-pressed={all} onClick={() => setCountryFilter([])}
                    title="Show every country">All</button>}
            {countries && rows.map((r) => (
                <button key={r.code} style={deskChip(sel.includes(r.code))} aria-pressed={sel.includes(r.code)}
                        data-country={r.code} onClick={() => toggleCountry(r.code)}
                        title={`${r.name}: ${r.places} places, ${r.with_calls} with a dated call or notice${Number.isFinite(r.active) ? `, ${r.active} active (called, or a call within 2 km)` : ""}`}>
                    {r.name} <span style={{ color: "var(--txt-4)" }}>{n(r)}</span>
                </button>
            ))}
        </div>
    )
}
