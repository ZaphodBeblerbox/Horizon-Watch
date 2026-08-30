// Pure aggregation of the real GET /api/health/detailed response into the
// 3-state system status the full-UI-rebuild spec's header pill and footer
// need (section 3.1: "a 6px colored dot — live green = OPERATIONAL, warn
// amber = DEGRADED/DATA DELAY/PARTIAL OUTAGE, danger red = MAINTENANCE/
// OUTAGE"). Real per-source status values (see src/components/HealthPanel.jsx,
// which already consumes this same endpoint): "ok" | "degraded" | "pending" | "error".
export function summarizeHealth(healthData) {
    if (!healthData) return { status: "operational", detail: "ALL FEEDS LIVE", degradedCount: 0 }

    const sources = Array.isArray(healthData.data_sources) ? healthData.data_sources : []
    const backendStatus = healthData.backend?.status

    const errorCount = sources.filter((s) => s.status === "error").length
    const degradedCount = sources.filter((s) => s.status === "degraded" || s.status === "pending").length

    if (backendStatus === "error" || errorCount > 0) {
        const n = errorCount + (backendStatus === "error" ? 1 : 0)
        return { status: "outage", detail: `${n} FEED${n === 1 ? "" : "S"} DOWN`, degradedCount }
    }
    if (backendStatus === "degraded" || degradedCount > 0) {
        return { status: "degraded", detail: `${degradedCount} FEED${degradedCount === 1 ? "" : "S"} DEGRADED`, degradedCount }
    }
    return { status: "operational", detail: "ALL FEEDS LIVE", degradedCount: 0 }
}

export const STATUS_COLOR_TOKEN = {
    operational: "var(--live)",
    degraded: "var(--warn)",
    outage: "var(--danger)",
}

export const STATUS_WORD = {
    operational: "OPERATIONAL",
    degraded: "DEGRADED",
    outage: "OUTAGE",
}
