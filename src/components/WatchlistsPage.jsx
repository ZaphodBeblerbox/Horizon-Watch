import { useMemo, useState } from "react"
import Icon from "../ui/Icon.jsx"
import { Button, EmptyState } from "../ui/index.js"
import NewsMiniMap from "./NewsMiniMap.jsx"
import {
    groupItemsByDomain,
    sortedGroupEntries,
    severityColorToken,
    fusionSeverityToAlertTier,
    itemPrimaryLabel,
    itemChips,
    formatItemTimestamp,
} from "./watchlistsGrouping.js"

/**
 * WatchlistsPage — the real, full-screen "Watchlists" destination (full UI
 * rebuild spec) — the alert console replacing NotificationsDrawer.jsx's
 * slide-in panel. Renders as the main content region below AppHeader/above
 * AppFooter whenever the active destination is "watchlists"; the integrator
 * (not this component) owns that wiring, the `items` data fetch/merge
 * (surfaceItems + /api/fusions via notificationsNormalize.js's
 * mergeNotificationItems), and the readIds/onMarkRead read-tracking state.
 *
 * 3 columns, each filling the full height of whatever container this is
 * mounted in:
 *   - left (280px, --bg-panel): watchlist groups, derived from each item's
 *     real domain (see watchlistsGrouping.js — there is no RuleConfig-backed
 *     "watchlist" grouping wired into this merged item shape, confirmed
 *     against notificationsNormalize.js/backend/main.py, so domain is the
 *     real grouping concept used instead of a fake one).
 *   - center (flexible, --bg-app): the alert stream, filtered by the
 *     selected group. Reuses the exact readIds/onMarkRead contract
 *     NotificationsDrawer.jsx already established.
 *   - right (320px, --bg-panel): full detail for the selected row, including
 *     a small embedded Cesium map (reusing NewsMiniMap.jsx directly, not a
 *     second lightweight-globe implementation) when the item has real
 *     lat/lon.
 *
 * Props:
 *   items          {object[]} - the already-merged, already-sorted list from
 *                    notificationsNormalize.js's mergeNotificationItems
 *                    (plain alert/surface-pool items, or kind:"fusion" items)
 *   readIds        {Set}      - same read-tracking Set NotificationsDrawer
 *                    uses; defaults to an empty Set
 *   onMarkRead     {(id) => void} - same callback NotificationsDrawer uses
 *   onAcknowledge  {(item) => void|Promise} - optional. No confirmed backend
 *                    endpoint exists for this (checked backend/main.py: only
 *                    /api/alerts/{id}/classify and /api/alerts/{id}/pin
 *                    exist, no /acknowledge) — this callback is a hook for an
 *                    integrator-provided handler if one is added later; the
 *                    dim-the-row effect itself is real local-only UI state
 *                    regardless of whether a handler is passed.
 *   onMute         {(item) => void|Promise} - same caveat as onAcknowledge;
 *                    hides the row locally rather than persisting anywhere.
 *   onSelectEntity {(entityType, entityId) => void} - optional. Only wired
 *                    for a fusion item's real `raw.contributing_alert_ids`
 *                    (concrete alert ids, entityType "alert" per
 *                    src/inspector/adapters.js's vocabulary) — domain/type
 *                    chips are categories, not entity ids, so they are
 *                    deliberately NOT wired to this callback (no fabricated
 *                    entity reference).
 */

function noop() {}
const EMPTY_SET = new Set()

function confidencePct(confidence) {
    const n = typeof confidence === "number" ? confidence : Number(confidence)
    if (!Number.isFinite(n)) return 0
    return Math.round(Math.min(1, Math.max(0, n)) * 100)
}

function SectionLabel({ children }) {
    return (
        <div style={{
            fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)",
            color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: "var(--space-2)",
        }}>
            {children}
        </div>
    )
}

