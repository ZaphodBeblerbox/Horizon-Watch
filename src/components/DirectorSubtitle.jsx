import { useState, useEffect, useRef, useCallback } from "react"
import ttsService from "../services/ttsService.js"

const SUBTITLE_STYLES = `
@keyframes subtitle-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes subtitle-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

.director-subtitle-root {
  position: fixed;
  bottom: 80px;
  left: 16px;
  right: 16px;
  z-index: 8500;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: auto;
}

.director-subtitle-indicators {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.director-subtitle-indicator-pill {
  background: rgba(0,0,0,0.65);
  border: 1px solid rgba(56,139,255,0.2);
  border-radius: 20px;
  padding: 4px 10px;
  font-size: 11px;
  color: rgba(200,220,255,0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.director-subtitle-indicator-pill .pill-label {
  color: rgba(160,180,220,0.55);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: 4px;
}

.director-subtitle-box {
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 14px;
  padding: 14px 18px 10px;
  overflow: hidden;
  max-height: 40vh;
  overflow-y: auto;
}

.director-subtitle-box.summary-mode {
  max-height: 60vh;
}

.director-subtitle-progress {
  height: 2px;
  background: rgba(255,255,255,0.1);
  border-radius: 1px;
  margin-bottom: 10px;
  overflow: hidden;
}
.director-subtitle-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #388bff, #56cfff);
  border-radius: 1px;
  transition: width 0.4s ease;
}

.director-subtitle-heading {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(86, 207, 255, 0.75);
  text-transform: uppercase;
  margin-bottom: 6px;
}

.director-subtitle-text {
  font-size: 15px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.95);
  animation: subtitle-fade-in 300ms ease forwards;
}

.director-subtitle-summary-title {
  font-size: 13px;
  font-weight: 700;
  color: #56cfff;
  margin-bottom: 10px;
  letter-spacing: 0.04em;
}
.director-subtitle-summary-section-heading {
  font-size: 11px;
  font-weight: 700;
  color: rgba(86,207,255,0.8);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 8px;
  margin-bottom: 3px;
}
.director-subtitle-summary-text {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(200,220,255,0.85);
  margin-bottom: 6px;
}

.director-subtitle-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.07);
  transition: opacity 0.4s ease;
}
.director-subtitle-controls.faded {
  opacity: 0.35;
}

.dsb-btn {
  width: 44px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(56,139,255,0.1);
  border-radius: 8px;
  cursor: pointer;
  color: rgba(200,220,255,0.8);
  font-size: 16px;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.dsb-btn:active { background: rgba(56,139,255,0.3); }
.dsb-btn.primary {
  width: 48px;
  height: 40px;
  color: #56cfff;
  font-size: 20px;
  background: rgba(56,139,255,0.18);
}
.dsb-btn[disabled] { opacity: 0.25; }

.dsb-step-counter {
  margin-left: auto;
  font-size: 11px;
  color: rgba(160,180,220,0.55);
  font-variant-numeric: tabular-nums;
  padding-right: 4px;
}

.dsb-mute-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(56,139,255,0.1);
  border-radius: 8px;
  cursor: pointer;
  color: rgba(200,220,255,0.9);
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  transition: color 200ms;
}
.dsb-mute-btn:active { background: rgba(56,139,255,0.3); }
.dsb-mute-btn.muted { color: rgba(200,220,255,0.3); }

.director-subtitle-save-btn {
  width: 100%;
  margin-top: 12px;
  padding: 12px;
  font-size: 14px;
  font-weight: 700;
  border: none;
  border-radius: 10px;
  background: rgba(56,139,255,0.22);
  color: #88c0ff;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.director-subtitle-save-btn:active { background: rgba(56,139,255,0.38); }
.director-subtitle-save-btn[disabled] { opacity: 0.35; }

.director-subtitle-exit {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(255,255,255,0.08);
  border-radius: 50%;
  cursor: pointer;
  color: rgba(200,220,255,0.6);
  font-size: 14px;
  -webkit-tap-highlight-color: transparent;
}

.director-exit-confirm {
  position: absolute;
  inset: 0;
  background: rgba(5,12,30,0.95);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 20px;
  z-index: 10;
}
.director-exit-confirm-text {
  font-size: 14px;
  color: rgba(200,220,255,0.85);
  text-align: center;
}
.director-exit-confirm-btns {
  display: flex;
  gap: 10px;
  width: 100%;
}
.director-exit-confirm-cancel {
  flex: 1;
  padding: 10px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  background: transparent;
  color: rgba(160,180,220,0.7);
  font-size: 13px;
  cursor: pointer;
}
.director-exit-confirm-ok {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: rgba(255,80,80,0.25);
  color: #ff8080;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

@media (min-width: 769px) {
  .director-subtitle-root { display: none !important; }
}
`

function SubIconUnmuted() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="currentColor"/>
      <path d="M19 12c0 2.45-1.4 4.57-3.43 5.6L17 19.02C19.59 17.71 21.5 15.07 21.5 12s-1.91-5.71-4.5-7.02L15.57 6.4C17.6 7.43 19 9.55 19 12z" fill="currentColor"/>
    </svg>
  )
}

function SubIconMuted() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63z" fill="currentColor"/>
      <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2"/>
    </svg>
  )
}

