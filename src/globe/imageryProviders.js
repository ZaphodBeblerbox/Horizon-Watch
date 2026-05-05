import { UrlTemplateImageryProvider, Credit } from "cesium"

// ESRI World Imagery — satellite base used when overlays are active
// (replaces Google 3D Tiles which bury imagery layers under their mesh)
export const esriSatelliteProvider = new UrlTemplateImageryProvider({
    url:          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit:       new Credit("Esri, Maxar, Earthstar Geographics", false),
})

// OIM tiles are PBF vector — UrlTemplateImageryProvider cannot render them.
// Infrastructure overlay is Leaflet-only (InfrastructureLayer.jsx via VectorGrid).
// export const openInfraProvider = null   (removed)

export const openSeaMapProvider = new UrlTemplateImageryProvider({
    url:          "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    maximumLevel: 18,
    credit:       new Credit("OpenSeaMap contributors", false),
})