function AttributeRow({ label, value }) {
    if (value === null || value === undefined || value === "") return null
    return (
        <div style={{
            display: "flex", justifyContent: "space-between", gap: "var(--space-2)",
            padding: "5px 0", borderBottom: "1px solid var(--border)",
            fontSize: "var(--text-sm)",
        }}>
            <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
            <span style={{ color: "var(--text-primary)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
        </div>
    )
}

function ListSection({ label, items }) {
    if (!Array.isArray(items) || items.length === 0) return null
    return (
        <div style={{ marginTop: "var(--space-4)" }}>
            <SectionLabel>{label}</SectionLabel>
            <ul style={{ margin: 0, paddingLeft: "var(--space-4)", color: "var(--text-secondary)", fontSize: "var(--text-body)", lineHeight: 1.6 }}>
                {items.map((entry, i) => <li key={i}>{entry}</li>)}
            </ul>
        </div>
    )
}

function GroupRow({ label, count, active, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "var(--space-2) var(--space-4)",
                background: active ? "var(--bg-card)" : "transparent",
                border: "none", borderLeft: active ? "2px solid var(--accent-blue)" : "2px solid transparent",
                cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
            }}
        >
            <span style={{
                fontSize: "var(--text-body)", color: active ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: active ? "var(--weight-medium)" : "var(--weight-normal)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
            }}>
                {label}
            </span>
            <span style={{
                fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)",
                color: "var(--text-muted)", flexShrink: 0, marginLeft: "var(--space-2)",
            }}>
                {count}
            </span>
        </button>
    )
}

function AlertRow({ item, isRead, isAcked, isSelected, onSelect, onAcknowledge, onMute }) {
    const color = severityColorToken(item)
    const label = itemPrimaryLabel(item)
    const chips = itemChips(item)
    const ts = formatItemTimestamp(item)
    const isFusion = item.kind === "fusion"

    const activate = () => onSelect(item)
    const onKeyDown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate() } }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={activate}
            onKeyDown={onKeyDown}
            style={{
                display: "flex", flexDirection: "column", gap: 4, width: "100%",
                padding: "var(--space-2) var(--space-4)",
                background: isSelected ? "var(--bg-card)" : "transparent",
                borderBottom: "1px solid var(--border)",
                borderLeft: isFusion ? "2px solid var(--accent-cyan)" : "2px solid transparent",
                cursor: "pointer", fontFamily: "var(--font-sans)", boxSizing: "border-box",
                opacity: isAcked ? 0.5 : (isRead ? 0.85 : 1),
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)",
                    color: "var(--text-secondary)", flexShrink: 0,
                }}>
                    {ts}
                </span>
                {isFusion && (
                    <span style={{
                        fontSize: "var(--text-chip)", fontWeight: "var(--weight-semibold)",
                        color: "var(--accent-cyan)", textTransform: "uppercase", letterSpacing: "0.06em",
                        flexShrink: 0,
                    }}>
                        Fusion · {confidencePct(item.confidence)}%
                    </span>
                )}
                <span style={{
                    fontSize: "var(--text-body)", fontWeight: "var(--weight-medium)",
                    color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", flex: 1, minWidth: 0,
                }}>
                    {label}
                </span>
            </div>

            {!isFusion && item.headline && (
                <div style={{
                    fontSize: "var(--text-sm)", color: "var(--text-secondary)", paddingLeft: 14,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                    {item.headline}
                </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", paddingLeft: 14, flexWrap: "wrap" }}>
                {chips.map((c, i) => (
                    <span key={`${c}-${i}`} style={{
                        fontSize: "var(--text-chip)", padding: "1px 6px", borderRadius: "var(--radius-pill)",
                        border: "1px solid var(--border-strong)", color: "var(--text-secondary)",
                    }}>
                        {c}
                    </span>
                ))}
                <span style={{ flex: 1 }} />
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onAcknowledge(item) }}>
                    Acknowledge
                </Button>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onMute(item) }}>
                    Mute
                </Button>
            </div>
        </div>
    )
}

