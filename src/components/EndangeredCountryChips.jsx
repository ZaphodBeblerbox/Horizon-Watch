/**
 * EndangeredCountryChips.jsx — which countries the "Endangered places"
 * layer shows: "All" plus one chip per country the server has places in
 * (GET /api/endangered-places → `countries`, counted whatever the filter).
 * The choice is shared by the desktop globe and the phone map
 * (globe/endangeredPlaces.js country filter) and remembered on this device.
 *
 * variant "desktop": small chips under the layer card's row (Situation).
 * variant "phone":   the phone's m2-chip row (the map's Filters sheet).
 */
import { useEffect, useState, useSyncExternalStore } from "react"
import API_BASE from "../apiBase.js"
import { getCountryFilter, setCountryFilter, subscribeCountryFilter, toggleCountry } from "../globe/endangeredPlaces.js"

/** The chosen ISO2 codes ([] = all), re-rendering when they change. */
export function useEndangeredCountries() {
    return useSyncExternalStore(subscribeCountryFilter, getCountryFilter, getCountryFilter)
}

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
    if (!enabled || rows.length < 2) return null
    const all = !sel.length
    if (variant === "phone") {
        return (
            <div className="m2-chips" data-testid="endangered-countries" style={{ margin: "4px 0 10px" }}>
                <button className="m2-chip" aria-pressed={all} onClick={() => setCountryFilter([])}>All countries</button>
                {rows.map((r) => (
                    <button key={r.code} className="m2-chip" aria-pressed={sel.includes(r.code)} data-country={r.code}
                            onClick={() => toggleCountry(r.code)}>
                        {r.name} {r.places}
                    </button>
                ))}
            </div>
        )
    }
    return (
        <div data-testid="endangered-countries" role="group" aria-label="Countries shown"
             style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "2px 12px 6px 27px" }}>
            <button style={deskChip(all)} aria-pressed={all} onClick={() => setCountryFilter([])}
                    title="Show every country">All</button>
            {rows.map((r) => (
                <button key={r.code} style={deskChip(sel.includes(r.code))} aria-pressed={sel.includes(r.code)}
                        data-country={r.code} onClick={() => toggleCountry(r.code)}
                        title={`${r.name}: ${r.places} places, ${r.with_calls} with a dated call or notice`}>
                    {r.name} <span style={{ color: "var(--txt-4)" }}>{r.places}</span>
                </button>
            ))}
        </div>
    )
}
