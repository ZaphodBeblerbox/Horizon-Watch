import { useBriefingCount } from "../state/briefingBasket.js"

function Cell({ label, value, mono = true }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0 10px",
            borderRight: "1px solid var(--line)", height: "100%", flexShrink: 0,
        }}>
            <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{label}</span>
            <span style={{ font: `400 11px ${mono ? "var(--mono)" : "var(--font)"}`, color: "var(--txt-2)" }}>{value}</span>
        </div>
    )
}

/**
 * StatusBar.jsx — redesign Round 2, §4. Replaces AppFooter.jsx. Every cell
 * is real or omitted, per the ground rule — no randomized fake latency, no
 * "sample corpus" label:
 *   - connection: backend.status from GET /api/health/detailed
 *   - data volume: real sum of every data_sources[].record_count/
 *     vessel_count field present in that same response — not a hardcoded
 *     source list, so it stays honest if sources are added/removed
 *   - latency: backend.ping_ms, actually measured server-side, never
 *     randomized client-side
 *   - tasks: real GET /api/reports/tasks length
 *   - briefing basket: real live count from state/briefingBasket.js
 *   - build: __APP_VERSION__ (package.json's real version, vite.config.js)
 */
export default function StatusBar({ health, taskCount = null }) {
    const briefingCount = useBriefingCount()

    const backendStatus = health?.backend?.status
    const connectionLabel = backendStatus === "ok" ? "Connected" : backendStatus === "degraded" ? "Degraded" : backendStatus === "error" ? "Down" : "—"
    const pingMs = health?.backend?.ping_ms
    const dataVolume = Array.isArray(health?.data_sources)
        ? health.data_sources.reduce((sum, s) => {
            const n = s.record_count ?? s.vessel_count ?? s.event_count
            return typeof n === "number" ? sum + n : sum
        }, 0)
        : null

    return (
        <div style={{
            height: "var(--status)", flexShrink: 0, background: "var(--bg-2)",
            borderTop: "1px solid var(--line)", display: "flex", alignItems: "stretch",
            overflow: "hidden",
        }}>
            <Cell label="Connection" value={connectionLabel} mono={false} />
            {dataVolume != null && <Cell label="Data volume" value={dataVolume.toLocaleString()} />}
            {typeof pingMs === "number" && <Cell label="Latency" value={`${pingMs.toFixed(0)}ms`} />}
            {taskCount != null && <Cell label="Tasks" value={taskCount} />}
            <div style={{ flex: 1 }} />
            <Cell label="Briefing basket" value={briefingCount} />
            <div style={{ display: "flex", alignItems: "center", padding: "0 10px", flexShrink: 0 }}>
                <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>
                    Horizon Watch v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"}
                </span>
            </div>
        </div>
    )
}
