/**
 * DirectorModal.jsx — Cinematic Director Mode prompt flow.
 *
 * States: "prompt" | "loading" | "dissolving" | closed
 *
 * Props:
 *   open        {boolean}
 *   onClose     {() => void}
 *   onGenerate  {(intent: string) => Promise<void>}
 *   generating  {boolean}   — true while backend is working
 *   error       {string|null}
 */

import { useState, useEffect, useRef, useCallback } from "react"
import ttsService from "../services/ttsService.js"

const VOICE_STORAGE_KEY = "hw-director-voice"

const MODAL_STYLES = `
@keyframes director-diamond-pulse {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%       { transform: scale(1.2); opacity: 0.75; }
}
@keyframes director-dots {
  0%   { content: "."; }
  33%  { content: ".."; }
  66%  { content: "..."; }
  100% { content: "."; }
}
@keyframes director-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}

.director-blur-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: rgba(0, 0, 0, 0.60);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: backdrop-filter 800ms ease, background 800ms ease, opacity 800ms ease;
}
.director-blur-overlay.dissolving {
  backdrop-filter: blur(0px);
  -webkit-backdrop-filter: blur(0px);
  background: rgba(0, 0, 0, 0);
  opacity: 0;
  pointer-events: none;
}

.director-modal-box {
  position: relative;
  width: 100%;
  max-width: 500px;
  background: rgba(8, 15, 35, 0.92);
  border: 1px solid rgba(56, 139, 255, 0.2);
  border-radius: 14px;
  padding: 28px 28px 24px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(245,158,11,0.08);
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 0 16px;
}

.director-modal-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #f59e0b;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 8px;
}
.director-modal-title-diamond {
  font-size: 18px;
  line-height: 1;
}
.director-modal-subtitle {
  font-size: 14px;
  color: rgba(180, 200, 240, 0.7);
  margin-top: -10px;
  line-height: 1.4;
}

.director-modal-textarea {
  width: 100%;
  min-height: 72px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(56, 139, 255, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  color: #d0e4ff;
  outline: none;
  resize: vertical;
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.55;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.director-modal-textarea::placeholder { color: rgba(160, 180, 220, 0.35); }
.director-modal-textarea:focus { border-color: rgba(245, 158, 11, 0.45); }

.director-modal-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.director-modal-chip {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid rgba(56, 139, 255, 0.18);
  border-radius: 20px;
  background: rgba(56, 139, 255, 0.07);
  color: rgba(160, 200, 255, 0.75);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}
.director-modal-chip:hover {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  color: #f59e0b;
}

.director-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}
.director-modal-cancel {
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: transparent;
  color: rgba(160, 180, 220, 0.65);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.director-modal-cancel:hover { background: rgba(255,255,255,0.05); color: #b0c8ff; }
.director-modal-begin {
  padding: 8px 22px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border: none;
  border-radius: 7px;
  background: #f59e0b;
  color: #1a1000;
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}
.director-modal-begin:hover:not([disabled]) { background: #fbbf24; }
.director-modal-begin[disabled] { opacity: 0.4; cursor: not-allowed; }

/* ── Loading state ── */
.director-loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
}
.director-loading-diamond {
  font-size: 48px;
  color: #f59e0b;
  animation: director-diamond-pulse 1.2s ease-in-out infinite;
  line-height: 1;
}
.director-loading-label {
  font-size: 14px;
  font-weight: 500;
  color: rgba(200, 220, 255, 0.75);
  letter-spacing: 0.04em;
}
.director-shimmer-bar {
  width: 200px;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(90deg,
    rgba(245,158,11,0.1) 0%,
    rgba(245,158,11,0.6) 40%,
    rgba(245,158,11,0.1) 80%
  );
  background-size: 200% auto;
  animation: director-shimmer 1.4s linear infinite;
}
.director-loading-error {
  font-size: 13px;
  color: rgba(255, 100, 100, 0.85);
  text-align: center;
  max-width: 340px;
  line-height: 1.5;
}
.director-retry-btn {
  padding: 7px 18px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(245,158,11,0.35);
  border-radius: 6px;
  background: rgba(245,158,11,0.1);
  color: #f59e0b;
  cursor: pointer;
  transition: background 0.12s;
}
.director-retry-btn:hover { background: rgba(245,158,11,0.2); }

/* ── Voice selector ── */
.director-voice-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.director-voice-label {
  font-size: 12px;
  color: rgba(160,180,220,0.6);
  white-space: nowrap;
  flex-shrink: 0;
}
.director-voice-select {
  flex: 1;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: #d0e4ff;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(160,180,220,0.5)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 32px;
  transition: border-color 0.15s;
}
.director-voice-select:focus { border-color: rgba(245,158,11,0.45); }
.director-voice-select option { background: #0d1a35; color: #d0e4ff; }
.director-voice-test-btn {
  white-space: nowrap;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid rgba(56,139,255,0.2);
  border-radius: 8px;
  background: transparent;
  color: rgba(160,180,220,0.65);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.director-voice-test-btn:hover:not([disabled]) {
  background: rgba(56,139,255,0.1);
  color: #b0c8ff;
  border-color: rgba(56,139,255,0.35);
}
.director-voice-test-btn[disabled] { opacity: 0.4; cursor: not-allowed; }

@media (max-width: 768px) {
  .director-blur-overlay {
    align-items: flex-start;
  }
  .director-modal-box {
    width: 100%;
    max-width: 100%;
    min-height: 100dvh;
    border-radius: 0;
    border: none;
    padding: 48px 20px 32px;
    justify-content: center;
    margin: 0;
    background: rgba(6, 12, 28, 0.97);
  }
  .director-modal-textarea {
    min-height: 80px;
    font-size: 16px; /* prevent iOS zoom on focus */
  }
  .director-modal-chips {
    gap: 8px;
  }
  .director-modal-chip {
    min-height: 40px;
    display: flex;
    align-items: center;
    padding: 8px 14px;
    font-size: 12px;
  }
  .director-modal-actions {
    flex-direction: column-reverse;
    gap: 10px;
  }
  .director-modal-cancel,
  .director-modal-begin {
    width: 100%;
    min-height: 48px;
    font-size: 15px;
    border-radius: 10px;
    text-align: center;
    justify-content: center;
  }
}
`

