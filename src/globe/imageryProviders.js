import { UrlTemplateImageryProvider, Credit } from "cesium"
import API_BASE from "../apiBase.js"

// ESRI World Imagery — satellite base used when overlays are active
// (replaces Google 3D Tiles which bury imagery layers under their mesh)
export const esriSatelliteProvider = new UrlTemplateImageryProvider({
    url:          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit:       new Credit("Esri, Maxar, Earthstar Geographics", false),
})

// ESRI World Dark Gray Canvas — real, free, no-key basemap (verified live:
// services.arcgisonline.com/.../Canvas/World_Dark_Gray_Base) used as the
// Situation globe's "Dark" basemap preset. Not a bespoke/invented style —
// this is the actual stock dark map Esri/Cesium examples reuse.
export const esriDarkProvider = new UrlTemplateImageryProvider({
    url:          "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit:       new Credit("Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community", false),
})

// OpenSeaMap nautical seamarks
export const openSeaMapProvider = new UrlTemplateImageryProvider({
    url:          "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    maximumLevel: 18,
    credit:       new Credit("OpenSeaMap contributors", false),
})

// ESRI Reference — transparent label + border overlay, designed to sit on top of satellite imagery
export const esriLabelsProvider = new UrlTemplateImageryProvider({
    url:          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit:       new Credit("Esri", false),
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
