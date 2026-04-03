/**
 * DirectorBar.jsx — Cinematic Director Mode playback bar.
 *
 * Fixed to the bottom of the map viewport. Collapsible to a thin strip.
 * Shows narration text, indicator cards, playback controls, and progress.
 *
 * Props:
 *   visible          {boolean}
 *   sequence         {object|null}   — full sequence object {id, intent, actions, ...}
 *   runner           {CommandRunner} — playback engine instance
 *   runnerState      {object}        — {isPlaying, currentIndex, total}
 *   currentAction    {object|null}   — most recent narrate/summary action
 *   indicators       {array}         — accumulated show_indicator actions
 *   generating       {boolean}       — waiting for Claude to generate sequence
 *   onGenerate       {function}      — (intent) => void
 *   onSave           {function}      — () => void
 *   onClose          {function}      — exit Director Mode
 *   savedStatus      {string|null}   — "saving"|"saved"|"error"
 */

import { useState, useRef, useEffect, useCallback } from "react"

const BAR_STYLES = `
  @keyframes director-bar-slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }
  .director-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9000;
    background: rgba(5, 12, 30, 0.88);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    border-top: 1px solid rgba(56, 139, 255, 0.18);
    box-shadow: 0 -4px 32px rgba(0,0,0,0.55);
    transition: height 0.25s ease;
    display: flex;
    flex-direction: column;
    user-select: none;
    animation: director-bar-slide-up 500ms ease-out forwards;
  }
  .director-bar.collapsed {
    height: 48px;
    overflow: hidden;
  }
  .director-bar.expanded {
    height: auto;
    min-height: 180px;
    max-height: 260px;
  }

  /* ── Top strip ── */
  .db-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 48px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(56, 139, 255, 0.1);
  }
  .db-strip-logo {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #388bff;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .db-step-counter {
    font-size: 11px;
    color: rgba(160,180,220,0.7);
    white-space: nowrap;
    margin-right: 4px;
  }
  .db-progress-bar-outer {
    flex: 1;
    height: 3px;
    background: rgba(255,255,255,0.08);
    border-radius: 2px;
    overflow: hidden;
  }
  .db-progress-bar-inner {
    height: 100%;
    background: linear-gradient(90deg, #388bff, #56cfff);
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  /* ── Controls ── */
  .db-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .db-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: rgba(56,139,255,0.12);
    border-radius: 6px;
    cursor: pointer;
    color: #b0c8ff;
    font-size: 14px;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .db-btn:hover { background: rgba(56,139,255,0.28); color: #fff; }
  .db-btn:active { background: rgba(56,139,255,0.45); }
  .db-btn.primary {
    background: rgba(56,139,255,0.25);
    color: #56cfff;
    width: 36px;
    height: 36px;
    font-size: 16px;
  }
  .db-btn.primary:hover { background: rgba(56,139,255,0.45); }
  .db-btn.danger { color: rgba(255,90,90,0.7); }
  .db-btn.danger:hover { background: rgba(255,60,60,0.18); color: #ff6060; }
  .db-btn[disabled] { opacity: 0.3; cursor: not-allowed; }

  .db-collapse-btn {
    background: none;
    border: none;
    color: rgba(160,180,220,0.5);
    cursor: pointer;
    font-size: 16px;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .db-collapse-btn:hover { color: #b0c8ff; }

  /* ── Narration body ── */
  .db-body {
    display: flex;
    flex: 1;
    min-height: 0;
    padding: 10px 14px 6px;
    gap: 14px;
  }
  .db-narration {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }
  .db-narration-heading {
    font-size: 12px;
    font-weight: 700;
    color: #56cfff;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .db-narration-text {
    font-size: 13px;
    line-height: 1.55;
    color: rgba(200,220,255,0.9);
    overflow-y: auto;
    flex: 1;
  }
  .db-narration-text::-webkit-scrollbar { width: 3px; }
  .db-narration-text::-webkit-scrollbar-thumb { background: rgba(56,139,255,0.3); border-radius: 2px; }

  /* ── Indicators row ── */
  .db-indicators {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 160px;
    max-width: 200px;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .db-indicators::-webkit-scrollbar { width: 3px; }
  .db-indicators::-webkit-scrollbar-thumb { background: rgba(56,139,255,0.3); border-radius: 2px; }
  .db-indicator-card {
    background: rgba(56,139,255,0.08);
    border: 1px solid rgba(56,139,255,0.15);
    border-radius: 6px;
    padding: 5px 8px;
  }
  .db-indicator-label {
    font-size: 10px;
    color: rgba(160,180,220,0.6);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .db-indicator-value {
    font-size: 13px;
    font-weight: 600;
    color: #b0d8ff;
    margin-top: 1px;
  }
  .db-indicator-card.alert .db-indicator-value { color: #ff8080; }
  .db-indicator-card.trend .db-indicator-value { color: #56cfff; }

  /* ── Generate form ── */
  .db-generate-form {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 10px;
    flex-shrink: 0;
    border-top: 1px solid rgba(56,139,255,0.08);
  }
  .db-intent-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(56,139,255,0.2);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    color: #d0e4ff;
    outline: none;
    transition: border-color 0.15s;
  }
  .db-intent-input::placeholder { color: rgba(160,180,220,0.35); }
  .db-intent-input:focus { border-color: rgba(56,139,255,0.5); }

  .db-generate-btn {
    white-space: nowrap;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    border: none;
    border-radius: 6px;
    background: rgba(56,139,255,0.25);
    color: #88c0ff;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .db-generate-btn:hover:not([disabled]) { background: rgba(56,139,255,0.45); color: #fff; }
  .db-generate-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
  .db-generate-btn.loading { color: #56cfff; }

  .db-save-btn {
    white-space: nowrap;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid rgba(56,139,255,0.2);
    border-radius: 6px;
    background: transparent;
    color: rgba(160,180,220,0.7);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .db-save-btn:hover:not([disabled]) { background: rgba(56,139,255,0.12); color: #b0c8ff; border-color: rgba(56,139,255,0.35); }
  .db-save-btn[disabled] { opacity: 0.35; cursor: not-allowed; }

  /* ── Summary sections ── */
  .db-summary-sections {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    flex: 1;
  }
  .db-summary-section-heading {
    font-size: 11px;
    font-weight: 700;
    color: #56cfff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 2px;
  }
  .db-summary-section-text {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(200,220,255,0.8);
  }

  /* ── Generating spinner ── */
  @keyframes db-spin {
    to { transform: rotate(360deg); }
  }
  .db-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(56,139,255,0.3);
    border-top-color: #56cfff;
    border-radius: 50%;
    animation: db-spin 0.7s linear infinite;
    vertical-align: middle;
    margin-right: 6px;
  }
`