function DetailPanel({ item, onSelectEntity }) {
    if (!item) {
        return (
            <div style={{ padding: "var(--space-4)" }}>
                <EmptyState
                    icon={<Icon name="target" size={18} />}
                    title="No alert selected"
                    description="Select an alert or fusion event from the list to see full detail."
                />
            </div>
        )
    }

    const isFusion = item.kind === "fusion"
    const color = severityColorToken(item)
    const hasCoords = typeof item.lat === "number" && typeof item.lon === "number"
    const contributingAlertIds = isFusion && Array.isArray(item.raw?.contributing_alert_ids)
        ? item.raw.contributing_alert_ids
        : []

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* What fired */}
            <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{
                        fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)",
                        color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em",
                    }}>
                        {isFusion ? "Fusion Event" : "Alert"}
                    </span>
                </div>
                <div style={{
                    fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)",
                    color: "var(--text-primary)", lineHeight: 1.25,
                }}>
                    {(isFusion ? item.title : item.headline) || ""}
                </div>
                {isFusion && item.subtitle && (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
                        {item.subtitle}
                    </div>
                )}
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginTop: 6 }}>
                    {formatItemTimestamp(item)}
                </div>
            </div>

            {/* Real map — reuses NewsMiniMap.jsx's exact embedded-Cesium pattern.
                Height raised alongside the panel's own width increase (280px
                wide previously) to keep a reasonable aspect ratio rather than
                a wider-but-still-short strip. */}
            {hasCoords && (
                <div style={{ height: 240, flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
                    <NewsMiniMap
                        markers={[{
                            id: item.id,
                            lat: item.lat,
                            lon: item.lon,
                            article: { severity_tier: isFusion ? fusionSeverityToAlertTier(item.severity) : item.severity_tier },
                        }]}
                        selectedId={item.id}
                    />
                </div>
            )}

            {/* Evidence */}
            <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-3) var(--space-4)" }}>
                {isFusion ? (
                    <>
                        {Array.isArray(item.domains) && item.domains.length > 0 && (
                            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                                {item.domains.map((d, i) => (
                                    <span key={`${d}-${i}`} style={{
                                        fontSize: "var(--text-chip)", fontWeight: "var(--weight-semibold)",
                                        padding: "2px 8px", borderRadius: "var(--radius-pill)",
                                        border: `1px solid ${color}`, color,
                                    }}>
                                        {d}
                                    </span>
                                ))}
                            </div>
                        )}

                        <AttributeRow label="Confidence" value={`${confidencePct(item.confidence)}%`} />
                        <AttributeRow label="Signal count" value={item.signal_count} />
                        <AttributeRow label="Location" value={[item.location_name, item.location_country].filter(Boolean).join(", ")} />
                        <AttributeRow label="Status" value={item.status} />
                        <AttributeRow label="Expires" value={item.expires_at} />

                        {item.narrative && (
                            <div style={{ marginTop: "var(--space-4)" }}>
                                <SectionLabel>Narrative</SectionLabel>
                                <div style={{ fontSize: "var(--text-body)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                                    {item.narrative}
                                </div>
                            </div>
                        )}

                        <ListSection label="Key signals" items={item.key_signals} />
                        <ListSection label="Threat indicators" items={item.threat_indicators} />
                        <ListSection label="Recommended actions" items={item.recommended_actions} />

                        {contributingAlertIds.length > 0 && (
                            <div style={{ marginTop: "var(--space-4)" }}>
                                <SectionLabel>Contributing alerts</SectionLabel>
                                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                                    {contributingAlertIds.map((aid) => (
                                        <button
                                            key={aid}
                                            onClick={() => onSelectEntity("alert", aid)}
                                            style={{
                                                fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)",
                                                padding: "2px 8px", borderRadius: "var(--radius-pill)",
                                                border: "1px solid var(--border-strong)", background: "var(--bg-card-2)",
                                                color: "var(--text-link)", cursor: "pointer",
                                            }}
                                        >
                                            {aid}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <AttributeRow label="Location" value={item.location} />
                        <AttributeRow label="Severity" value={item.severity_tier} />
                        <AttributeRow label="Type" value={item.type} />
                        <AttributeRow label="Relevance score" value={typeof item.relevance_score === "number" ? item.relevance_score.toFixed(1) : null} />
                        {item.auto_brief && (
                            <div style={{
                                display: "inline-flex", alignItems: "center", gap: 6, marginTop: "var(--space-3)",
                                fontSize: "var(--text-chip)", fontWeight: "var(--weight-semibold)", color: "var(--accent-blue)",
                            }}>
                                <Icon name="aiCouncil" size={12} />
                                AI brief available
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

export default function WatchlistsPage({
    items = [],
    readIds = EMPTY_SET,
    onMarkRead = noop,
    onAcknowledge = noop,
    onMute = noop,
    onSelectEntity = noop,
}) {
    const [selectedGroup, setSelectedGroup] = useState(null) // null === "All"
    const [selectedId, setSelectedId] = useState(null)
    const [ackedIds, setAckedIds] = useState(() => new Set())
    const [mutedIds, setMutedIds] = useState(() => new Set())

    const groups = useMemo(() => groupItemsByDomain(items), [items])
    const groupEntries = useMemo(() => sortedGroupEntries(groups), [groups])

    const visibleItems = useMemo(() => {
        const base = selectedGroup ? (groups[selectedGroup] || []) : items
        return base.filter((i) => !mutedIds.has(i.id))
    }, [items, groups, selectedGroup, mutedIds])

    const selectedItem = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId])

    const handleSelect = (item) => {
        setSelectedId(item.id)
        onMarkRead(item.id)
    }

    const handleAcknowledge = async (item) => {
        try { await onAcknowledge(item) } catch (_e) { /* no confirmed backend endpoint — local state still applies */ }
        setAckedIds((prev) => new Set(prev).add(item.id))
    }

    const handleMute = async (item) => {
        try { await onMute(item) } catch (_e) { /* no confirmed backend endpoint — local state still applies */ }
        setMutedIds((prev) => new Set(prev).add(item.id))
        if (selectedId === item.id) setSelectedId(null)
    }

    const unreadShown = visibleItems.filter((i) => !readIds?.has(i.id)).length

    return (
        <div style={{ display: "flex", width: "100%", height: "100%", background: "var(--bg-app)", overflow: "hidden" }}>
            {/* Left — watchlist groups */}
            <div style={{
                width: 280, flexShrink: 0, background: "var(--bg-panel)",
                borderRight: "1px solid var(--border)", overflowY: "auto",
                display: "flex", flexDirection: "column",
            }}>
                <div style={{ padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                    <span style={{
                        fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)",
                        color: "var(--text-primary)",
                    }}>
                        Watchlists
                    </span>
                </div>
                <GroupRow label="All" count={items.length} active={selectedGroup === null} onClick={() => setSelectedGroup(null)} />
                {groupEntries.map(([name, groupItems]) => (
                    <GroupRow
                        key={name}
                        label={name}
                        count={groupItems.length}
                        active={selectedGroup === name}
                        onClick={() => setSelectedGroup(name)}
                    />
                ))}
            </div>

            {/* Center — alert stream */}
            <div style={{ flex: 1, minWidth: 0, background: "var(--bg-app)", display: "flex", flexDirection: "column" }}>
                <div style={{
                    padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
                }}>
                    <span style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        {selectedGroup || "All Alerts"}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)" }}>
                        {unreadShown} unread · {visibleItems.length} shown
                    </span>
                </div>

                <div style={{ flex: 1, overflowY: "auto" }}>
                    {visibleItems.length === 0 ? (
                        <div style={{ padding: "var(--space-4)" }}>
                            <EmptyState title="No alerts" description="No alerts match this watchlist yet." />
                        </div>
                    ) : (
                        visibleItems.map((item) => (
                            <AlertRow
                                key={item.id}
                                item={item}
                                isRead={readIds?.has(item.id)}
                                isAcked={ackedIds.has(item.id)}
                                isSelected={item.id === selectedId}
                                onSelect={handleSelect}
                                onAcknowledge={handleAcknowledge}
                                onMute={handleMute}
                            />
                        ))
                    )}
                </div>
            </div>

            {/* Right — detail. Widened from 320 (the minimap inside was
                reading as too small) — reclaimed from the center alert
                stream's own flexible width, which still gets whatever's
                left rather than a fixed share, so it never gets crowded
                out, just modestly narrower on typical viewport widths. */}
            <div style={{
                width: 420, flexShrink: 0, background: "var(--bg-panel)",
                borderLeft: "1px solid var(--border)", overflowY: "auto",
            }}>
                <DetailPanel item={selectedItem} onSelectEntity={onSelectEntity} />
            </div>
        </div>
    )
}
