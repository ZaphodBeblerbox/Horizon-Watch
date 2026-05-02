import { useState, useEffect, useCallback } from "react"

const RANGE_MINUTES = 24 * 60  // 24-hour window

function _fmt(date) {
  return date.toLocaleString([], {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

const STYLES = `
@keyframes _ts_pulse {
  0%, 100% { opacity: 1 }
  50%       { opacity: 0.45 }
}
.ts-live-dot {
  animation: _ts_pulse 1.4s ease-in-out infinite;
}
.ts-range {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    #3b82f6 0%,
    #3b82f6 var(--pct, 100%),
    rgba(255,255,255,0.15) var(--pct, 100%),
    rgba(255,255,255,0.15) 100%
  );
}
.ts-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #3b82f6;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.ts-range::-moz-range-thumb {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #3b82f6;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
`

export default function TimeSlider({ onTimeChange, onClose }) {
  // minutesAgo: 0 = live/now, RANGE_MINUTES = 24h ago
  const [minutesAgo, setMinutesAgo] = useState(0)
  const isLive = minutesAgo === 0

  const selectedDate = isLive
    ? null
    : new Date(Date.now() - minutesAgo * 60_000)

  const pct = Math.round((1 - minutesAgo / RANGE_MINUTES) * 100)

  const handleChange = useCallback((e) => {
    const val = Number(e.target.value)
    // slider left = past, right = now: invert
    const ago = RANGE_MINUTES - val
    setMinutesAgo(ago)
    const ts = ago === 0 ? null : new Date(Date.now() - ago * 60_000).toISOString()
    onTimeChange(ts)
  }, [onTimeChange])

  const goLive = useCallback(() => {
    setMinutesAgo(0)
    onTimeChange(null)
    onClose()
  }, [onTimeChange, onClose])

  // Notify parent on mount — start at live
  useEffect(() => {
    onTimeChange(null)
    return () => onTimeChange(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sliderVal = RANGE_MINUTES - minutesAgo

  return (
    <>
      <style>{STYLES}</style>
      <div style={{
        position:        "absolute",
        bottom:          56,
        left:            "50%",
        transform:       "translateX(-50%)",
        zIndex:          1000,
        background:      "rgba(10,15,25,0.93)",
        border:          "1px solid rgba(255,255,255,0.10)",
        borderRadius:    10,
        padding:         "10px 16px 12px",
        width:           "min(520px, 90vw)",
        backdropFilter:  "blur(12px)",
        boxShadow:       "0 4px 24px rgba(0,0,0,0.55)",
        userSelect:      "none",
      }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="7" cy="7" r="6"/>
              <polyline points="7,4 7,7 9.5,9.5"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8", textTransform: "uppercase" }}>
              Time Travel
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Selected time badge */}
            {!isLive && (
              <span style={{
                fontSize:     11,
                fontWeight:   700,
                color:        "#e2e8f0",
                background:   "rgba(59,130,246,0.18)",
                border:       "1px solid rgba(59,130,246,0.4)",
                borderRadius: 5,
                padding:      "2px 8px",
                fontVariantNumeric: "tabular-nums",
              }}>
                {_fmt(selectedDate)}
              </span>
            )}

            {/* LIVE button */}
            <button
              onClick={goLive}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          5,
                fontSize:     10,
                fontWeight:   800,
                letterSpacing:"0.08em",
                color:        isLive ? "#4ade80" : "#64748b",
                background:   isLive ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                border:       `1px solid ${isLive ? "rgba(74,222,128,0.35)" : "rgba(255,255,255,0.10)"}`,
                borderRadius: 5,
                padding:      "3px 9px",
                cursor:       "pointer",
                transition:   "all 0.15s",
              }}
            >
              <div className={isLive ? "ts-live-dot" : ""} style={{
                width:        7,
                height:       7,
                borderRadius: "50%",
                background:   isLive ? "#4ade80" : "#475569",
                flexShrink:   0,
              }}/>
              LIVE
            </button>

            {/* Close */}
            <button
              onClick={goLive}
              title="Close time travel"
              style={{
                background: "none",
                border:     "none",
                cursor:     "pointer",
                color:      "#64748b",
                fontSize:   16,
                lineHeight: 1,
                padding:    "0 2px",
              }}
            >×</button>
          </div>
        </div>

        {/* Slider */}
        <input
          type="range"
          className="ts-range"
          min={0}
          max={RANGE_MINUTES}
          value={sliderVal}
          onChange={handleChange}
          style={{ width: "100%", "--pct": `${pct}%` }}
        />

        {/* Axis labels */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ fontSize: 9, color: "#475569", fontVariantNumeric: "tabular-nums" }}>
            {_fmt(new Date(Date.now() - RANGE_MINUTES * 60_000))}
          </span>
          <span style={{ fontSize: 9, color: "#475569" }}>NOW</span>
        </div>
      </div>
    </>
  )
}