function StyleTag() {
  return <style>{BAR_STYLES}</style>
}

export default function DirectorBar({
  visible        = false,
  sequence       = null,
  runner         = null,
  runnerState    = { isPlaying: false, currentIndex: -1, total: 0 },
  currentAction  = null,
  indicators     = [],
  generating     = false,
  onGenerate     = () => {},
  onSave         = () => {},
  onClose        = () => {},
  savedStatus    = null,
}) {
  const [collapsed, setCollapsed]   = useState(false)
  const [intent,    setIntent]      = useState("")
  const intentRef                   = useRef(null)

  const { isPlaying, currentIndex, total } = runnerState
  const hasSequence = sequence && total > 0
  const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0
  const isSummary = currentAction?.action === "summary"

  // Auto-expand when a new narration arrives
  useEffect(() => {
    if (currentAction) setCollapsed(false)
  }, [currentAction])

  const handleGenerate = useCallback(() => {
    const val = intent.trim()
    if (!val || generating) return
    onGenerate(val)
  }, [intent, generating, onGenerate])

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") handleGenerate()
  }, [handleGenerate])

  if (!visible) return null

  // ── Narration content ──
  let narrationHeading = ""
  let narrationText    = ""
  if (currentAction) {
    if (isSummary) {
      narrationHeading = currentAction.title || "Intelligence Summary"
      narrationText    = null  // rendered as sections below
    } else {
      narrationHeading = currentAction.heading || ""
      narrationText    = currentAction.text    || ""
    }
  }

  const saveLabel =
    savedStatus === "saving" ? "Saving…"
    : savedStatus === "saved"   ? "Saved ✓"
    : savedStatus === "error"   ? "Error"
    : "Save Briefing"

  return (
    <>
      <StyleTag />
      <div className={`director-bar ${collapsed ? "collapsed" : "expanded"}`}>

        {/* ── Strip: logo + progress + controls ── */}
        <div className="db-strip">
          <span className="db-strip-logo">Director</span>

          {hasSequence && (
            <span className="db-step-counter">
              {currentIndex + 1}/{total}
            </span>
          )}

          <div className="db-progress-bar-outer">
            <div
              className="db-progress-bar-inner"
              style={{ width: hasSequence ? `${pct}%` : "0%" }}
            />
          </div>

          {/* Playback controls */}
          {hasSequence && (
            <div className="db-controls">
              <button
                className="db-btn"
                title="Jump to start"
                onClick={() => runner?.jumpToStart()}
              >⏮</button>
              <button
                className="db-btn"
                title="Step back"
                disabled={currentIndex <= 0}
                onClick={() => runner?.stepBackward()}
              >◀</button>
              <button
                className="db-btn primary"
                title={isPlaying ? "Pause" : "Play"}
                onClick={() => isPlaying ? runner?.pause() : runner?.play()}
              >{isPlaying ? "⏸" : "▶"}</button>
              <button
                className="db-btn"
                title="Step forward"
                disabled={currentIndex >= total - 1}
                onClick={() => runner?.stepForward()}
              >▶</button>
              <button
                className="db-btn"
                title="Jump to end"
                onClick={() => runner?.jumpToEnd()}
              >⏭</button>
            </div>
          )}

          {/* Save button (shown after sequence complete) */}
          {hasSequence && currentIndex >= total - 1 && (
            <button
              className="db-save-btn"
              disabled={savedStatus === "saving" || savedStatus === "saved"}
              onClick={onSave}
            >{saveLabel}</button>
          )}

          {/* Collapse toggle */}
          <button
            className="db-collapse-btn"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed(c => !c)}
          >{collapsed ? "▲" : "▼"}</button>

          {/* Close */}
          <button
            className="db-btn danger"
            title="Exit Director Mode"
            onClick={onClose}
          >✕</button>
        </div>

        {/* ── Expanded body ── */}
        {!collapsed && (
          <>
            {(currentAction || generating) && (
              <div className="db-body">

                {/* Narration / Summary */}
                <div className="db-narration">
                  {generating && !currentAction && (
                    <div className="db-narration-text" style={{ color: "rgba(86,207,255,0.7)" }}>
                      <span className="db-spinner" />
                      Generating intelligence briefing…
                    </div>
                  )}

                  {currentAction && !isSummary && (
                    <>
                      {narrationHeading && (
                        <div className="db-narration-heading">{narrationHeading}</div>
                      )}
                      <div className="db-narration-text">{narrationText}</div>
                    </>
                  )}

                  {currentAction && isSummary && (
                    <>
                      <div className="db-narration-heading">{narrationHeading}</div>
                      <div className="db-summary-sections">
                        {(currentAction.sections || []).map((sec, i) => (
                          <div key={i}>
                            {sec.heading && (
                              <div className="db-summary-section-heading">{sec.heading}</div>
                            )}
                            <div className="db-summary-section-text">{sec.text}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Indicators */}
                {indicators.length > 0 && (
                  <div className="db-indicators">
                    {indicators.map((ind, i) => (
                      <div
                        key={i}
                        className={`db-indicator-card ${ind.type || ""}`}
                      >
                        <div className="db-indicator-label">{ind.label}</div>
                        <div className="db-indicator-value">{ind.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Generate form (shown when no sequence or between runs) ── */}
            {(!hasSequence || currentIndex < 0) && (
              <div className="db-generate-form">
                <input
                  ref={intentRef}
                  className="db-intent-input"
                  type="text"
                  placeholder="Briefing intent — e.g. 'Focus on Red Sea shipping disruptions'"
                  value={intent}
                  onChange={e => setIntent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={generating}
                />
                <button
                  className={`db-generate-btn${generating ? " loading" : ""}`}
                  disabled={generating || !intent.trim()}
                  onClick={handleGenerate}
                >
                  {generating ? <><span className="db-spinner" />Generating…</> : "Generate Briefing"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
