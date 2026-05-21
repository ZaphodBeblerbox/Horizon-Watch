import { useState, useEffect, useRef, useCallback } from "react"
import { safeArray } from "../utils/safeArray"
import API_BASE from "../apiBase.js"

export default function NewsReels({ onClose }) {
  const [reels,        setReels]        = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const touchStartY  = useRef(null)
  const touchStartX  = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/news/reels`)
      .then(r => r.json())
      .then(data => {
        setReels(safeArray(data.videos))
        setLoading(false)
      })
      .catch(() => {
        setError("Could not load news reels")
        setLoading(false)
      })
  }, [])

  const handleTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return
    const deltaY = touchStartY.current - e.changedTouches[0].clientY
    const deltaX = Math.abs(touchStartX.current - e.changedTouches[0].clientX)
    if (Math.abs(deltaY) < 50 || deltaX > 60) return
    if (deltaY > 0) {
      setCurrentIndex(i => Math.min(i + 1, reels.length - 1))
    } else {
      setCurrentIndex(i => Math.max(i - 1, 0))
    }
    touchStartY.current = null
  }, [reels.length])

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight")
        setCurrentIndex(i => Math.min(i + 1, reels.length - 1))
      if (e.key === "ArrowUp"   || e.key === "ArrowLeft")
        setCurrentIndex(i => Math.max(i - 1, 0))
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [reels.length, onClose])

  const current = reels[currentIndex]

  const getEmbedUrl = (video) => {
    if (!video) return ""
    return (
      `https://www.youtube.com/embed/${video.video_id}` +
      `?autoplay=1&mute=1&controls=0&rel=0` +
      `&modestbranding=1&playsinline=1&enablejsapi=1`
    )
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "#000", zIndex: 9999,
        display: "flex", flexDirection: "column",
        overflow: "hidden", userSelect: "none",
      }}
    >
      {/* Header bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
        padding: "calc(max(12px, env(safe-area-inset-top))) 16px 12px",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#FF3B30", boxShadow: "0 0 6px #FF3B30",
            animation: "nr-pulse 1.5s infinite",
          }} />
          <span style={{ color: "white", fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
            LIVE NEWS
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.15)", border: "none",
            borderRadius: "50%", width: 32, height: 32,
            color: "white", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit",
          }}
        >×</button>
      </div>

      {/* Video area */}
      {loading ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          justifyContent: "center", color: "rgba(255,255,255,0.5)", fontSize: 14,
        }}>
          Loading news reels…
        </div>
      ) : error ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center",
          justifyContent: "center", color: "rgba(255,255,255,0.4)", fontSize: 14,
        }}>
          {error}
        </div>
      ) : (
        <>
          {/* Full-screen iframe */}
          <iframe
            key={current?.video_id}
            src={getEmbedUrl(current)}
            style={{
              position: "absolute", top: 0, left: 0,
              width: "100%", height: "100%", border: "none",
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />

          {/* Bottom info overlay */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 60, zIndex: 10,
            padding: "20px 16px calc(max(32px, env(safe-area-inset-bottom)) + 8px)",
            background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
          }}>
            {/* Channel badge */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(255,59,48,0.2)", border: "1px solid rgba(255,59,48,0.4)",
              borderRadius: 20, padding: "3px 10px", marginBottom: 8,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF3B30" }} />
              <span style={{ color: "#FF3B30", fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
                {current?.channel?.toUpperCase()}
              </span>
            </div>

            {/* Title */}
            <div style={{
              color: "white", fontSize: 15, fontWeight: 600,
              lineHeight: 1.3, marginBottom: 6,
              textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            }}>
              {current?.title}
            </div>

            {/* Published time */}
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
              {current?.published ? new Date(current.published).toLocaleString() : ""}
            </div>
          </div>

          {/* Right side controls */}
          <div style={{
            position: "absolute", right: 12,
            bottom: "calc(max(80px, env(safe-area-inset-bottom) + 60px))",
            zIndex: 10, display: "flex", flexDirection: "column",
            gap: 16, alignItems: "center",
          }}>
            <button
              onClick={() => setCurrentIndex(i => Math.max(i - 1, 0))}
              disabled={currentIndex === 0}
              style={{
                background: "rgba(255,255,255,0.15)", border: "none",
                borderRadius: "50%", width: 44, height: 44,
                color: currentIndex === 0 ? "rgba(255,255,255,0.2)" : "white",
                fontSize: 20, cursor: currentIndex === 0 ? "default" : "pointer",
                backdropFilter: "blur(8px)", fontFamily: "inherit",
              }}
            >↑</button>

            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "center" }}>
              {currentIndex + 1}<br />
              <span style={{ fontSize: 9 }}>of</span><br />
              {reels.length}
            </div>

            <button
              onClick={() => setCurrentIndex(i => Math.min(i + 1, reels.length - 1))}
              disabled={currentIndex === reels.length - 1}
              style={{
                background: "rgba(255,255,255,0.15)", border: "none",
                borderRadius: "50%", width: 44, height: 44,
                color: currentIndex === reels.length - 1 ? "rgba(255,255,255,0.2)" : "white",
                fontSize: 20, cursor: currentIndex === reels.length - 1 ? "default" : "pointer",
                backdropFilter: "blur(8px)", fontFamily: "inherit",
              }}
            >↓</button>

            {/* Open in YouTube */}
            <a
              href={`https://www.youtube.com/watch?v=${current?.video_id}`}
              target="_blank"
              rel="noreferrer"
              style={{
                background: "rgba(255,59,48,0.2)", border: "1px solid rgba(255,59,48,0.3)",
                borderRadius: "50%", width: 44, height: 44,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#FF3B30", fontSize: 18, textDecoration: "none",
              }}
            >▶</a>
          </div>

          {/* Left side progress dots */}
          <div style={{
            position: "absolute", left: 8, top: "50%",
            transform: "translateY(-50%)", zIndex: 10,
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            {reels
              .slice(Math.max(0, currentIndex - 4), Math.min(reels.length, currentIndex + 5))
              .map((_, i) => {
                const actualIndex = Math.max(0, currentIndex - 4) + i
                return (
                  <div
                    key={actualIndex}
                    onClick={() => setCurrentIndex(actualIndex)}
                    style={{
                      width:      actualIndex === currentIndex ? 4 : 3,
                      height:     actualIndex === currentIndex ? 20 : 6,
                      borderRadius: 2,
                      background: actualIndex === currentIndex
                        ? "white" : "rgba(255,255,255,0.3)",
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                  />
                )
              })}
          </div>

          {/* Swipe hint */}
          {currentIndex === 0 && reels.length > 1 && (
            <div style={{
              position: "absolute", bottom: 140, left: "50%",
              transform: "translateX(-50%)", zIndex: 10,
              color: "rgba(255,255,255,0.4)", fontSize: 11,
              textAlign: "center", animation: "nr-fadeout 3s forwards 2s",
              pointerEvents: "none",
            }}>
              Swipe up for next
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes nr-pulse   { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes nr-fadeout { 0% { opacity:1; } 100% { opacity:0; } }
      `}</style>
    </div>
  )
}
