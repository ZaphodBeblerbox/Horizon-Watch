import { STATUS_COLOR_TOKEN } from "../utils/systemHealth.js"

/**
 * Persistent application footer — full UI rebuild spec section 3.2.
 * 28-32px tall, --bg-app background, --text-muted text. Three zones: left
 * (product/version/platform), center (current mode/destination name),
 * right (real feed-freshness indicator, colored by real system health —
 * no fake session-ID-style text implying a security model that doesn't
 * exist here).
 */
export default function AppFooter({ modeLabel = "Maritime Operational View", systemHealth = { status: "operational", detail: "ALL FEEDS LIVE" } }) {
    return (
        <div style={{
            height: "var(--footer-height)", flexShrink: 0, background: "var(--bg-app)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 var(--space-4)", fontFamily: "var(--font-sans)",
            fontSize: "var(--text-footer)", color: "var(--text-muted)",
        }}>
            <span>HORIZON WATCH v1.0 · WEB</span>
            <span>{modeLabel}</span>
            <span style={{ color: STATUS_COLOR_TOKEN[systemHealth.status] || STATUS_COLOR_TOKEN.operational }}>
                {systemHealth.detail}
            </span>
        </div>
    )
}