const SUGGESTIONS = [
    {
        label: "Middle East Overview",
        intent: "Brief me on the current Middle East security situation, including maritime chokepoints and active conflict zones.",
    },
    {
        label: "Maritime Chokepoints",
        intent: "Analyze global maritime chokepoints and any current shipping disruptions or threats.",
    },
    {
        label: "East Africa Security",
        intent: "Brief me on the East Africa security situation, focusing on Somalia, Sudan, and the Horn of Africa.",
    },
    {
        label: "Global Threat Summary",
        intent: "Provide a global overview of the highest-priority security incidents from the past 24 hours.",
    },
]

export default function DirectorModal({
    open       = false,
    onClose    = () => {},
    onGenerate = async () => {},
    generating = false,
    error      = null,
}) {
    // "prompt" | "loading" | "dissolving"
    const [phase,     setPhase]     = useState("prompt")
    const [intent,    setIntent]    = useState("")
    const [isTesting, setIsTesting] = useState(false)
    const [voice,     setVoice]     = useState(() => {
        const saved = localStorage.getItem(VOICE_STORAGE_KEY)
        return saved || ttsService.voicePreference || "british_male"
    })
    const textareaRef      = useRef(null)
    const dissolveTimerRef = useRef(null)
    const phaseRef         = useRef("prompt")

    // Apply saved voice on mount
    useEffect(() => {
        const saved = localStorage.getItem(VOICE_STORAGE_KEY)
        if (saved) ttsService.setVoice(saved)
    }, [])

    const handleVoiceChange = useCallback((e) => {
        const val = e.target.value
        setVoice(val)
        ttsService.setVoice(val)
        localStorage.setItem(VOICE_STORAGE_KEY, val)
    }, [])

    const handleTest = useCallback(async () => {
        if (isTesting) return
        setIsTesting(true)
        await ttsService.speak("Horizon Watch Director Mode activated. Standing by for briefing.")
        setIsTesting(false)
    }, [isTesting])

    const updatePhase = (next) => {
        phaseRef.current = next
        setPhase(next)
    }

    // When modal opens, reset to prompt state
    useEffect(() => {
        if (open) {
            updatePhase("prompt")
            setIntent("")
            // autofocus after transition
            const t = setTimeout(() => textareaRef.current?.focus(), 80)
            return () => clearTimeout(t)
        }
    }, [open])

    // Watch generating prop: when it goes true → loading, when false → dissolve (if no error)
    useEffect(() => {
        if (generating) {
            updatePhase("loading")
        } else if (phaseRef.current === "loading" && !error) {
            // Success: begin dissolve
            updatePhase("dissolving")
            dissolveTimerRef.current = setTimeout(() => {
                onClose()
            }, 800)
        }
        return () => {
            if (dissolveTimerRef.current) clearTimeout(dissolveTimerRef.current)
        }
    }, [generating, error]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleBegin = useCallback(() => {
        const val = intent.trim()
        if (!val) return
        updatePhase("loading")
        onGenerate(val)
    }, [intent, onGenerate])

    const handleKeyDown = useCallback((e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleBegin()
        }
        if (e.key === "Escape") {
            onClose()
        }
    }, [handleBegin, onClose])

    const handleOverlayKeyDown = useCallback((e) => {
        if (e.key === "Escape") onClose()
    }, [onClose])

    if (!open) return null

    const isLoading    = phase === "loading"
    const isDissolving = phase === "dissolving"

    return (
        <>
            <style>{MODAL_STYLES}</style>
            <div
                className={`director-blur-overlay${isDissolving ? " dissolving" : ""}`}
                onKeyDown={handleOverlayKeyDown}
                tabIndex={-1}
                onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose() }}
            >
                {/* ── Prompt state ── */}
                {phase === "prompt" && (
                    <div className="director-modal-box" onClick={(e) => e.stopPropagation()}>
                        <div className="director-modal-title">
                            <span className="director-modal-title-diamond">◈</span>
                            Director Mode
                        </div>
                        <div className="director-modal-subtitle">What would you like to brief?</div>

                        <textarea
                            ref={textareaRef}
                            className="director-modal-textarea"
                            rows={3}
                            placeholder="e.g. Brief me on the Red Sea shipping situation and any active threats…"
                            value={intent}
                            onChange={(e) => setIntent(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />

                        <div className="director-modal-chips">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s.label}
                                    className="director-modal-chip"
                                    onClick={() => setIntent(s.intent)}
                                    type="button"
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>

                        {/* Voice selector */}
                        <div className="director-voice-row">
                            <span className="director-voice-label">Voice:</span>
                            <select
                                className="director-voice-select"
                                value={voice}
                                onChange={handleVoiceChange}
                            >
                                {ttsService.getAvailableVoices().map(v => (
                                    <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                                ))}
                            </select>
                            <button
                                className="director-voice-test-btn"
                                type="button"
                                disabled={isTesting}
                                onClick={handleTest}
                            >{isTesting ? "…" : "▶ Test"}</button>
                        </div>

                        <div className="director-modal-actions">
                            <button className="director-modal-cancel" onClick={onClose} type="button">
                                Cancel
                            </button>
                            <button
                                className="director-modal-begin"
                                disabled={!intent.trim()}
                                onClick={handleBegin}
                                type="button"
                            >
                                Begin ▶
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Loading / error state ── */}
                {(phase === "loading" || phase === "dissolving") && (
                    <div className="director-loading-box" onClick={(e) => e.stopPropagation()}>
                        <div className="director-loading-diamond">◈</div>
                        {!error && <div className="director-loading-label">Preparing your briefing…</div>}
                        {!error && <div className="director-shimmer-bar" />}
                        {error && (
                            <>
                                <div className="director-loading-error">{error}</div>
                                <button
                                    className="director-retry-btn"
                                    onClick={() => { updatePhase("prompt"); setIntent("") }}
                                >
                                    Try Again
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}
