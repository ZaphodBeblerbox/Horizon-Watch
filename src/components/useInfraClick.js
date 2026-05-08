import { useEffect, useRef } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import API_BASE from "../apiBase.js"

function buildQuery(lat, lon, radius) {
    return `[out:json][timeout:10];(
        way["power"](around:${radius},${lat},${lon});
        node["power"](around:${radius},${lat},${lon});
        way["pipeline"](around:${radius},${lat},${lon});
        way["man_made"="pipeline"](around:${radius},${lat},${lon});
        way["communication"](around:${radius},${lat},${lon});
        node["communication"](around:${radius},${lat},${lon});
        way["man_made"="water_works"](around:${radius},${lat},${lon});
        node["man_made"="water_works"](around:${radius},${lat},${lon});
    );out tags center 1;`
}

function formatVoltage(v) {
    return v.split(";").map(s => {
        const n = parseInt(s.trim())
        if (isNaN(n)) return s.trim()
        return n >= 1000 ? `${n / 1000} kV` : `${n} V`
    }).join(" / ")
}

function formatPopup(el) {
    const t = el.tags || {}

    let category = "Infrastructure"
    let color    = "#9AA4B5"

    if (t.power) {
        const labels = { line: "Power Line", cable: "Power Cable", substation: "Substation",
                         generator: "Generator", plant: "Power Plant", tower: "Transmission Tower",
                         pole: "Power Pole", transformer: "Transformer" }
        category = labels[t.power] || `Power (${t.power})`
        color    = "#E8B23A"
    } else if (t.pipeline || t.man_made === "pipeline") {
        category = "Pipeline"
        color    = "#E55757"
    } else if (t.communication) {
        const labels = { line: "Telecom Line", tower: "Telecom Tower", cable: "Telecom Cable" }
        category = labels[t.communication] || `Telecom (${t.communication})`
        color    = "#2ECC71"
    } else if (t.man_made === "water_works") {
        category = "Water Works"
        color    = "#4A9EE0"
    }

    const FIELDS = [
        ["Voltage",    t.voltage    ? formatVoltage(t.voltage) : null],
        ["Circuits",   t.circuits],
        ["Cables",     t.cables],
        ["Wires",      t.wires],
        ["Frequency",  t.frequency  ? `${t.frequency} Hz` : null],
        ["Operator",   t.operator],
        ["Owner",      t.owner],
        ["Name",       t.name],
        ["Ref",        t.ref],
        ["Location",   t.location],
        ["Substance",  t.substance],
        ["Diameter",   t.diameter   ? `${t.diameter} mm` : null],
        ["Pressure",   t.pressure   ? `${t.pressure} bar` : null],
        ["Capacity",   t.capacity || t["capacity:power"]],
        ["Start date", t.start_date],
    ].filter(([, v]) => v)

    const osmUrl  = `https://www.openstreetmap.org/${el.type}/${el.id}`
    const wikiUrl = t.wikipedia ? `https://en.wikipedia.org/wiki/${t.wikipedia.replace(/^[a-z]+:/, "")}` : null
    const wdUrl   = t.wikidata  ? `https://www.wikidata.org/wiki/${t.wikidata}` : null

    const rows = FIELDS.map(([k, v]) => `
        <div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;
                    border-bottom:1px solid rgba(44,54,69,0.4)">
            <span style="color:#9AA4B5;white-space:nowrap;flex-shrink:0">${k}</span>
            <span style="text-align:right;word-break:break-word">${v}</span>
        </div>`).join("")

    const links = [
        `<a href="${osmUrl}" target="_blank" rel="noopener"
            style="color:#4A9EE0;font-size:11px;text-decoration:none">OpenStreetMap ↗</a>`,
        wikiUrl ? `<a href="${wikiUrl}" target="_blank" rel="noopener"
            style="color:#4A9EE0;font-size:11px;text-decoration:none">Wikipedia ↗</a>` : "",
        wdUrl   ? `<a href="${wdUrl}"  target="_blank" rel="noopener"
            style="color:#4A9EE0;font-size:11px;text-decoration:none">Wikidata ↗</a>`  : "",
    ].filter(Boolean).join("")

    return `<div style="
        font-family:Arial,sans-serif;font-size:13px;
        background:#1A2433;color:#E8ECF1;
        padding:14px 18px;border-radius:8px;
        border:1px solid #2C3645;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        min-width:220px;max-width:300px
    ">
        <div style="color:${color};font-weight:bold;font-size:14px;
                    margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #2C3645;
                    display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;
                         background:${color};display:inline-block;flex-shrink:0"></span>
            ${category}
        </div>
        ${rows || `<div style="color:#9AA4B5;font-style:italic;font-size:12px">No detailed attributes</div>`}
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid #2C3645;
                    display:flex;gap:12px;flex-wrap:wrap">
            ${links}
        </div>
    </div>`
}

const LOADING_HTML = `<div style="
    background:#1A2433;color:#9AA4B5;padding:12px 16px;border-radius:8px;
    font-family:Arial,sans-serif;font-size:13px;border:1px solid #2C3645;
    display:flex;align-items:center;gap:8px
">
    <div style="width:14px;height:14px;border:2px solid #4A9EE0;
                border-top-color:transparent;border-radius:50%;
                animation:infra-spin 0.8s linear infinite"></div>
    Querying infrastructure…
</div>`

export default function useInfraClick({ enabled }) {
    const map      = useMap()
    const abortRef = useRef(null)
    const popupRef = useRef(null)

    useEffect(() => {
        if (!enabled || !map) return

        const handleClick = async (e) => {
            if (e.originalEvent?.target?.closest?.(".leaflet-marker-icon, .leaflet-popup")) return

            const { lat, lng } = e.latlng

            if (abortRef.current) abortRef.current.abort()
            abortRef.current = new AbortController()
            if (popupRef.current) map.closePopup(popupRef.current)

            popupRef.current = L.popup({ className: "infra-popup", maxWidth: 320, closeButton: true })
                .setLatLng(e.latlng)
                .setContent(LOADING_HTML)
                .openOn(map)

            try {
                let data = { elements: [] }

                for (const radius of [50, 200]) {
                    const r = await fetch(
                        `${API_BASE}/api/overpass?data=${encodeURIComponent(buildQuery(lat, lng, radius))}`,
                        { signal: abortRef.current.signal }
                    )
                    data = await r.json()
                    if (data.elements?.length) break
                }

                if (data.elements?.length) {
                    popupRef.current.setContent(formatPopup(data.elements[0]))
                } else {
                    map.closePopup(popupRef.current)
                    popupRef.current = null
                }
            } catch (err) {
                if (err.name !== "AbortError" && popupRef.current) {
                    popupRef.current.setContent(
                        `<div style="background:#1A2433;color:#E55757;padding:12px 16px;
                                     border-radius:8px;font-family:Arial;font-size:13px;
                                     border:1px solid #2C3645">Query failed — try again</div>`
                    )
                }
            }
        }

        map.on("click", handleClick)
        return () => {
            map.off("click", handleClick)
            if (abortRef.current) abortRef.current.abort()
        }
    }, [map, enabled])
}
