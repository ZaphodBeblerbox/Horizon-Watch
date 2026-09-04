/**
 * TabStrip.jsx — redesign Round 2, §3. A real reusable-tab model: opening a
 * module reuses its existing tab, closing the active tab selects the last
 * remaining one, closing the last tab reopens Situation. Tabs carry a real
 * module key (`moduleKey`) plus an optional contextual retitle (`label`)
 * distinct from the module's own display name — e.g. a Dossier tab reads
 * "Dossier · Red Sea corridor", not just "Dossiers". app.jsx owns the real
 * tab array/state (extends its pre-existing tab system rather than
 * duplicating it); this component is purely the real rendering + row
 * interactions.
 *
 * liveFeedCount: real count of currently-"ok" data sources (GET
 * /api/health/detailed) — not fabricated. No real per-second ingestion-rate
 * metric exists anywhere in this backend, so that element from the spec is
 * deliberately omitted here rather than invented.
 */
export default function TabStrip({ tabs, activeTabId, onSelect, onClose, onOpenPalette, liveFeedCount = null }) {
    return (
        <div style={{
            height: "var(--tabs)", flexShrink: 0, background: "var(--bg-1)",
            borderBottom: "1px solid var(--line)", display: "flex", alignItems: "stretch",
        }}>
            <div style={{ flex: 1, display: "flex", overflowX: "auto" }}>
                {tabs.map((t) => {
                    const active = t.id === activeTabId
                    return (
                        <div
                            key={t.id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => onSelect(t.id)}
                            className="wstab-row"
                            style={{
                                position: "relative", display: "flex", alignItems: "center", gap: 6,
                                padding: "0 10px", height: "100%", cursor: "pointer",
                                background: active ? "var(--bg-0)" : "transparent",
                                borderTop: active ? "1px solid var(--acc-hi)" : "1px solid transparent",
                                borderRight: "1px solid var(--line-soft)",
                                maxWidth: 232, flexShrink: 0,
                            }}
                        >
                            <span style={{
                                width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                                background: t.statusColor || "var(--grey)",
                            }} />
                            <span style={{
                                font: "400 12px var(--font)", color: active ? "var(--txt)" : "var(--txt-2)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 216,
                            }}>
                                {t.label}
                            </span>
                            {tabs.length > 1 && (
                                <span
                                    role="button" tabIndex={0}
                                    className="wstab-close"
                                    onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onClose(t.id) } }}
                                    style={{
                                        display: "none", width: 14, height: 14, borderRadius: "var(--r)",
                                        alignItems: "center", justifyContent: "center", color: "var(--txt-4)",
                                        flexShrink: 0, fontSize: 12, lineHeight: 1, marginLeft: 2,
                                    }}
                                    title="Close tab"
                                >×</span>
                            )}
                        </div>
                    )
                })}
                <button
                    onClick={onOpenPalette}
                    title="New tab"
                    style={{
                        width: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                    }}
                >
                    <svg className="icon sm"><use href="#i-plus" /></svg>
                </button>
            </div>

            {liveFeedCount != null && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
                    borderLeft: "1px solid var(--line)", flexShrink: 0,
                }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{liveFeedCount} live</span>
                </div>
            )}
            <style>{`
                .wstab-row:hover .wstab-close { display: flex !important; }
            `}</style>
        </div>
    )
}
