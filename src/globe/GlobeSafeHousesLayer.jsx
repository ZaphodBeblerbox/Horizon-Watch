/**
 * GlobeSafeHousesLayer.jsx — the SAFE HOUSES layer (owner, 2026-10-12): every
 * safe house this user can see (GET /api/evacuations/safe-houses), a green
 * house-with-a-check pin — grey when closed — named close in, with how many
 * places are free. A click opens it like any asset (entityStore "owned_asset").
 * The register's own pins (GlobeAssetsLayer) leave safe houses to this layer.
 */
import { useEffect, useState } from "react"
import { Entity } from "resium"
import { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, HeightReference, LabelStyle, NearFarScalar, VerticalOrigin } from "cesium"
import { listSafeHouses } from "../evacuation/api.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { safeHouseIcon, placesLabel } from "../evacuation/safeHouseIcon.js"

export default function GlobeSafeHousesLayer({ enabled = true }) {
    const [houses, setHouses] = useState([])
    useEffect(() => {
        if (!enabled) { setHouses([]); return undefined }
        let live = true
        const load = () => listSafeHouses().then((d) => { if (live) setHouses(d.filter((h) => h.lat != null)) }).catch(() => {})
        load()
        const iv = setInterval(load, 120_000)
        window.addEventListener("akili:assets-changed", load)
        return () => { live = false; clearInterval(iv); window.removeEventListener("akili:assets-changed", load) }
    }, [enabled])
    useEffect(() => {
        houses.forEach((h) => setEntity(`safehouse-${h.id}`, "owned_asset", {
            ...h, kind: h.kind || "safe_house", kind_label: h.kind_label || "Safe house", group: h.declared ? "Sites" : "Safety", is_safe_house: true, position: { lat: h.lat, lon: h.lon },
            details: { status: h.status, capacity: h.capacity, occupancy: h.occupancy, contact: h.contact,
                       allowed_users: h.allowed_users, allowed_teams: h.allowed_teams },
        }))
        return () => houses.forEach((h) => deleteEntity(`safehouse-${h.id}`))
    }, [houses])
    if (!enabled) return null
    return houses.map((h) => (
        <Entity key={h.id} id={`safehouse-${h.id}`} name={`Safe house — ${h.name}`} position={Cartesian3.fromDegrees(h.lon, h.lat)}
                billboard={{ image: safeHouseIcon(h.status === "closed"), width: 32, height: 38, verticalOrigin: VerticalOrigin.BOTTOM,
                             heightReference: HeightReference.CLAMP_TO_GROUND, eyeOffset: new Cartesian3(0, 0, -150),
                             scaleByDistance: new NearFarScalar(2e4, 1.15, 8e6, 0.75) }}
                label={{ text: `${h.name}${h.status === "closed" ? " · closed" : placesLabel(h)}`, font: "600 13px sans-serif",
                         fillColor: Color.fromCssColorString("#d8ffe6"), outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
                         verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 6), heightReference: HeightReference.CLAMP_TO_GROUND,
                         distanceDisplayCondition: new DistanceDisplayCondition(0, 900_000) }} />
    ))
}
