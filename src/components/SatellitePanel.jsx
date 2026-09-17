export default function SatellitePanel({
    open,
    loading,
    error,
    credentialsConfigured,
    scenes,
    selectedId,
    opacity,
    onSelect,
    onOpacityChange,
    onClose,
}) {
    if (!open) return null

    const panelStyle = {
        position: "absolute",
        left: 16,
        bottom: 16,
        width: 280,
        background: "rgb(6, 13, 26)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10,
        color: "#e8edf2",
        zIndex: 2100,
        overflow: "hidden",
    }

    return (
        <div style={panelStyle}>
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" }}>
                        SATELLITE IMAGERY
                    </div>
                    <div style={{ fontSize: 10, color: "#8899aa", marginTop: 2 }}>
                        Sentinel-2 scenes for current view
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: "none",
                        border: "none",
                        color: "rgba(255,255,255,0.5)",
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                        padding: 0,
                    }}
                >
                    ×
                </button>
            </div>

            {!credentialsConfigured && (
                <div style={{
                    margin: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(217,119,6,0.12)",
                    border: "1px solid rgba(217,119,6,0.35)",
                    color: "#fbbf24",
                    fontSize: 11,
                    lineHeight: 1.5,
                }}>
                    Copernicus credentials required — add COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET to environment variables
                </div>
            )}

            {error && (
                <div style={{
                    margin: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(220,38,38,0.12)",
                    border: "1px solid rgba(220,38,38,0.35)",
                    color: "#f87171",
                    fontSize: 11,
                }}>
                    {error}
                </div>
            )}

            <div style={{ padding: "0 12px 12px", maxHeight: 320, overflowY: "auto" }}>
                {loading && (
                    <div style={{ padding: "12px 0", fontSize: 11, color: "#8899aa" }}>
                        Searching scenes...
                    </div>
                )}

                {!loading && scenes.length === 0 && !error && credentialsConfigured && (
                    <div style={{ padding: "12px 0", fontSize: 11, color: "#8899aa" }}>
                        No Sentinel-2 scenes found for this view.
                    </div>
                )}

                {scenes.map((scene) => {
                    const selected = scene.id === selectedId
                    return (
                        <button
                            key={scene.id}
                            onClick={() => onSelect(scene)}
                            style={{
                                width: "100%",
                                display: "flex",
                                gap: 10,
                                textAlign: "left",
                                marginTop: 10,
                                padding: 10,
                                background: selected ? "rgba(26,110,181,0.16)" : "rgba(255,255,255,0.03)",
                                border: `1px solid ${selected ? "rgba(26,110,181,0.45)" : "rgba(255,255,255,0.08)"}`,
                                borderRadius: 8,
                                cursor: "pointer",
                                color: "#e8edf2",
                            }}
                        >
                            <div style={{
                                width: 72,
                                height: 72,
                                borderRadius: 6,
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.06)",
                            }}>
                                {scene.thumbnail ? (
                                    <img
                                        src={scene.thumbnail}
                                        alt={scene.tile_id || scene.id}
                                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                    />
                                ) : null}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontSize: 11, fontWeight: 700 }}>
                                    {scene.datetime ? new Date(scene.datetime).toLocaleDateString() : "Unknown date"}
                                </div>
                                <div style={{ fontSize: 10, color: "#8899aa", marginTop: 4 }}>
                                    Cloud cover: {scene.cloud_cover != null ? `${Math.round(scene.cloud_cover)}%` : "N/A"}
                                </div>
                                <div style={{ fontSize: 10, color: "#8899aa", marginTop: 2 }}>
                                    Sensor: {scene.platform || scene.collection || "Sentinel-2"}
                                </div>
                            </div>
                        </button>
                    )
                })}
            </div>

            <div style={{ padding: "0 12px 12px" }}>
                <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 6 }}>
                    Overlay opacity: {opacity}%
                </div>
                <input
                    type="range"
                    min={0}
                    max={100}
                    value={opacity}
                    onChange={(e) => onOpacityChange(Number(e.target.value))}
                    style={{ width: "100%", cursor: "pointer" }}
                />
            </div>
        </div>
    )
}
