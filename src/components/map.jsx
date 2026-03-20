import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet"
import { useEffect } from "react"

const TYPE_COLOR = {
    "Protests": "#3498db",
    "Violence against civilians": "#c0392b",
    "Battles": "#8e44ad",
    "Explosions/Remote violence": "#e74c3c",
    "Strategic developments": "#27ae60",
    "Riots": "#e67e22",
}

function FlyTo({ event }) {
    const map = useMap()
    useEffect(() => {
        if (event?.lat && event?.lng) {
            map.flyTo([event.lat, event.lng], 8, { duration: 0.8 })
        }
    }, [event])
    return null
}

export default function MapView({ events, selected, onSelect }) {
    return (
        <div style={{ flex: 1, position: "relative" }}>
            <MapContainer
                center={[-6.3, 35.0]}
                zoom={6}
                style={{ width: "100%", height: "100%" }}
                zoomControl={true}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution=""
                />
                <FlyTo event={selected} />
                {events.map(ev => (
                    <CircleMarker
                        key={ev.id}
                        center={[ev.lat, ev.lng]}
                        radius={selected?.id === ev.id ? 10 : ev.fatalities > 0 ? 7 : 5}
                        pathOptions={{
                            fillColor: TYPE_COLOR[ev.type] || "#666",
                            fillOpacity: selected?.id === ev.id ? 1 : 0.7,
                            color: selected?.id === ev.id ? "#0a0a0a" : "white",
                            weight: selected?.id === ev.id ? 2 : 1
                        }}
                        eventHandlers={{ click: () => onSelect(ev) }}
                    >
                        <Tooltip sticky>
                            <div style={{ fontSize: 12 }}>
                                <strong>{ev.type}</strong><br />
                                {ev.location} · {ev.date}<br />
                                {ev.fatalities > 0 && `${ev.fatalities} fatalities`}
                            </div>
                        </Tooltip>
                    </CircleMarker>
                ))}
            </MapContainer>

            {/* Map Legend */}
            <div style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                background: "rgba(255,255,255,0.88)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(0,0,0,0.10)",
                padding: "10px 14px",
                zIndex: 1000,
                fontSize: 11
            }}>
                {Object.entries(TYPE_COLOR).map(([type, color]) => (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
                        <span style={{ color: "#555" }}>{type}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}