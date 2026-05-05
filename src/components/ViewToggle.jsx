export default function ViewToggle({ mode, onToggle }) {
    return (
        <div style={{
            display:      "flex",
            gap:          1,
            background:   "rgba(15,23,42,0.8)",
            borderRadius: 5,
            padding:      1,
            border:       "1px solid rgba(56,189,248,0.18)",
            flexShrink:   0,
        }}>
            {["2d", "3d"].map(m => (
                <button
                    key={m}
                    onClick={() => onToggle(m)}
                    style={{
                        padding:       "1px 7px",
                        borderRadius:  3,
                        border:        "none",
                        cursor:        "pointer",
                        fontSize:      10,
                        fontWeight:    700,
                        letterSpacing: "0.07em",
                        fontFamily:    "system-ui, -apple-system, sans-serif",
                        background:    mode === m ? "#38bdf8" : "transparent",
                        color:         mode === m ? "#0f172a" : "rgba(148,163,184,0.7)",
                        transition:    "background 0.12s, color 0.12s",
                        lineHeight:    "16px",
                    }}
                >{m.toUpperCase()}</button>
            ))}
        </div>
    )
}
