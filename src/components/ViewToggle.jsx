export default function ViewToggle({ mode, onToggle }) {
    return (
        <div style={{
            display:      "flex",
            gap:          2,
            background:   "rgba(15,23,42,0.8)",
            borderRadius: 6,
            padding:      2,
            border:       "1px solid rgba(56,189,248,0.2)",
            flexShrink:   0,
        }}>
            <button
                onClick={() => onToggle("2d")}
                style={{
                    padding:      "3px 10px",
                    borderRadius: 4,
                    border:       "none",
                    cursor:       "pointer",
                    fontSize:     11,
                    fontWeight:   700,
                    letterSpacing: "0.06em",
                    fontFamily:   "system-ui, -apple-system, sans-serif",
                    background:   mode === "2d" ? "#38bdf8" : "transparent",
                    color:        mode === "2d" ? "#0f172a" : "rgba(148,163,184,0.8)",
                    transition:   "background 0.15s, color 0.15s",
                }}
            >2D</button>
            <button
                onClick={() => onToggle("3d")}
                style={{
                    padding:      "3px 10px",
                    borderRadius: 4,
                    border:       "none",
                    cursor:       "pointer",
                    fontSize:     11,
                    fontWeight:   700,
                    letterSpacing: "0.06em",
                    fontFamily:   "system-ui, -apple-system, sans-serif",
                    background:   mode === "3d" ? "#38bdf8" : "transparent",
                    color:        mode === "3d" ? "#0f172a" : "rgba(148,163,184,0.8)",
                    transition:   "background 0.15s, color 0.15s",
                }}
            >3D</button>
        </div>
    )
}
