import { UrlTemplateImageryProvider, Credit,
         TileMapServiceImageryProvider, buildModuleUrl } from "cesium"
import API_BASE from "../apiBase.js"

// ESRI World Imagery — satellite base used when overlays are active
// (replaces Google 3D Tiles which bury imagery layers under their mesh)
export const esriSatelliteProvider = new UrlTemplateImageryProvider({
    url:          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    // 19 is right for this one, and checked rather than inherited:
    // real tiles at Frankfurt, Manhattan and Dubai through z19, and the
    // "Map data not yet available" placeholder at z20 in two of the
    // three. See the note on the dark layer below for how that is told
    // apart from real imagery.
    maximumLevel: 19,
    credit:       new Credit("Esri, Maxar, Earthstar Geographics", false),
})

// ESRI World Dark Gray Canvas — real, free, no-key basemap (verified live:
// services.arcgisonline.com/.../Canvas/World_Dark_Gray_Base) used as the
// Situation globe's "Dark" basemap preset. Not a bespoke/invented style —
// this is the actual stock dark map Esri/Cesium examples reuse.
export const esriDarkProvider = new UrlTemplateImageryProvider({
    url:          "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    // SIXTEEN, NOT NINETEEN. This layer only has real tiles to level 16.
    // Past that Esri answers with a 200 and a 2,521-byte PNG that reads
    // "Map data not yet available" — so the globe did not fail, it
    // faithfully drew the words. Measured by fetching the same zoom at
    // Frankfurt, Manhattan and Dubai: identical bytes at every one from
    // z17 up, distinct real tiles at z16 and below. Cesium upsamples
    // level 16 beyond this, which is blurry and continuous rather than
    // sharp and wrong.
    //
    // The service's own metadata is no help here: it advertises LODs to
    // level 23, because that describes the tiling scheme rather than
    // what has been published into it.
    maximumLevel: 16,
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

// ── The map that works with no network at all ────────────────────────────
//
// Natural Earth II, which ships inside Cesium's own build and is therefore
// already on disk in this bundle (dist/cesium/Assets/Textures/NaturalEarthII,
// about half a megabyte, zoom 0-2). It is coarse — continents and country
// shapes, no detail past a few hundred kilometres — and that is the point:
// it is the floor, not the map.
//
// IT IS DRAWN UNDERNEATH THE REAL BASEMAP, ALWAYS, rather than swapped in
// when something decides the app is offline. Online it is invisible because
// Esri's tiles cover it. Offline, or through a tunnel, or when Esri is
// simply slow, those tiles never arrive and this shows through instead of a
// blank blue sphere. No online/offline detection to get wrong, and partial
// connectivity — the case that actually happens — degrades to "less detail"
// rather than to "nothing".
//
// Returned as a promise because Cesium 1.141 made these providers async;
// the caller adds the layer when it resolves and the globe renders without
// it until then.
export function offlineBasemapProvider() {
    return TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl("Assets/Textures/NaturalEarthII"),
        { credit: new Credit("Natural Earth II", false) })
}
