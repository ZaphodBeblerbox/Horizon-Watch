import { UrlTemplateImageryProvider, Credit } from "cesium"
import API_BASE from "../apiBase.js"

// ESRI World Imagery — satellite base used when overlays are active
// (replaces Google 3D Tiles which bury imagery layers under their mesh)
export const esriSatelliteProvider = new UrlTemplateImageryProvider({
    url:          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit:       new Credit("Esri, Maxar, Earthstar Geographics", false),
})

// OpenSeaMap nautical seamarks
export const openSeaMapProvider = new UrlTemplateImageryProvider({
    url:          "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    maximumLevel: 18,
    credit:       new Credit("OpenSeaMap contributors", false),
})

// OpenInfraMap — PBF tiles rendered server-side to PNG rasters.
// Requires backend /api/tiles/openinfra-render/{z}/{x}/{y}.png endpoint.
export const openInfraRasterProvider = new UrlTemplateImageryProvider({
    url:          `${API_BASE}/api/tiles/openinfra-render/{z}/{x}/{y}.png`,
    tileWidth:    1024,
    tileHeight:   1024,
    maximumLevel: 18,
    credit:       new Credit("OpenInfraMap contributors (ODbL)", false),
})
