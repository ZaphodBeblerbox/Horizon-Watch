import { TileLayer } from "react-leaflet"

export default function InfrastructureLayer({ enabled }) {
    if (!enabled) return null

    return (
        <TileLayer
            url="https://openinframap.org/map.png/{z}/{x}/{y}"
            attribution='&copy; <a href="https://openinframap.org" target="_blank" rel="noopener">OpenInfraMap</a> contributors'
            opacity={0.85}
            zIndex={150}
            maxNativeZoom={17}
            maxZoom={20}
        />
    )
}