export default function DirectorSubtitle({
  visible       = false,
  sequence      = null,
  runner        = null,
  runnerState   = { isPlaying: false, currentIndex: -1, total: 0 },
  currentAction = null,
  indicators    = [],
  onSave        = () => {},
  onClose       = () => {},
  savedStatus   = null,
}) {
  const [subtitleVisible, setSubtitleVisible] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fadeKey,         setFadeKey]         = useState(0)
  const [confirmExit,     setConfirmExit]     = useState(false)
  const [isMuted,         setIsMuted]         = useState(() => ttsService.muted)
  const controlsTimer   = useRef(null)
  const prevActionRef   = useRef(null)

  const handleToggleMute = useCallback((e) => {
    e.stopPropagation()
    const nowMuted = ttsService.toggleMute()
    setIsMuted(nowMuted)
    resetControlsTimer()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { isPlaying, currentIndex, total } = runnerState
  const isSummary = currentAction?.action === "summary"
  const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0

  // Fade-in new narration text when action changes
  useEffect(() => {
    if (currentAction && currentAction !== prevActionRef.current) {
      prevActionRef.current = currentAction
      setFadeKey(k => k + 1)
      setSubtitleVisible(true)
    }
  }, [currentAction])

  // Auto-fade controls after 5s when playing
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(controlsTimer.current)
    if (isPlaying) {
      controlsTimer.current = setTimeout(() => setControlsVisible(false), 5000)
    }
  }, [isPlaying])

  useEffect(() => {
    resetControlsTimer()
    return () => clearTimeout(controlsTimer.current)
  }, [isPlaying, currentIndex, resetControlsTimer])

  const handleTapSubtitle = () => {
    resetControlsTimer()
  }

  if (!visible) return null

  const saveLabel =
    savedStatus === "saving" ? "Saving\u2026"
    : savedStatus === "saved"  ? "Saved \u2713"
    : savedStatus === "error"  ? "Error \u2014 try again"
    : "Save Briefing"

  const showSave = isSummary || currentIndex >= total - 1

  return (
    <>
      <style>{SUBTITLE_STYLES}</style>
      <div
        className="director-subtitle-root"
        onTouchStart={handleTapSubtitle}
        onClick={handleTapSubtitle}
      >
        {/* Indicator pills */}
        {indicators.length > 0 && subtitleVisible && (
          <div className="director-subtitle-indicators">
            {indicators.slice(-4).map((ind, i) => (
              <div key={i} className="director-subtitle-indicator-pill">
                <span className="pill-label">{ind.label}</span>
                {ind.value}
              </div>
            ))}
          </div>
        )}

        {/* Main subtitle box */}
        {currentAction && subtitleVisible && (
          <div
            className={`director-subtitle-box${isSummary ? " summary-mode" : ""}`}
            style={{ position: "relative" }}
          >
            {/* Exit button */}
            <button
              className="director-subtitle-exit"
              onClick={(e) => { e.stopPropagation(); setConfirmExit(true) }}
            >&#x2715;</button>

            {/* Exit confirmation overlay */}
            {confirmExit && (
              <div className="director-exit-confirm" onClick={e => e.stopPropagation()}>
                <div className="director-exit-confirm-text">Exit Director Mode?</div>
                <div className="director-exit-confirm-btns">
                  <button className="director-exit-confirm-cancel" onClick={() => setConfirmExit(false)}>Keep watching</button>
                  <button className="director-exit-confirm-ok" onClick={onClose}>Exit</button>
                </div>
              </div>
            )}

            {/* Progress bar */}
            <div className="director-subtitle-progress">
              <div className="director-subtitle-progress-fill" style={{ width: `${pct}%` }} />
            </div>

            {/* Narration content */}
            {!isSummary && (
              <>
                {currentAction.heading && (
                  <div className="director-subtitle-heading">{currentAction.heading}</div>
                )}
                <div key={fadeKey} className="director-subtitle-text">{currentAction.text}</div>
              </>
            )}

            {/* Summary content */}
            {isSummary && (
              <>
                <div className="director-subtitle-summary-title">{currentAction.title || "Intelligence Summary"}</div>
                {(currentAction.sections || []).map((sec, i) => (
                  <div key={i}>
                    {sec.heading && <div className="director-subtitle-summary-section-heading">{sec.heading}</div>}
                    <div className="director-subtitle-summary-text">{sec.text}</div>
                  </div>
                ))}
              </>
            )}

            {/* Save button on summary or at end */}
            {showSave && (
              <button
                className="director-subtitle-save-btn"
                disabled={savedStatus === "saving" || savedStatus === "saved"}
                onClick={(e) => { e.stopPropagation(); onSave() }}
              >{saveLabel}</button>
            )}

            {/* Playback controls */}
            <div className={`director-subtitle-controls${controlsVisible ? "" : " faded"}`}>
              <button
                className={`dsb-mute-btn${isMuted ? " muted" : ""}`}
                title={isMuted ? "Unmute narration" : "Mute narration"}
                onClick={handleToggleMute}
              >{isMuted ? <SubIconMuted /> : <SubIconUnmuted />}</button>
              <button
                className="dsb-btn"
                disabled={currentIndex <= 0}
                onClick={(e) => { e.stopPropagation(); runner?.stepBackward(); resetControlsTimer() }}
              >&#x25C4;</button>
              <button
                className="dsb-btn primary"
                onClick={(e) => { e.stopPropagation(); isPlaying ? runner?.pause() : runner?.play(); resetControlsTimer() }}
              >{isPlaying ? "\u23F8" : "\u25BA"}</button>
              <button
                className="dsb-btn"
                disabled={currentIndex >= total - 1}
                onClick={(e) => { e.stopPropagation(); runner?.stepForward(); resetControlsTimer() }}
              >&#x25BA;&#x25BA;</button>
              {total > 0 && (
                <span className="dsb-step-counter">{currentIndex + 1}/{total}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
