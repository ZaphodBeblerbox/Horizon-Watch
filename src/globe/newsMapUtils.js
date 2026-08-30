/**
 * newsMapUtils.js — pure helpers for the NewsPage desktop mini-map.
 *
 * Real story locations only: `/api/surface` news items carry real `lat`/`lon`
 * floats (see backend/main.py _build_surface_pool()._collect_news_items —
 * items without a real lat/lon are dropped before they ever reach the
 * surface pool). Other feeds this page also renders (spaceflight, per-city,
 * markets) come from different endpoints that do NOT carry lat/lon at all.
 * These helpers never invent a location for an article that lacks one —
 * an article without real, finite coordinates is simply excluded from the
 * plottable set, not defaulted to (0,0) or any other placeholder.
 *
 * Kept dependency-free (no React, no Cesium) so they can be unit-tested as
 * plain functions, matching the pattern markerRenderer.js/.test.js already
 * uses in this codebase.
 */

/** A stable identity for an article, preferring its real backend id/url. */
export function articleKey(article, fallbackIndex = 0) {
    if (!article) return `empty-${fallbackIndex}`
    if (article.id !== undefined && article.id !== null && article.id !== "") return String(article.id)
    return article.url || article.link || article.headline || article.title || `idx-${fallbackIndex}`
}

/**
 * True only for a real, finite [lat, lon] pair. (0, 0) is treated as "no
 * real location" — it is the common placeholder/default value some feeds
 * use for missing geodata, not a genuine real-world story location, and
 * plotting it would be indistinguishable from fabricating a location.
 */
export function hasRealCoordinates(article) {
    if (!article) return false
    const lat = Number(article.lat)
    const lon = Number(article.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
    if (lat === 0 && lon === 0) return false
    return true
}

/**
 * Filters `articles` down to the subset with real coordinates, returning
 * lightweight plot records: { id, lat, lon, article }.
 */
export function getPlottableArticles(articles) {
    if (!Array.isArray(articles)) return []
    const out = []
    articles.forEach((article, index) => {
        if (!hasRealCoordinates(article)) return
        out.push({
            id:  articleKey(article, index),
            lat: Number(article.lat),
            lon: Number(article.lon),
            article,
        })
    })
    return out
}

/**
 * Given the plottable set and the currently-selected story, returns the
 * matching marker record (or null — e.g. the selected story has no real
 * coordinates, so there is nothing to highlight on the map).
 */
export function findHighlightedMarker(plottable, selectedArticle) {
    if (!selectedArticle || !Array.isArray(plottable) || plottable.length === 0) return null
    const byRef = plottable.find(m => m.article === selectedArticle)
    if (byRef) return byRef
    const targetKey = articleKey(selectedArticle)
    return plottable.find(m => m.id === targetKey) || null
}

/**
 * Builds the two "detail view" actions for a selected story. Both callbacks
 * are invoked with the real story object, unmodified — callers further up
 * the tree (app.jsx, wired outside this component) decide what to do with
 * it (fly the main globe camera / open a unified inspector).
 */
export function buildStoryActions(story, { onJumpToLocation, onOpenInspector } = {}) {
    const jump      = typeof onJumpToLocation === "function" ? onJumpToLocation : () => {}
    const inspector = typeof onOpenInspector === "function" ? onOpenInspector : () => {}
    return {
        jumpToLocation: () => jump(story),
        openInspector:  () => inspector(story),
    }
}
